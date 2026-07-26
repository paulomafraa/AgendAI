import type { IntentReminderSeries, ReminderSeries } from './reminders';

export type { IntentReminderSeries, ReminderSeries } from './reminders';

export type InputSource = 'voice' | 'text';

export type IntentAction =
  | 'create_task'
  | 'complete_task'
  | 'delete_task'
  | 'set_task_due'
  | 'create_event'
  | 'reschedule_event'
  | 'list_tasks'
  | 'unknown';

/** One actionable item extracted from a user message (may be many per message). */
export type IntentItem = {
  action: IntentAction;
  title: string;
  notes?: string;
  /** ISO date-time when relevant (events / timed reminders) */
  datetime?: string;
  /** Deadline for tasks (ISO date or datetime; time is ignored on Google Tasks) */
  dueDate?: string;
  durationMinutes?: number;
  wantsReminder?: boolean;
  /** Minutes before event for reminder (default 30). */
  reminderMinutes?: number;
  /**
   * Recurrence in simple form for the model, e.g. "weekly:MO" or full RRULE.
   * Applied when creating Google Calendar events.
   */
  recurrence?: string;
  /** Soft category for organization, e.g. compras, casa, trabalho */
  category?: string;
  /** Local do evento (estilo Google Calendar) */
  location?: string;
  /**
   * Início da transmissão / pré-jogo / cobertura na TV (ISO),
   * quando diferente do horário principal do evento.
   */
  broadcastStartAt?: string;
  /** Evento de dia inteiro */
  allDay?: boolean;
  /**
   * true se o usuário disse horário de relógio.
   * false/omitido + só data → compromisso soft às 13h.
   */
  timeExplicit?: boolean;
  /** Horário default sugerido (13h) sem o usuário ter falado a hora. */
  softTime?: boolean;
  /** Série de lembretes repetidos no mesmo item (agrupados). */
  reminderSeries?: IntentReminderSeries;
  confidence: number;
};

/** Full AI interpretation of one user message. */
export type ParsedBatch = {
  items: IntentItem[];
  summary: string;
  rawInput: string;
};

/** @deprecated single-intent shape - prefer IntentItem inside ParsedBatch */
export type ParsedIntent = IntentItem & { summary: string; rawInput: string };

export type TodoItem = {
  id: string;
  title: string;
  notes?: string;
  category?: string;
  /** Prazo / deadline (ISO). Google Tasks usa só a data. */
  dueAt?: string;
  done: boolean;
  createdAt: string;
  completedAt?: string;
  source: InputSource;
  googleTaskId?: string;
  /** Lembretes repetidos agrupados (1 tarefa, vários avisos). */
  reminderSeries?: ReminderSeries;
  localNotificationIds?: string[];
};

export type CalendarEventItem = {
  id: string;
  title: string;
  notes?: string;
  category?: string;
  location?: string;
  allDay?: boolean;
  startAt: string;
  endAt: string;
  /**
   * Início da transmissão / pré (ISO), se a cobertura começa antes
   * do horário principal (ex.: F1, futebol na TV).
   */
  broadcastStartAt?: string;
  wantsReminder: boolean;
  reminderMinutes?: number;
  /**
   * Compromisso só com data: horário default 13h.
   * Não marca como “já passou” só por cruzar 13h; pergunta se fez ou quer remarcar.
   */
  softTime?: boolean;
  /** Usuário confirmou horário explícito ou resolveu o check das 13h. */
  softResolved?: boolean;
  /** RRULE string without prefix, or full "RRULE:..." */
  recurrence?: string;
  createdAt: string;
  source: InputSource;
  googleEventId?: string;
  /** ID principal do aviso local (primeiro agendado). */
  localNotificationId?: string;
  /** Todos os avisos locais deste evento (antes + no horário). */
  localNotificationIds?: string[];
};

export type HistoryEntry = {
  id: string;
  createdAt: string;
  source: InputSource;
  rawInput: string;
  summary: string;
  action: IntentAction | 'batch';
  success: boolean;
  detail?: string;
};

export type AiProviderId = 'gemini' | 'openai' | 'anthropic' | 'unknown';

export type AppSettings = {
  confirmBeforeSave: boolean;
  aiApiKey: string;
  googleWebClientId: string;
  googleConnected: boolean;
  syncToGoogle: boolean;
  /** Local notifications for events + morning brief */
  notificationsEnabled: boolean;
  /** Hour 0-23 for morning brief (default 8) */
  morningBriefHour: number;
  /** Toque dos lembretes de compromisso */
  reminderSound: 'default' | 'chime' | 'alert' | 'none';
};

export type PendingAction = {
  batch: ParsedBatch;
  source: InputSource;
};

export type UndoSnapshot = {
  id: string;
  label: string;
  todos: TodoItem[];
  events: CalendarEventItem[];
  expiresAt: number;
};

export type QueuedInput = {
  id: string;
  text: string;
  source: InputSource;
  createdAt: string;
};

export type GoogleTokens = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  email?: string;
};
