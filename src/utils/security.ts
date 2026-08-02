/** Limites simples contra payloads abusivos / lixo em storage e IA. */
export const LIMITS = {
  userInput: 2_000,
  title: 160,
  notes: 2_000,
  category: 40,
  location: 120,
  historyDetail: 500,
  queueSize: 40,
  todos: 500,
  events: 500,
  history: 200,
  dismissedGoogleEvents: 300,
} as const;

export function clampText(
  value: unknown,
  max: number,
  fallback = '',
): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Só deep links do próprio app (voz). Bloqueia javascript:, http, etc. */
export function isAgendaiVoiceDeepLink(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  const raw = url.trim();
  if (!raw || /[\u0000-\u001f]/.test(raw)) return false;
  if (/^(javascript|data|file|content):/i.test(raw)) return false;

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'agendai:') return false;
    const host = (parsed.hostname || parsed.host || '').toLowerCase();
    const path = (parsed.pathname || '').replace(/\/+$/, '').toLowerCase();
    if (host === 'voice') return true;
    if (host === '' && (path === '/voice' || path === 'voice')) return true;
    return false;
  } catch {
    return /^agendai:\/\/voice([/?#]|$)/i.test(raw);
  }
}

/** Só abre https públicos conhecidos (Ajustes). */
export function isSafeHttpsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;
    return Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

/** IDs de modelo Gemini na URL: sem path traversal. */
export function isSafeModelId(model: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}$/.test(model);
}

export async function openSafeHttps(url: string): Promise<void> {
  if (!isSafeHttpsUrl(url)) return;
  const { Linking } = await import('react-native');
  await Linking.openURL(url);
}
