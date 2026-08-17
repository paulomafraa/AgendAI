import { Platform } from 'react-native';

type BackgroundServiceModule = {
  isRunning: () => boolean;
  start: (
    task: (args?: { delay?: number }) => Promise<void>,
    options: Record<string, unknown>,
  ) => Promise<void>;
  stop: () => Promise<void>;
  updateNotification: (opts: { taskDesc?: string }) => Promise<void>;
};

let BackgroundService: BackgroundServiceModule | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  BackgroundService = require('react-native-background-actions').default;
} catch {
  BackgroundService = null;
}

function buildOptions(remainingHint?: number) {
  const left = remainingHint && remainingHint > 0 ? remainingHint : 1;
  return {
    taskName: 'AgendAIFila',
    taskTitle: 'AgendAI processando',
    taskDesc:
      left === 1
        ? 'Gravando seu pedido…'
        : `Processando fila (${left} pedidos)…`,
    taskIcon: {
      name: 'ic_launcher',
      type: 'mipmap',
    },
    color: '#0F766E',
    linkingURI: 'agendai://',
    parameters: {
      delay: 1000,
    },
  };
}

/**
 * Executa o trabalho da fila DENTRO do foreground service.
 * Assim o JS continua mesmo com o app fora da tela (Android).
 * Precisa ser chamado ainda em primeiro plano (restrição Android 12+).
 */
export async function runWithQueueKeepAlive(
  remainingHint: number,
  work: () => Promise<void>,
): Promise<void> {
  if (Platform.OS !== 'android' || !BackgroundService) {
    await work();
    return;
  }

  // Já há um serviço: só roda o trabalho (mesmo bridge JS).
  if (BackgroundService.isRunning()) {
    await work();
    return;
  }

  let workError: unknown;
  try {
    await BackgroundService.start(async () => {
      try {
        await work();
      } catch (e) {
        workError = e;
      }
    }, buildOptions(remainingHint));
  } catch {
    // Se o FGS falhar ao iniciar, ainda tenta processar em foreground.
    await work();
    return;
  }

  try {
    if (BackgroundService.isRunning()) {
      await BackgroundService.stop();
    }
  } catch {
    // ignore
  }

  if (workError) throw workError;
}

export async function updateQueueKeepAliveNotification(
  remaining?: number,
): Promise<void> {
  if (Platform.OS !== 'android' || !BackgroundService?.isRunning()) return;
  const left = remaining ?? 0;
  try {
    await BackgroundService.updateNotification({
      taskDesc:
        left <= 0
          ? 'Finalizando…'
          : left === 1
            ? 'Gravando seu pedido…'
            : `Processando fila (${left} pedidos)…`,
    });
  } catch {
    // ignore
  }
}

export async function stopQueueKeepAlive(): Promise<void> {
  if (Platform.OS !== 'android' || !BackgroundService) return;
  if (!BackgroundService.isRunning()) return;
  try {
    await BackgroundService.stop();
  } catch {
    // ignore
  }
}

export function isQueueKeepAliveRunning(): boolean {
  return Boolean(BackgroundService?.isRunning());
}
