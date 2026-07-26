import {
  buildIntentPrompt,
  extractJson,
  friendlyAiError,
  toParsedBatch,
} from './shared';
import type { ParsedBatch } from '../../types';

type AnthropicResponse = {
  content?: Array<{ type?: string; text?: string }>;
  error?: { message?: string };
};

const ANTHROPIC_MODELS = [
  'claude-haiku-4-5-20251001',
  'claude-3-5-haiku-latest',
  'claude-3-haiku-20240307',
];

export async function parseWithAnthropic(
  rawInput: string,
  apiKey: string,
): Promise<ParsedBatch> {
  const prompt = buildIntentPrompt(rawInput);
  let lastError = '';

  for (const model of ANTHROPIC_MODELS) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          temperature: 0.2,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const data = (await res.json()) as AnthropicResponse;
      if (!res.ok) {
        throw new Error(data.error?.message ?? `Anthropic HTTP ${res.status}`);
      }
      const text = data.content?.find((c) => c.type === 'text')?.text;
      if (!text) throw new Error('Anthropic não retornou texto.');
      return toParsedBatch(
        extractJson(text) as Record<string, unknown>,
        rawInput,
      );
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      const lower = lastError.toLowerCase();
      if (
        lower.includes('invalid') ||
        lower.includes('authentication') ||
        lower.includes('401') ||
        lower.includes('403')
      ) {
        break;
      }
    }
  }

  throw new Error(friendlyAiError(lastError || 'Falha ao chamar a Anthropic.'));
}
