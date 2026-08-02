import {
  buildIntentPrompt,
  extractJson,
  friendlyAiError,
  looksLikePublicLookupIntent,
  publicLookupNeedsRetry,
  toParsedBatch,
} from './shared';
import { isSafeModelId } from '../../utils/security';
import type { ParsedBatch } from '../../types';

type GeminiListResponse = {
  models?: Array<{
    name?: string;
    supportedGenerationMethods?: string[];
  }>;
  error?: { message?: string };
};

type GeminiGenerateResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  error?: { message?: string };
};

function scoreModel(id: string): number {
  const n = id.toLowerCase();
  if (n.includes('embed') || n.includes('image') || n.includes('tts')) return -100;
  // Prefer Flash models that support google_search well
  if (n.includes('flash-lite') || n.includes('flashlite')) return 90;
  if (n.includes('2.5-flash') || n.includes('2.0-flash')) return 100;
  if (n.includes('flash')) return 85;
  if (n.includes('lite')) return 70;
  if (n.includes('pro')) return 40;
  return 20;
}

function geminiHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-goog-api-key': apiKey,
  };
}

async function listUsableModels(apiKey: string): Promise<string[]> {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models';
  const res = await fetch(url, { headers: geminiHeaders(apiKey) });
  const data = (await res.json()) as GeminiListResponse;
  if (!res.ok) {
    throw new Error(data.error?.message ?? `Gemini list models HTTP ${res.status}`);
  }

  const ids = (data.models ?? [])
    .filter((m) =>
      (m.supportedGenerationMethods ?? []).includes('generateContent'),
    )
    .map((m) => (m.name ?? '').replace(/^models\//, ''))
    .filter(Boolean)
    .filter((id) => isSafeModelId(id))
    .filter((id) => {
      const n = id.toLowerCase();
      return (
        n.includes('gemini') &&
        !n.includes('embed') &&
        !n.includes('image') &&
        !n.includes('tts') &&
        !n.includes('robotics')
      );
    })
    .sort((a, b) => scoreModel(b) - scoreModel(a));

  return [...new Set(ids)];
}

type GenerateOptions = {
  useSearch: boolean;
  forceJsonMime: boolean;
};

async function generateWithModel(
  model: string,
  apiKey: string,
  prompt: string,
  options: GenerateOptions,
): Promise<string> {
  if (!isSafeModelId(model)) {
    throw new Error('Modelo Gemini inválido.');
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      ...(options.forceJsonMime
        ? { responseMimeType: 'application/json' }
        : {}),
    },
  };
  if (options.useSearch) {
    body.tools = [{ google_search: {} }];
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: geminiHeaders(apiKey),
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as GeminiGenerateResponse;
  if (!res.ok) {
    throw new Error(data.error?.message ?? `Gemini HTTP ${res.status}`);
  }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini não retornou texto.');
  return text;
}

function isRetryableModelError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('quota') ||
    lower.includes('rate') ||
    lower.includes('no longer available') ||
    lower.includes('not found') ||
    lower.includes('not supported') ||
    lower.includes('resource_exhausted') ||
    lower.includes('invalid_argument') ||
    lower.includes('tool') ||
    lower.includes('google_search') ||
    lower.includes('response_mime_type') ||
    lower.includes('mime')
  );
}

export async function parseWithGemini(
  rawInput: string,
  apiKey: string,
  openTaskTitles: string[] = [],
): Promise<ParsedBatch> {
  const basePrompt = buildIntentPrompt(rawInput, openTaskTitles);
  const publicLookup = looksLikePublicLookupIntent(rawInput);
  let models: string[] = [];
  try {
    models = await listUsableModels(apiKey);
  } catch {
    models = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest'];
  }

  if (models.length === 0) {
    models = ['gemini-2.5-flash', 'gemini-flash-latest'];
  }

  // Evento público: só tentativas COM busca (sem fallback preguiçoso sem web)
  const attempts: GenerateOptions[] = publicLookup
    ? [
        { useSearch: true, forceJsonMime: true },
        { useSearch: true, forceJsonMime: false },
        { useSearch: true, forceJsonMime: false },
      ]
    : [
        { useSearch: true, forceJsonMime: true },
        { useSearch: true, forceJsonMime: false },
        { useSearch: false, forceJsonMime: true },
        { useSearch: false, forceJsonMime: false },
      ];

  const nowForFix = new Date();
  const correctionSuffix = `

CORREÇÃO OBRIGATÓRIA (o resultado anterior estava inválido):
- Agora é ${nowForFix.toISOString()}. O datetime NÃO pode ser no passado.
- Para "próximo jogo/corrida", escolha o PRÓXIMO evento FUTURO.
- FUSO: datetime SEMPRE em horário de Brasília (offset -03:00). NUNCA use hora local do circuito/país (CEST, ET, BST…).
- Se a busca tiver "10h Brasília (15h local)", o datetime deve ser 10:00-03:00.
- Se a busca mostrar horário confiável: timeExplicit true, softTime false.
- softTime 13:00 é proibido quando existe HH:MM na busca.
- Refaça a busca se precisar. Responda só o JSON corrigido.`;

  let lastError = '';
  let lastBatch: ParsedBatch | null = null;
  let usedCorrection = false;

  for (const model of models.slice(0, 8)) {
    for (const opts of attempts) {
      const prompt = usedCorrection
        ? `${basePrompt}${correctionSuffix}`
        : basePrompt;
      try {
        const text = await generateWithModel(model, apiKey, prompt, opts);
        const batch = toParsedBatch(
          extractJson(text) as Record<string, unknown>,
          rawInput,
        );
        lastBatch = batch;

        if (publicLookup && publicLookupNeedsRetry(batch, rawInput)) {
          lastError =
            'Evento público fraco (passado, sem hora ou softTime).';
          if (!usedCorrection) {
            usedCorrection = true;
          }
          continue;
        }
        return batch;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        if (!isRetryableModelError(lastError) && !opts.useSearch) {
          break;
        }
      }
    }
  }

  if (lastBatch) return lastBatch;
  throw new Error(friendlyAiError(lastError || 'Falha ao chamar o Gemini.'));
}
