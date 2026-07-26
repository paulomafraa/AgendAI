import { AppState, type AppStateStatus } from 'react-native';

/** Probe leve: se falhar, tratamos como sem conexão. */
export async function isOnline(timeoutMs = 3500): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch('https://clients3.google.com/generate_204', {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok || res.status === 204;
  } catch {
    return false;
  }
}

export function isLikelyNetworkError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('network') ||
    m.includes('internet') ||
    m.includes('offline') ||
    m.includes('failed to fetch') ||
    m.includes('network request failed') ||
    m.includes('timed out') ||
    m.includes('timeout') ||
    m.includes('econnrefused') ||
    m.includes('enotfound') ||
    m.includes('unreachable') ||
    m.includes('sem conexão') ||
    m.includes('abort')
  );
}

/** Escuta quando o app volta ao foco (bom momento pra drenar a fila). */
export function onAppBecameActive(cb: () => void): () => void {
  const onChange = (state: AppStateStatus) => {
    if (state === 'active') cb();
  };
  const sub = AppState.addEventListener('change', onChange);
  return () => sub.remove();
}
