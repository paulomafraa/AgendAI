import { parseWithAnthropic } from './anthropic';
import { parseWithGemini } from './gemini';
import { parseWithOpenAI } from './openai';
import { detectProvider } from './shared';
import type { ParsedBatch } from '../../types';
import { clampText, LIMITS } from '../../utils/security';

export { detectProvider, providerLabel } from './shared';

/**
 * Interprets natural language into one or many categorized actions.
 */
export async function parseUserIntent(
  rawInput: string,
  apiKey: string,
): Promise<ParsedBatch> {
  if (!apiKey.trim()) {
    throw new Error(
      'Configure uma chave de API em Ajustes antes de continuar.',
    );
  }

  const safeInput = clampText(rawInput, LIMITS.userInput);
  if (!safeInput) {
    throw new Error('Pedido vazio.');
  }

  const provider = detectProvider(apiKey);
  switch (provider) {
    case 'openai':
      return parseWithOpenAI(safeInput, apiKey);
    case 'anthropic':
      return parseWithAnthropic(safeInput, apiKey);
    case 'gemini':
    default:
      return parseWithGemini(safeInput, apiKey);
  }
}
