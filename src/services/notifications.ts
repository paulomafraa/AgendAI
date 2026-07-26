import { Linking, Platform } from 'react-native';
import Constants from 'expo-constants';
import type { CalendarEventItem, TodoItem } from '../types';
import { expandReminderSeriesTimes } from '../utils/eventTime';

type NotificationsModule = typeof import('expo-notifications');
export type ReminderSoundId = 'default' | 'chime' | 'alert' | 'none';

let Notifications: NotificationsModule | null = null;
let nativeReady = false;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Notifications = require('expo-notifications') as NotificationsModule;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  nativeReady = true;
} catch {
  nativeReady = false;
  Notifications = null;
}

/** False no Dev APK antigo (sem rebuild após adicionar expo-notifications). */
export function areNotificationsNativeReady(): boolean {
  return nativeReady && Notifications != null;
}

export const REMINDER_SOUND_OPTIONS: Array<{
  id: ReminderSoundId;
  label: string;
  hint: string;
}> = [
  { id: 'chime', label: 'Suave', hint: 'Dois tons baixos (recomendado)' },
  { id: 'alert', label: 'Presente', hint: 'Três tons médios' },
  { id: 'default', label: 'Sistema', hint: 'Toque padrão do Android' },
  { id: 'none', label: 'Mudo', hint: 'Só banner, sem som' },
];

function channelIdForSound(sound: ReminderSoundId): string {
  // v3: novos WAVs mais graves; canal antigo no Android não troca o áudio
  return `agendai-alarms-v3-${sound}`;
}

/** Nome do arquivo embutido (plugin expo-notifications). */
function soundFileFor(sound: ReminderSoundId): string | boolean {
  switch (sound) {
    case 'alert':
      return 'alert.wav';
    case 'none':
      return false;
    case 'default':
      // "Sistema" no Android costuma ser agudo; usamos o suave embutido
      return 'chime.wav';
    case 'chime':
    default:
      return 'chime.wav';
  }
}

export async function ensureNotificationPermissions(): Promise<boolean> {
  if (!Notifications) return false;
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    const asked = await Notifications.requestPermissionsAsync();
    return asked.granted;
  } catch {
    return false;
  }
}

export async function ensureAndroidChannel(
  reminderSound: ReminderSoundId = 'default',
): Promise<void> {
  if (!Notifications || Platform.OS !== 'android') return;
  try {
    const sound = soundFileFor(reminderSound);
    await Notifications.setNotificationChannelAsync(
      channelIdForSound(reminderSound),
      {
        name:
          reminderSound === 'none'
            ? 'Alarmes AgendAI (mudo)'
            : reminderSound === 'alert'
              ? 'Alarmes AgendAI (presente)'
              : reminderSound === 'default'
                ? 'Alarmes AgendAI (suave)'
                : 'Alarmes AgendAI (suave)',
        importance: Notifications.AndroidImportance.MAX,
        sound: typeof sound === 'string' ? sound : sound ? 'default' : undefined,
        enableVibrate: reminderSound !== 'none',
        // Compromisso precisa furar silêncio do sistema quando o usuário pediu lembrete
        bypassDnd: reminderSound !== 'none',
        vibrationPattern:
          reminderSound === 'none'
            ? undefined
            : [0, 400, 200, 400, 200, 600],
        // Stream de ALARME (como o app Relógio), não de notificação comum
        audioAttributes: {
          usage: Notifications.AndroidAudioUsage.ALARM,
          contentType: Notifications.AndroidAudioContentType.SONIFICATION,
          flags: {
            enforceAudibility: true,
            requestHardwareAudioVideoSynchronization: false,
          },
        },
      },
    );
    await Notifications.setNotificationChannelAsync('agendai-brief', {
      name: 'Resumo AgendAI',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: 'default',
    });
  } catch {
    // nativo ausente neste build
  }
}

async function cancelScheduledByEventId(eventId: string): Promise<void> {
  if (!Notifications) return;
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter((n) => n.content.data?.eventId === eventId)
        .map((n) =>
          Notifications!.cancelScheduledNotificationAsync(n.identifier),
        ),
    );
  } catch {
    // ignore
  }
}

async function scheduleAtMs(params: {
  whenMs: number;
  title: string;
  body: string;
  eventId?: string;
  todoId?: string;
  kind:
    | 'event_reminder'
    | 'event_start'
    | 'soft_time_check'
    | 'task_series';
  reminderSound: ReminderSoundId;
}): Promise<string | undefined> {
  if (!Notifications) return undefined;

  const delaySec = Math.round((params.whenMs - Date.now()) / 1000);
  if (delaySec < 2) return undefined;

  const sound = soundFileFor(params.reminderSound);
  const channelId =
    Platform.OS === 'android'
      ? channelIdForSound(params.reminderSound)
      : undefined;

  const sticky =
    params.kind === 'event_start' || params.kind === 'soft_time_check';
  const content = {
    title: params.title,
    body: params.body,
    data: {
      eventId: params.eventId,
      todoId: params.todoId,
      kind: params.kind,
    },
    sound,
    interruptionLevel: 'timeSensitive' as const,
    ...(Platform.OS === 'android'
      ? {
          sticky,
          autoDismiss: !sticky,
          vibrate:
            params.reminderSound === 'none'
              ? []
              : [0, 400, 200, 400, 200, 600],
          ...(Notifications.AndroidNotificationPriority
            ? {
                priority: Notifications.AndroidNotificationPriority.MAX,
              }
            : { priority: 'max' }),
          color: '#0F766E',
        }
      : {}),
  };

  try {
    if (delaySec <= 15 * 60) {
      return await Notifications.scheduleNotificationAsync({
        content,
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: delaySec,
          repeats: false,
          channelId,
        },
      });
    }

    return await Notifications.scheduleNotificationAsync({
      content,
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(params.whenMs),
        channelId,
      },
    });
  } catch {
    return undefined;
  }
}

async function cancelScheduledByTodoId(todoId: string): Promise<void> {
  if (!Notifications) return;
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter((n) => n.content.data?.todoId === todoId)
        .map((n) =>
          Notifications!.cancelScheduledNotificationAsync(n.identifier),
        ),
    );
  } catch {
    // ignore
  }
}

/**
 * Agenda avisos locais no estilo Google Calendar:
 * 1) X min antes (se ainda der tempo)
 * 2) no horário de início do compromisso
 *
 * Sem Google conectado, o Android AlarmManager + canal de notificação
 * é o caminho embutido (não usa e-mail).
 */
export async function scheduleEventReminder(
  event: CalendarEventItem,
  reminderSound: ReminderSoundId = 'default',
): Promise<string | undefined> {
  if (!Notifications || !event.wantsReminder) return undefined;

  const now = Date.now();
  const startMs = new Date(event.startAt).getTime();
  if (startMs <= now + 1_500) return undefined;

  const ok = await ensureNotificationPermissions();
  if (!ok) return undefined;

  await ensureAndroidChannel(reminderSound);
  await cancelScheduledByEventId(event.id);
  if (event.localNotificationId) {
    await cancelLocalNotification(event.localNotificationId);
  }
  for (const id of event.localNotificationIds ?? []) {
    await cancelLocalNotification(id);
  }

  const minutes = event.reminderMinutes ?? 30;
  const ids: string[] = [];

  // Aviso antecipado
  let reminderMs = startMs - minutes * 60_000;
  if (minutes > 0 && reminderMs > now + 2_000) {
    const minsLeft = Math.max(
      1,
      Math.round((startMs - reminderMs) / 60_000),
    );
    const id = await scheduleAtMs({
      whenMs: reminderMs,
      title: 'Lembrete AgendAI',
      body:
        minsLeft === 1
          ? `${event.title} em 1 min`
          : `${event.title} em ${minsLeft} min`,
      eventId: event.id,
      kind: 'event_reminder',
      reminderSound,
    });
    if (id) ids.push(id);
  } else if (startMs > now + 8_000) {
    // Janela "X min antes" já passou: avisa em breve, como o Calendar
    // quando o lembrete cai no passado mas o evento ainda é futuro.
    const id = await scheduleAtMs({
      whenMs: now + 3_000,
      title: 'Lembrete AgendAI',
      body: `${event.title} em breve`,
      eventId: event.id,
      kind: 'event_reminder',
      reminderSound,
    });
    if (id) ids.push(id);
  }

  // No horário
  if (event.softTime) {
    const softId = await scheduleAtMs({
      whenMs: startMs,
      title: 'AgendAI',
      body: `${event.title}: já fez, ou quer marcar para mais tarde hoje?`,
      eventId: event.id,
      kind: 'soft_time_check',
      reminderSound,
    });
    if (softId) ids.push(softId);
  } else {
    const startId = await scheduleAtMs({
      whenMs: startMs,
      title: 'AgendAI',
      body: `${event.title} começa agora`,
      eventId: event.id,
      kind: 'event_start',
      reminderSound,
    });
    if (startId) ids.push(startId);
  }

  return ids[0];
}

/** Série agrupada: vários avisos, uma só tarefa. */
export async function scheduleTaskReminderSeries(
  todo: TodoItem,
  reminderSound: ReminderSoundId = 'default',
): Promise<string[]> {
  if (!Notifications || !todo.reminderSeries || todo.done) return [];

  const ok = await ensureNotificationPermissions();
  if (!ok) return [];
  await ensureAndroidChannel(reminderSound);
  await cancelScheduledByTodoId(todo.id);
  for (const id of todo.localNotificationIds ?? []) {
    await cancelLocalNotification(id);
  }

  const series = todo.reminderSeries;
  const times = expandReminderSeriesTimes(
    series.dayKey,
    series.fromHour,
    series.toHour,
    series.intervalMinutes,
  );
  const now = Date.now();
  const ids: string[] = [];
  for (const whenMs of times) {
    if (whenMs <= now + 2_000) continue;
    const id = await scheduleAtMs({
      whenMs,
      title: 'Lembrete AgendAI',
      body: `Ainda pendente: ${todo.title}`,
      todoId: todo.id,
      kind: 'task_series',
      reminderSound,
    });
    if (id) ids.push(id);
  }
  return ids;
}

export async function cancelTodoLocalNotifications(
  todo: Pick<TodoItem, 'id' | 'localNotificationIds'>,
): Promise<void> {
  await cancelScheduledByTodoId(todo.id);
  for (const id of todo.localNotificationIds ?? []) {
    await cancelLocalNotification(id);
  }
}

/** Reagenda séries de lembretes de tarefas abertas. */
export async function resyncTaskReminderSeries(
  todos: TodoItem[],
  reminderSound: ReminderSoundId,
  enabled: boolean,
): Promise<TodoItem[]> {
  if (!Notifications || !enabled) return todos;
  const next: TodoItem[] = [];
  for (const todo of todos) {
    if (!todo.reminderSeries || todo.done) {
      next.push(todo);
      continue;
    }
    const ids = await scheduleTaskReminderSeries(todo, reminderSound);
    next.push({
      ...todo,
      localNotificationIds: ids.length > 0 ? ids : undefined,
    });
  }
  return next;
}

/** Reagenda lembretes de todos os eventos futuros (após abrir o app). */
export async function resyncUpcomingReminders(
  events: CalendarEventItem[],
  reminderSound: ReminderSoundId,
  enabled: boolean,
): Promise<CalendarEventItem[]> {
  if (!Notifications || !enabled) return events;
  const now = Date.now();
  const next: CalendarEventItem[] = [];
  for (const event of events) {
    if (!event.wantsReminder || new Date(event.startAt).getTime() <= now + 1_500) {
      next.push(event);
      continue;
    }
    const id = await scheduleEventReminder(event, reminderSound);
    next.push(
      id
        ? { ...event, localNotificationId: id }
        : { ...event, localNotificationId: undefined },
    );
  }
  return next;
}

export async function cancelLocalNotification(
  notificationId?: string,
): Promise<void> {
  if (!Notifications || !notificationId) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  } catch {
    // ignore
  }
}

export async function cancelEventLocalNotifications(
  event: Pick<CalendarEventItem, 'id' | 'localNotificationId' | 'localNotificationIds'>,
): Promise<void> {
  await cancelScheduledByEventId(event.id);
  await cancelLocalNotification(event.localNotificationId);
  for (const id of event.localNotificationIds ?? []) {
    await cancelLocalNotification(id);
  }
}

export async function scheduleMorningBrief(params: {
  enabled: boolean;
  hour: number;
  openTasks: number;
  todayEvents: number;
}): Promise<void> {
  if (!Notifications) return;
  try {
    await ensureAndroidChannel('default');
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter((n) => n.content.data?.kind === 'morning_brief')
        .map((n) =>
          Notifications!.cancelScheduledNotificationAsync(n.identifier),
        ),
    );

    if (!params.enabled) return;
    const ok = await ensureNotificationPermissions();
    if (!ok) return;

    const hour = Math.min(23, Math.max(0, Math.round(params.hour)));

    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Bom dia · AgendAI',
        body: `Hoje: ${params.openTasks} tarefa(s) aberta(s) e ${params.todayEvents} evento(s).`,
        data: { kind: 'morning_brief' },
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour,
        minute: 0,
        channelId: Platform.OS === 'android' ? 'agendai-brief' : undefined,
      },
    });
  } catch {
    // ignore until Dev APK is rebuilt
  }
}

/** Abre a tela de canais de notificação do app (Android). */
export async function openReminderChannelSettings(
  reminderSound: ReminderSoundId = 'default',
): Promise<void> {
  if (Platform.OS !== 'android') return;
  const pkg = Constants.expoConfig?.android?.package ?? 'com.agendai.app';
  const channel = channelIdForSound(reminderSound);
  try {
    await Linking.sendIntent(
      'android.settings.CHANNEL_NOTIFICATION_SETTINGS',
      [
        { key: 'android.provider.extra.APP_PACKAGE', value: pkg },
        { key: 'android.provider.extra.CHANNEL_ID', value: channel },
      ],
    );
  } catch {
    try {
      await Linking.openSettings();
    } catch {
      // ignore
    }
  }
}

/** Ajuda em OEMs que matam alarmes em segundo plano. */
export async function openAppNotificationSettings(): Promise<void> {
  try {
    await Linking.openSettings();
  } catch {
    // ignore
  }
}

export function countTodayEvents(events: CalendarEventItem[]): number {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return events.filter((e) => {
    const t = new Date(e.startAt).getTime();
    return t >= start.getTime() && t <= end.getTime();
  }).length;
}

export function countOpenTasks(todos: TodoItem[]): number {
  return todos.filter((t) => !t.done).length;
}
