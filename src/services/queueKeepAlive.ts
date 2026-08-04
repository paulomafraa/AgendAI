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

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Mantém o JS ativo no Android com foreground service + notificação,
 * enquanto a fila de pedidos é processada (mesmo se o usuário trocar de app).
 * Precisa ser iniciado ainda em primeiro plano (restrição do Android 12+).
 */
export async function startQueueKeepAlive(remainingHint?: number): Promise<boolean> {
  if (Platform.OS !== 'android' || !BackgroundService) return false;
  if (BackgroundService.isRunning()) {
    await updateQueueKeepAliveNotification(remainingHint);
    return true;
  }

  const left = remainingHint && remainingHint > 0 ? remainingHint : 1;
  const options = {
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

  try {
    await BackgroundService.start(async (taskData) => {
      const delay = taskData?.delay ?? 1000;
      while (BackgroundService?.isRunning()) {
        await sleep(delay);
      }
    }, options);
    return true;
  } catch {
    return false;
  }
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
