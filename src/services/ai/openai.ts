import {
  buildIntentPrompt,
  extractJson,
  friendlyAiError,
  toParsedBatch,
} from './shared';
import type { ParsedBatch } from '../../types';

type OpenAIResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
};

const OPENAI_MODELS = ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o'];

export async function parseWithOpenAI(
  rawInput: string,
  apiKey: string,
): Promise<ParsedBatch> {
  const prompt = buildIntentPrompt(rawInput);
  let lastError = '';

  for (const model of OPENAI_MODELS) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                'Você responde somente JSON válido conforme as instruções do usuário.',
            },
            { role: 'user', content: prompt },
          ],
        }),
      });
      const data = (await res.json()) as OpenAIResponse;
      if (!res.ok) {
        throw new Error(data.error?.message ?? `OpenAI HTTP ${res.status}`);
      }
      const text = data.choices?.[0]?.message?.content;
      if (!text) throw new Error('OpenAI não retornou texto.');
      return toParsedBatch(
        extractJson(text) as Record<string, unknown>,
        rawInput,
      );
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      const lower = lastError.toLowerCase();
      if (
        lower.includes('invalid') ||
        lower.includes('incorrect api key') ||
        lower.includes('401')
      ) {
        break;
      }
    }
  }

  throw new Error(friendlyAiError(lastError || 'Falha ao chamar a OpenAI.'));
}
