import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * Relógio leve para a UI atualizar quando um horário “passa”
 * sem precisar sair da tela.
 */
export function useNowTick(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, intervalMs);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') tick();
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [intervalMs]);

  return now;
}
