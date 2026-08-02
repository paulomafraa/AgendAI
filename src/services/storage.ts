import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import type {
  AppSettings,
  CalendarEventItem,
  HistoryEntry,
  QueuedInput,
  TodoItem,
} from '../types';
import {
  clampText,
  isPlainObject,
  LIMITS,
} from '../utils/security';

const KEYS = {
  todos: '@agendai/todos',
  events: '@agendai/events',
  history: '@agendai/history',
  settings: '@agendai/settings',
  inputQueue: '@agendai/input_queue',
  dismissedGoogleEvents: '@agendai/dismissed_google_events',
  aiKey: 'agendai_ai_api_key',
  geminiKey: 'agendai_gemini_api_key',
  googleClientId: 'agendai_google_web_client_id',
} as const;

const defaultSettings: AppSettings = {
  confirmBeforeSave: false,
  aiApiKey: '',
  googleWebClientId: '',
  googleConnected: false,
  syncToGoogle: true,
  notificationsEnabled: true,
  morningBriefHour: 8,
  reminderSound: 'chime',
};

async function readJson<T>(key: string, fallback: T): Promise<T> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function sanitizeTodo(raw: unknown): TodoItem | null {
  if (!isPlainObject(raw)) return null;
  const id = clampText(raw.id, 80);
  const title = clampText(raw.title, LIMITS.title);
  if (!id || !title) return null;
  return {
    id,
    title,
    notes: clampText(raw.notes, LIMITS.notes) || undefined,
    category: clampText(raw.category, LIMITS.category) || undefined,
    dueAt: clampText(raw.dueAt, 40) || undefined,
    done: raw.done === true,
    createdAt: clampText(raw.createdAt, 40, new Date().toISOString()),
    completedAt: clampText(raw.completedAt, 40) || undefined,
    source: raw.source === 'voice' ? 'voice' : 'text',
    googleTaskId: clampText(raw.googleTaskId, 120) || undefined,
    reminderSeries:
      isPlainObject(raw.reminderSeries) &&
      typeof raw.reminderSeries.fromHour === 'number' &&
      typeof raw.reminderSeries.toHour === 'number' &&
      typeof raw.reminderSeries.intervalMinutes === 'number' &&
      /^\d{4}-\d{2}-\d{2}$/.test(String(raw.reminderSeries.dayKey ?? ''))
        ? {
            dayKey: String(raw.reminderSeries.dayKey),
            fromHour: Math.min(
              23,
              Math.max(0, Math.round(raw.reminderSeries.fromHour)),
            ),
            toHour: Math.min(
              23,
              Math.max(0, Math.round(raw.reminderSeries.toHour)),
            ),
            intervalMinutes: Math.max(
              15,
              Math.round(raw.reminderSeries.intervalMinutes),
            ),
            untilDone: raw.reminderSeries.untilDone !== false,
          }
        : undefined,
    localNotificationIds: Array.isArray(raw.localNotificationIds)
      ? raw.localNotificationIds
          .filter((x): x is string => typeof x === 'string')
          .slice(0, 48)
      : undefined,
  };
}

function sanitizeEvent(raw: unknown): CalendarEventItem | null {
  if (!isPlainObject(raw)) return null;
  const id = clampText(raw.id, 80);
  const title = clampText(raw.title, LIMITS.title);
  const startAt = clampText(raw.startAt, 40);
  const endAt = clampText(raw.endAt, 40);
  if (!id || !title || !startAt || !endAt) return null;
  return {
    id,
    title,
    notes: clampText(raw.notes, LIMITS.notes) || undefined,
    category: clampText(raw.category, LIMITS.category) || undefined,
    location: clampText(raw.location, LIMITS.location) || undefined,
    allDay: raw.allDay === true || undefined,
    startAt,
    endAt,
    broadcastStartAt: clampText(raw.broadcastStartAt, 40) || undefined,
    wantsReminder: raw.wantsReminder === true,
    reminderMinutes:
      typeof raw.reminderMinutes === 'number'
        ? Math.min(24 * 60, Math.max(0, Math.round(raw.reminderMinutes)))
        : undefined,
    softTime: raw.softTime === true || undefined,
    softResolved: raw.softResolved === true || undefined,
    recurrence: clampText(raw.recurrence, 180) || undefined,
    createdAt: clampText(raw.createdAt, 40, new Date().toISOString()),
    source: raw.source === 'voice' ? 'voice' : 'text',
    googleEventId: clampText(raw.googleEventId, 120) || undefined,
    localNotificationId: clampText(raw.localNotificationId, 120) || undefined,
    localNotificationIds: Array.isArray(raw.localNotificationIds)
      ? raw.localNotificationIds
          .filter((x): x is string => typeof x === 'string')
          .slice(0, 16)
      : undefined,
  };
}

export async function loadTodos(): Promise<TodoItem[]> {
  const raw = await readJson<unknown>(KEYS.todos, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .map(sanitizeTodo)
    .filter((t): t is TodoItem => Boolean(t))
    .slice(0, LIMITS.todos);
}

export async function saveTodos(todos: TodoItem[]): Promise<void> {
  await AsyncStorage.setItem(
    KEYS.todos,
    JSON.stringify(todos.slice(0, LIMITS.todos)),
  );
}

export async function loadEvents(): Promise<CalendarEventItem[]> {
  const raw = await readJson<unknown>(KEYS.events, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .map(sanitizeEvent)
    .filter((e): e is CalendarEventItem => Boolean(e))
    .slice(0, LIMITS.events);
}

export async function saveEvents(events: CalendarEventItem[]): Promise<void> {
  await AsyncStorage.setItem(
    KEYS.events,
    JSON.stringify(events.slice(0, LIMITS.events)),
  );
}

export async function loadHistory(): Promise<HistoryEntry[]> {
  const raw = await readJson<unknown>(KEYS.history, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isPlainObject)
    .map((h) => ({
      id: clampText(h.id, 80, `${Date.now()}`),
      createdAt: clampText(h.createdAt, 40, new Date().toISOString()),
      source: h.source === 'voice' ? ('voice' as const) : ('text' as const),
      rawInput: clampText(h.rawInput, LIMITS.userInput),
      summary: clampText(h.summary, 240),
      action: (clampText(h.action, 40, 'unknown') ||
        'unknown') as HistoryEntry['action'],
      success: h.success === true,
      detail: clampText(h.detail, LIMITS.historyDetail) || undefined,
    }))
    .slice(0, LIMITS.history);
}

export async function saveHistory(history: HistoryEntry[]): Promise<void> {
  await AsyncStorage.setItem(
    KEYS.history,
    JSON.stringify(history.slice(0, LIMITS.history)),
  );
}

export async function loadInputQueue(): Promise<QueuedInput[]> {
  const raw = await readJson<unknown>(KEYS.inputQueue, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isPlainObject)
    .map((q) => ({
      id: clampText(q.id, 80, `${Date.now()}`),
      text: clampText(q.text, LIMITS.userInput),
      source: q.source === 'voice' ? ('voice' as const) : ('text' as const),
      createdAt: clampText(q.createdAt, 40, new Date().toISOString()),
    }))
    .filter((q) => q.text.length > 0)
    .slice(0, LIMITS.queueSize);
}

export async function saveInputQueue(queue: QueuedInput[]): Promise<void> {
  await AsyncStorage.setItem(
    KEYS.inputQueue,
    JSON.stringify(queue.slice(0, LIMITS.queueSize)),
  );
}

/** IDs do Calendar que o usuário removeu só no app (não reimportar). */
export async function loadDismissedGoogleEventIds(): Promise<string[]> {
  const raw = await readJson<unknown>(KEYS.dismissedGoogleEvents, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((id): id is string => typeof id === 'string')
    .map((id) => clampText(id, 120))
    .filter(Boolean)
    .slice(0, LIMITS.dismissedGoogleEvents);
}

export async function saveDismissedGoogleEventIds(
  ids: string[],
): Promise<void> {
  const unique = [...new Set(ids.map((id) => clampText(id, 120)).filter(Boolean))];
  await AsyncStorage.setItem(
    KEYS.dismissedGoogleEvents,
    JSON.stringify(unique.slice(0, LIMITS.dismissedGoogleEvents)),
  );
}

export async function loadSettings(): Promise<AppSettings> {
  const base = await readJson<Record<string, unknown>>(KEYS.settings, {});
  let aiApiKey = '';
  let googleWebClientId = '';
  try {
    aiApiKey =
      (await SecureStore.getItemAsync(KEYS.aiKey)) ??
      (await SecureStore.getItemAsync(KEYS.geminiKey)) ??
      '';
    googleWebClientId =
      (await SecureStore.getItemAsync(KEYS.googleClientId)) ?? '';
  } catch {
    aiApiKey = '';
    googleWebClientId = '';
  }

  const legacyKey =
    typeof base.geminiApiKey === 'string' ? base.geminiApiKey : '';
  // Migra chave antiga fora do SecureStore e limpa do AsyncStorage
  if (legacyKey || 'geminiApiKey' in base) {
    const { geminiApiKey: _drop, ...rest } = base;
    void AsyncStorage.setItem(KEYS.settings, JSON.stringify(rest));
    if (legacyKey && !aiApiKey) {
      try {
        await SecureStore.setItemAsync(KEYS.aiKey, legacyKey);
        aiApiKey = legacyKey;
      } catch {
        // ignore
      }
    }
  }

  return {
    ...defaultSettings,
    confirmBeforeSave:
      typeof base.confirmBeforeSave === 'boolean'
        ? base.confirmBeforeSave
        : defaultSettings.confirmBeforeSave,
    googleConnected:
      typeof base.googleConnected === 'boolean'
        ? base.googleConnected
        : defaultSettings.googleConnected,
    syncToGoogle:
      typeof base.syncToGoogle === 'boolean'
        ? base.syncToGoogle
        : defaultSettings.syncToGoogle,
    notificationsEnabled:
      typeof base.notificationsEnabled === 'boolean'
        ? base.notificationsEnabled
        : defaultSettings.notificationsEnabled,
    morningBriefHour:
      typeof base.morningBriefHour === 'number'
        ? Math.min(23, Math.max(0, Math.round(base.morningBriefHour)))
        : defaultSettings.morningBriefHour,
    reminderSound:
      base.reminderSound === 'chime' ||
      base.reminderSound === 'alert' ||
      base.reminderSound === 'none' ||
      base.reminderSound === 'default'
        ? base.reminderSound === 'default'
          ? 'chime'
          : base.reminderSound
        : defaultSettings.reminderSound,
    aiApiKey: aiApiKey || legacyKey,
    googleWebClientId: clampText(googleWebClientId, 200),
  };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const { aiApiKey, googleWebClientId, ...rest } = settings;
  await AsyncStorage.setItem(KEYS.settings, JSON.stringify(rest));
  try {
    if (aiApiKey) {
      await SecureStore.setItemAsync(KEYS.aiKey, aiApiKey);
    } else {
      await SecureStore.deleteItemAsync(KEYS.aiKey);
    }
    await SecureStore.deleteItemAsync(KEYS.geminiKey);

    if (googleWebClientId.trim()) {
      await SecureStore.setItemAsync(
        KEYS.googleClientId,
        googleWebClientId.trim(),
      );
    } else {
      await SecureStore.deleteItemAsync(KEYS.googleClientId);
    }
  } catch {
    // ignore
  }
}
