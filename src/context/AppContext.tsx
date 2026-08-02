import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { parseUserIntent } from '../services/ai';
import {
  completeTaskOnGoogle,
  deleteTaskOnGoogle,
  fetchGoogleCalendarEvents,
  fetchGoogleTaskStatuses,
  loadGoogleTokens,
  mergeGoogleCalendarEvents,
  mergeGoogleTaskStatuses,
  pushEventToGoogle,
  pushTaskToGoogle,
  updateTaskOnGoogle,
} from '../services/google';
import {
  cancelEventLocalNotifications,
  cancelTodoLocalNotifications,
  countOpenTasks,
  countTodayEvents,
  ensureAndroidChannel,
  resyncUpcomingReminders,
  scheduleEventReminder,
  scheduleMorningBrief,
  scheduleTaskReminderSeries,
  resyncTaskReminderSeries,
} from '../services/notifications';
import {
  loadEvents,
  loadHistory,
  loadInputQueue,
  loadDismissedGoogleEventIds,
  loadSettings,
  loadTodos,
  saveEvents,
  saveHistory,
  saveInputQueue,
  saveDismissedGoogleEventIds,
  saveSettings,
  saveTodos,
} from '../services/storage';
import {
  isLikelyNetworkError,
  isOnline,
  onAppBecameActive,
} from '../services/network';
import { syncWidgetsFromData } from '../widgets/refresh';
import { formatDueDatePtBr } from '../services/ai/shared';
import {
  atHourSaoPaulo,
  dayKeySaoPaulo,
  needsSoftTimePrompt,
  todayKeySaoPaulo,
} from '../utils/eventTime';
import { findMatchingTodo } from '../utils/matchTodo';
import { UNDO_WINDOW_MS } from '../constants/undo';
import type {
  AppSettings,
  CalendarEventItem,
  HistoryEntry,
  InputSource,
  IntentItem,
  ParsedBatch,
  PendingAction,
  QueuedInput,
  ReminderSeries,
  TodoItem,
  UndoSnapshot,
} from '../types';

function id(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

type AppContextValue = {
  ready: boolean;
  todos: TodoItem[];
  events: CalendarEventItem[];
  history: HistoryEntry[];
  settings: AppSettings;
  pending: PendingAction | null;
  busy: boolean;
  error: string | null;
  lastSyncNote: string | null;
  queuedCount: number;
  queueProcessing: boolean;
  clearError: () => void;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  submitInput: (text: string, source: InputSource) => Promise<void>;
  confirmPending: () => Promise<void>;
  cancelPending: () => void;
  toggleTodoDone: (todoId: string) => Promise<void>;
  setTodoDue: (todoId: string, dueAt: string | null) => Promise<void>;
  deleteTodo: (todoId: string) => Promise<void>;
  deleteEvent: (eventId: string) => Promise<void>;
  refreshGoogleStatus: () => Promise<void>;
  syncTasksFromGoogle: () => Promise<void>;
  syncEventsFromGoogle: () => Promise<void>;
  /** Envia eventos locais → Agenda e puxa Calendar (apaga no app só o que sumiu no Google). */
  syncAgendaWithGoogle: () => Promise<void>;
  undoSnapshot: UndoSnapshot | null;
  undoLastChange: () => Promise<void>;
  shareOpenTasks: (category?: string) => Promise<void>;
  softPromptEvent: CalendarEventItem | null;
  resolveSoftTimeDone: (eventId: string) => Promise<void>;
  resolveSoftTimeReschedule: (eventId: string, hour: number) => Promise<void>;
  dismissSoftTimePrompt: () => void;
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [events, setEvents] = useState<CalendarEventItem[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [settings, setSettings] = useState<AppSettings>({
    confirmBeforeSave: false,
    aiApiKey: '',
    googleWebClientId: '',
    googleConnected: false,
    syncToGoogle: true,
    notificationsEnabled: true,
    morningBriefHour: 8,
    reminderSound: 'chime',
  });
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncNote, setLastSyncNote] = useState<string | null>(null);
  const [undoSnapshot, setUndoSnapshot] = useState<UndoSnapshot | null>(null);
  const [inputQueue, setInputQueue] = useState<QueuedInput[]>([]);
  const inputQueueRef = useRef<QueuedInput[]>([]);
  const drainingQueueRef = useRef(false);
  const [queueProcessing, setQueueProcessing] = useState(false);
  const [softPromptEvent, setSoftPromptEvent] =
    useState<CalendarEventItem | null>(null);
  const softSnoozeRef = useRef<Set<string>>(new Set());
  const eventsRef = useRef<CalendarEventItem[]>([]);
  const softPromptIdRef = useRef<string | null>(null);
  const dismissedGoogleIdsRef = useRef<string[]>([]);
  const syncAgendaWithGoogleRef = useRef<
    ((opts?: { quiet?: boolean }) => Promise<void>) | null
  >(null);

  useEffect(() => {
    inputQueueRef.current = inputQueue;
  }, [inputQueue]);

  useEffect(() => {
    eventsRef.current = events;
  }, [events]);

  useEffect(() => {
    softPromptIdRef.current = softPromptEvent?.id ?? null;
  }, [softPromptEvent]);

  // Feedback curto some sozinho (não fica eterno na tela)
  useEffect(() => {
    if (!lastSyncNote) return;
    const t = setTimeout(() => setLastSyncNote(null), 4500);
    return () => clearTimeout(t);
  }, [lastSyncNote]);

  // Mantém widgets da tela inicial alinhados com tarefas/eventos
  useEffect(() => {
    if (!ready) return;
    void syncWidgetsFromData(todos, events);
  }, [ready, todos, events]);

  const refreshGoogleStatus = useCallback(async () => {
    const tokens = await loadGoogleTokens();
    setSettings((prev) => {
      const next = { ...prev, googleConnected: Boolean(tokens?.accessToken) };
      void saveSettings(next);
      return next;
    });
  }, []);

  const syncTasksFromGoogle = useCallback(async () => {
    const tokens = await loadGoogleTokens();
    if (!tokens?.accessToken) return;

    const remote = await fetchGoogleTaskStatuses();
    if (!remote.ok) return;

    setTodos((prev) => {
      const { todos: next, changed } = mergeGoogleTaskStatuses(prev, remote.items);
      if (changed > 0) {
        void saveTodos(next);
        setLastSyncNote(
          changed === 1
            ? '1 tarefa atualizada a partir do Google Tasks.'
            : `${changed} tarefas atualizadas a partir do Google Tasks.`,
        );
      }
      return changed > 0 ? next : prev;
    });
  }, []);

  const syncEventsFromGoogle = useCallback(async () => {
    await syncAgendaWithGoogleRef.current?.({ quiet: true });
  }, []);

  const syncAgendaWithGoogle = useCallback(
    async (opts?: { quiet?: boolean }) => {
      const tokens = await loadGoogleTokens();
      if (!tokens?.accessToken) {
        if (!opts?.quiet) {
          setLastSyncNote('Conecte o Google em Ajustes para sincronizar a agenda.');
        }
        return;
      }

      // 1) Eventos só do app → sempre vão para a Agenda (nunca apaga no Google)
      let working = eventsRef.current;
      let pushed = 0;
      let pushFail = 0;
      for (const ev of working.filter((e) => !e.googleEventId)) {
        const sync = await pushEventToGoogle(ev);
        if (sync.ok && sync.remoteId) {
          pushed += 1;
          working = working.map((e) =>
            e.id === ev.id ? { ...e, googleEventId: sync.remoteId } : e,
          );
        } else {
          pushFail += 1;
        }
      }
      if (pushed > 0) {
        setEvents(working);
        void saveEvents(working);
      }

      // 2) Puxa Calendar: importa novos, atualiza ligados, remove do app o que sumiu no Google
      const remote = await fetchGoogleCalendarEvents();
      if (!remote.ok) {
        if (!opts?.quiet) {
          setLastSyncNote(remote.message);
        }
        return;
      }

      const { events: next, changed, removed, clearedDismissedIds } =
        mergeGoogleCalendarEvents(working, remote.items, {
          windowStartMs: remote.windowStartMs,
          windowEndMs: remote.windowEndMs,
          dismissedGoogleEventIds: dismissedGoogleIdsRef.current,
        });
      for (const gone of removed) {
        await cancelEventLocalNotifications(gone);
        softSnoozeRef.current.delete(gone.id);
        if (softPromptIdRef.current === gone.id) setSoftPromptEvent(null);
      }
      if (clearedDismissedIds.length > 0) {
        const clearSet = new Set(clearedDismissedIds);
        dismissedGoogleIdsRef.current = dismissedGoogleIdsRef.current.filter(
          (id) => !clearSet.has(id),
        );
        void saveDismissedGoogleEventIds(dismissedGoogleIdsRef.current);
      }
      if (changed > 0 || pushed > 0) {
        setEvents(next);
        void saveEvents(next);
      }

      if (opts?.quiet && changed === 0 && pushed === 0) return;

      const parts: string[] = [];
      if (pushed > 0) {
        parts.push(
          pushed === 1
            ? '1 evento enviado à Agenda'
            : `${pushed} eventos enviados à Agenda`,
        );
      }
      if (removed.length > 0) {
        parts.push(
          removed.length === 1
            ? '1 compromisso removido (apagado no Calendar)'
            : `${removed.length} compromissos removidos (apagados no Calendar)`,
        );
      }
      const importedOrUpdated = Math.max(0, changed - removed.length);
      if (importedOrUpdated > 0) {
        parts.push(
          importedOrUpdated === 1
            ? '1 evento atualizado do Calendar'
            : `${importedOrUpdated} eventos atualizados do Calendar`,
        );
      }
      if (pushFail > 0) {
        parts.push(
          pushFail === 1
            ? '1 evento local não foi enviado'
            : `${pushFail} eventos locais não foram enviados`,
        );
      }
      setLastSyncNote(
        parts.length > 0 ? parts.join(' · ') : 'Agenda já estava sincronizada.',
      );
    },
    [],
  );

  syncAgendaWithGoogleRef.current = syncAgendaWithGoogle;

  const syncingRef = useRef(false);
  useEffect(() => {
    const onAppState = (state: AppStateStatus) => {
      if (state !== 'active' || syncingRef.current) return;
      syncingRef.current = true;
      void (async () => {
        try {
          await syncTasksFromGoogle();
          await syncEventsFromGoogle();
        } finally {
          syncingRef.current = false;
        }
      })();
    };
    const sub = AppState.addEventListener('change', onAppState);
    return () => sub.remove();
  }, [syncTasksFromGoogle, syncEventsFromGoogle]);

  useEffect(() => {
    (async () => {
      const [t, e, h, s, q, dismissed] = await Promise.all([
        loadTodos(),
        loadEvents(),
        loadHistory(),
        loadSettings(),
        loadInputQueue(),
        loadDismissedGoogleEventIds(),
      ]);
      const tokens = await loadGoogleTokens();
      setTodos(t);
      setEvents(e);
      setHistory(h);
      setInputQueue(q);
      dismissedGoogleIdsRef.current = dismissed;
      setSettings({ ...s, googleConnected: Boolean(tokens?.accessToken) });
      setReady(true);
      if (s.notificationsEnabled) {
        void (async () => {
          const syncedEvents = await resyncUpcomingReminders(
            e,
            s.reminderSound ?? 'default',
            true,
          );
          setEvents(syncedEvents);
          void saveEvents(syncedEvents);
          const syncedTodos = await resyncTaskReminderSeries(
            t,
            s.reminderSound ?? 'default',
            true,
          );
          setTodos(syncedTodos);
          void saveTodos(syncedTodos);
        })();
      }
      if (tokens?.accessToken) {
        void syncTasksFromGoogle();
        void syncEventsFromGoogle();
      }
    })();
  }, [syncTasksFromGoogle, syncEventsFromGoogle]);

  const persistHistory = useCallback(async (entry: HistoryEntry) => {
    setHistory((prev) => {
      const next = [entry, ...prev].slice(0, 200);
      void saveHistory(next);
      return next;
    });
  }, []);

  const applyItem = useCallback(
    async (
      item: IntentItem,
      source: InputSource,
      rawInput: string,
      shouldSync: boolean,
      currentTodos: TodoItem[],
    ): Promise<{ detail: string; success: boolean; todos: TodoItem[] }> => {
      const createdAt = new Date().toISOString();

      if (item.action === 'create_task') {
        const dueAt = item.dueDate
          ? new Date(item.dueDate).toISOString()
          : undefined;
        let reminderSeries: ReminderSeries | undefined;
        if (item.reminderSeries) {
          const dayKey =
            item.reminderSeries.dayKey ??
            (dueAt ? dayKeySaoPaulo(dueAt) : todayKeySaoPaulo());
          reminderSeries = {
            dayKey,
            fromHour: item.reminderSeries.fromHour,
            toHour: item.reminderSeries.toHour,
            intervalMinutes: item.reminderSeries.intervalMinutes,
            untilDone: item.reminderSeries.untilDone !== false,
          };
        }
        let todo: TodoItem = {
          id: id(),
          title: item.title,
          notes: item.notes,
          category: item.category,
          dueAt,
          done: false,
          createdAt,
          source,
          reminderSeries,
        };
        if (shouldSync) {
          const sync = await pushTaskToGoogle(todo);
          if (sync.ok && sync.remoteId) {
            todo = { ...todo, googleTaskId: sync.remoteId };
            setLastSyncNote(sync.message);
          } else if (!sync.ok) {
            setLastSyncNote(sync.message);
          }
        }
        if (reminderSeries && settings.notificationsEnabled) {
          const ids = await scheduleTaskReminderSeries(
            todo,
            settings.reminderSound,
          );
          if (ids.length > 0) {
            todo = { ...todo, localNotificationIds: ids };
            setLastSyncNote(
              `Série: ${ids.length} lembrete(s) das ${reminderSeries.fromHour}h às ${reminderSeries.toHour}h.`,
            );
          }
        }
        const nextTodos = [todo, ...currentTodos];
        setTodos(nextTodos);
        void saveTodos(nextTodos);
        const dueHint = dueAt ? ` · prazo ${formatDueDatePtBr(dueAt)}` : '';
        const seriesHint = reminderSeries
          ? ` · a cada ${reminderSeries.intervalMinutes} min (${reminderSeries.fromHour}h–${reminderSeries.toHour}h)`
          : '';
        return {
          detail: `${todo.title}${dueHint}${seriesHint}`,
          success: true,
          todos: nextTodos,
        };
      }

      if (item.action === 'set_task_due') {
        const match =
          findMatchingTodo(item.title, currentTodos) ??
          findMatchingTodo(rawInput, currentTodos);
        if (!match || !item.dueDate) {
          return {
            detail: 'Nenhuma tarefa para definir prazo',
            success: false,
            todos: currentTodos,
          };
        }
        const dueAt = new Date(item.dueDate).toISOString();
        const updated: TodoItem = { ...match, dueAt };
        const nextTodos = currentTodos.map((t) =>
          t.id === match.id ? updated : t,
        );
        setTodos(nextTodos);
        void saveTodos(nextTodos);
        if (shouldSync && updated.googleTaskId) {
          const sync = await updateTaskOnGoogle(updated);
          setLastSyncNote(sync.message);
        }
        return {
          detail: `${match.title} · prazo ${formatDueDatePtBr(dueAt)}`,
          success: true,
          todos: nextTodos,
        };
      }

      if (item.action === 'complete_task') {
        const match =
          findMatchingTodo(item.title, currentTodos) ??
          findMatchingTodo(rawInput, currentTodos);
        if (!match) {
          return {
            detail: 'Nenhuma tarefa correspondente',
            success: false,
            todos: currentTodos,
          };
        }
        const updated: TodoItem = {
          ...match,
          done: true,
          completedAt: createdAt,
        };
        await cancelTodoLocalNotifications(match);
        const nextTodos = currentTodos.map((t) =>
          t.id === match.id ? { ...updated, localNotificationIds: undefined } : t,
        );
        setTodos(nextTodos);
        void saveTodos(nextTodos);
        if (shouldSync && updated.googleTaskId) {
          const sync = await completeTaskOnGoogle(updated);
          setLastSyncNote(sync.message);
        }
        return { detail: match.title, success: true, todos: nextTodos };
      }

      if (item.action === 'delete_task') {
        const match =
          findMatchingTodo(item.title, currentTodos, { includeDone: true }) ??
          findMatchingTodo(rawInput, currentTodos, { includeDone: true });
        if (!match) {
          return {
            detail: 'Nenhuma tarefa para apagar',
            success: false,
            todos: currentTodos,
          };
        }
        await cancelTodoLocalNotifications(match);
        const nextTodos = currentTodos.filter((t) => t.id !== match.id);
        setTodos(nextTodos);
        void saveTodos(nextTodos);
        if (shouldSync && match.googleTaskId) {
          const sync = await deleteTaskOnGoogle(match);
          setLastSyncNote(sync.message);
        }
        return { detail: `Apagada: ${match.title}`, success: true, todos: nextTodos };
      }

      if (item.action === 'create_event') {
        const allDay = Boolean(item.allDay);
        const softTime =
          !allDay &&
          item.timeExplicit !== true &&
          item.softTime === true;
        let start = item.datetime
          ? new Date(item.datetime)
          : new Date(Date.now() + 60 * 60 * 1000);
        if (allDay) {
          start.setHours(12, 0, 0, 0);
        } else if (softTime) {
          const dayKey = dayKeySaoPaulo(
            item.datetime ?? start.toISOString(),
          );
          start = new Date(atHourSaoPaulo(dayKey, 13));
        }
        const duration = allDay
          ? 24 * 60
          : item.durationMinutes ?? 60;
        const end = new Date(start.getTime() + duration * 60 * 1000);
        const wantsReminder = item.wantsReminder ?? (Boolean(item.datetime) && !allDay);
        const minsUntilStart = Math.max(
          0,
          Math.round((start.getTime() - Date.now()) / 60_000),
        );
        let reminderMinutes = wantsReminder
          ? item.reminderMinutes ?? 30
          : undefined;
        // Evento em breve: 30 min antes já passou → avisa perto do horário
        if (
          wantsReminder &&
          reminderMinutes != null &&
          minsUntilStart > 0 &&
          reminderMinutes >= minsUntilStart
        ) {
          reminderMinutes = Math.max(0, minsUntilStart <= 2 ? 0 : 1);
        }
        let event: CalendarEventItem = {
          id: id(),
          title: item.title,
          notes: item.notes,
          category: item.category,
          location: item.location,
          allDay: allDay || undefined,
          startAt: start.toISOString(),
          endAt: end.toISOString(),
          broadcastStartAt: item.broadcastStartAt,
          wantsReminder,
          reminderMinutes,
          softTime: softTime || undefined,
          recurrence: item.recurrence,
          createdAt,
          source,
        };
        if (shouldSync) {
          const sync = await pushEventToGoogle(event);
          if (sync.ok && sync.remoteId) {
            event = { ...event, googleEventId: sync.remoteId };
            setLastSyncNote(sync.message);
          } else if (!sync.ok) {
            setLastSyncNote(sync.message);
          }
        }
        if (wantsReminder && settings.notificationsEnabled) {
          const notifId = await scheduleEventReminder(
            event,
            settings.reminderSound,
          );
          if (notifId) {
            event = { ...event, localNotificationId: notifId };
            setLastSyncNote('Lembrete programado no celular.');
          } else {
            setLastSyncNote(
              'Não deu para programar o lembrete. Em Ajustes, confira notificação e alarme do AgendAI.',
            );
          }
        }
        setEvents((prev) => {
          const next = [event, ...prev];
          void saveEvents(next);
          return next;
        });
        const reminderHint =
          wantsReminder && reminderMinutes != null
            ? ` · lembrete ${reminderMinutes} min`
            : '';
        const softHint = softTime ? ' · horário sugerido 13:00' : '';
        const recurHint = item.recurrence ? ' · recorrente' : '';
        const locHint = item.location ? ` · ${item.location}` : '';
        const dayHint = allDay ? ' · dia inteiro' : '';
        return {
          detail: `${event.title} · ${allDay ? start.toLocaleDateString('pt-BR') : start.toLocaleString('pt-BR')}${dayHint}${softHint}${locHint}${reminderHint}${recurHint}`,
          success: true,
          todos: currentTodos,
        };
      }

      if (item.action === 'reschedule_event') {
        const needle = item.title.toLowerCase();
        let updatedEvent: CalendarEventItem | undefined;
        setEvents((prev) => {
          const match = prev.find(
            (e) =>
              e.title.toLowerCase().includes(needle) ||
              needle.includes(e.title.toLowerCase()),
          );
          if (!match || !item.datetime) return prev;
          const start = new Date(item.datetime);
          const duration =
            item.durationMinutes ??
            Math.max(
              30,
              Math.round(
                (new Date(match.endAt).getTime() -
                  new Date(match.startAt).getTime()) /
                  60_000,
              ),
            );
          const end = new Date(start.getTime() + duration * 60_000);
          updatedEvent = {
            ...match,
            startAt: start.toISOString(),
            endAt: end.toISOString(),
            reminderMinutes:
              item.reminderMinutes ?? match.reminderMinutes ?? 30,
            wantsReminder: item.wantsReminder ?? match.wantsReminder,
            softTime: undefined,
            softResolved: true,
          };
          const next = prev.map((e) =>
            e.id === match.id ? (updatedEvent as CalendarEventItem) : e,
          );
          void saveEvents(next);
          return next;
        });
        if (!updatedEvent) {
          return {
            detail: 'Nenhum evento para remarcar',
            success: false,
            todos: currentTodos,
          };
        }
        await cancelEventLocalNotifications(updatedEvent);
        if (updatedEvent.wantsReminder && settings.notificationsEnabled) {
          const notifId = await scheduleEventReminder(
            updatedEvent,
            settings.reminderSound,
          );
          if (notifId) {
            updatedEvent = { ...updatedEvent, localNotificationId: notifId };
            setEvents((prev) => {
              const next = prev.map((e) =>
                e.id === updatedEvent!.id ? updatedEvent! : e,
              );
              void saveEvents(next);
              return next;
            });
            setLastSyncNote('Lembrete reagendado no celular.');
          } else {
            setLastSyncNote(
              'Não deu para reagendar o lembrete. Confira notificação e alarme do app.',
            );
          }
        }
        if (shouldSync && updatedEvent.googleEventId) {
          // Agenda Google é a fonte: não sobrescreve o Calendar a partir do app.
          setLastSyncNote(
            'Remarcado no app. Para refletir na Agenda Google, edite lá ou aguarde a sincronização puxar do Calendar.',
          );
        }
        return {
          detail: `Remarcado: ${updatedEvent.title} · ${new Date(updatedEvent.startAt).toLocaleString('pt-BR')}`,
          success: true,
          todos: currentTodos,
        };
      }

      if (item.action === 'list_tasks') {
        const cat = (item.category ?? item.notes ?? '').toLowerCase().trim();
        const open = currentTodos.filter((t) => !t.done);
        const filtered = cat
          ? open.filter((t) => (t.category ?? '').toLowerCase().includes(cat))
          : open;
        const titles = filtered.map((t) => t.title).slice(0, 12);
        return {
          detail:
            filtered.length === 0
              ? cat
                ? `Nenhuma tarefa em ${cat}`
                : 'Nenhuma tarefa aberta'
              : `${filtered.length}: ${titles.join(', ')}`,
          success: true,
          todos: currentTodos,
        };
      }

      return {
        detail: 'Não entendi este item',
        success: false,
        todos: currentTodos,
      };
    },
    [settings.notificationsEnabled, settings.reminderSound],
  );

  const applyBatch = useCallback(
    async (batch: ParsedBatch, source: InputSource) => {
      const createdAt = new Date().toISOString();
      const shouldSync = settings.googleConnected && settings.syncToGoogle;

      // Snapshot for 8s undo (especially voice hands-free)
      const snapshot: UndoSnapshot = {
        id: id(),
        label: batch.summary || 'última ação',
        todos: todos,
        events: events,
        expiresAt: Date.now() + UNDO_WINDOW_MS,
      };
      setUndoSnapshot(snapshot);
      setTimeout(() => {
        setUndoSnapshot((cur) => (cur?.id === snapshot.id ? null : cur));
      }, UNDO_WINDOW_MS);

      let workingTodos = todos;
      const details: string[] = [];
      let anySuccess = false;
      let anyUnknown = false;

      for (const item of batch.items) {
        if (item.action === 'unknown') anyUnknown = true;
        const result = await applyItem(
          item,
          source,
          batch.rawInput,
          shouldSync,
          workingTodos,
        );
        workingTodos = result.todos;
        details.push(result.detail);
        if (result.success) anySuccess = true;
      }

      // Category completion nudge
      for (const item of batch.items) {
        if (item.action !== 'complete_task' || !item.category) continue;
        const cat = item.category.toLowerCase();
        const stillOpen = workingTodos.some(
          (t) => !t.done && (t.category ?? '').toLowerCase() === cat,
        );
        if (!stillOpen) {
          details.push(`Fechou ${item.category}`);
        }
      }

      await persistHistory({
        id: id(),
        createdAt,
        source,
        rawInput: batch.rawInput,
        summary: batch.summary,
        action:
          batch.items.length > 1
            ? 'batch'
            : batch.items[0]?.action ?? 'unknown',
        success: anySuccess,
        detail: details.join(' · '),
      });

      if (!anySuccess && anyUnknown) {
        setError('Não consegui entender. Tente reformular.');
      }
    },
    [
      applyItem,
      events,
      persistHistory,
      settings.googleConnected,
      settings.syncToGoogle,
      todos,
    ],
  );

  const undoLastChange = useCallback(async () => {
    if (!undoSnapshot || Date.now() > undoSnapshot.expiresAt) {
      setUndoSnapshot(null);
      return;
    }
    setTodos(undoSnapshot.todos);
    setEvents(undoSnapshot.events);
    await saveTodos(undoSnapshot.todos);
    await saveEvents(undoSnapshot.events);
    setUndoSnapshot(null);
    setLastSyncNote('Ação desfeita.');
  }, [undoSnapshot]);

  const shareOpenTasks = useCallback(
    async (category?: string) => {
      const { Share } = await import('react-native');
      const open = todos.filter((t) => !t.done);
      const filtered = category
        ? open.filter(
            (t) =>
              (t.category ?? '').toLowerCase() === category.toLowerCase(),
          )
        : open;
      const lines = filtered.map((t) => {
        const due = t.dueAt ? ` (prazo ${formatDueDatePtBr(t.dueAt)})` : '';
        return `• ${t.title}${due}`;
      });
      const body =
        lines.length === 0
          ? 'Nenhuma tarefa aberta.'
          : `AgendAI · tarefas${category ? ` (${category})` : ''}:\n${lines.join('\n')}`;
      await Share.share({ message: body });
    },
    [todos],
  );

  const enqueueInput = useCallback(async (text: string, source: InputSource) => {
    const entry: QueuedInput = {
      id: id(),
      text,
      source,
      createdAt: new Date().toISOString(),
    };
    setInputQueue((prev) => {
      const next = [...prev, entry];
      void saveInputQueue(next);
      return next;
    });
    return entry;
  }, []);

  const submitInput = useCallback(
    async (text: string, source: InputSource) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setBusy(true);
      setError(null);
      try {
        await enqueueInput(trimmed, source);
        const queuedNow = inputQueueRef.current.length;
        setLastSyncNote(
          queuedNow > 1
            ? `Pedido adicionado. Fila com ${queuedNow} itens.`
            : 'Pedido adicionado à fila.',
        );
      } finally {
        setBusy(false);
      }
      void drainInputQueue();
    },
    [enqueueInput],
  );

  const drainInputQueue = useCallback(async () => {
    if (drainingQueueRef.current) return;
    if (inputQueueRef.current.length === 0) return;
    drainingQueueRef.current = true;
    setQueueProcessing(true);
    try {
      // FIFO real: processa em cadeia até acabar, sem bloquear novo enqueue.
      while (inputQueueRef.current.length > 0) {
        const online = await isOnline();
        if (!online) {
          setLastSyncNote('Sem internet. Fila pausada até voltar conexão.');
          break;
        }
        const head = inputQueueRef.current[0];
        if (!head) break;
        setError(null);
        const openTitles = todos.filter((t) => !t.done).map((t) => t.title);
        const batch = await parseUserIntent(
          head.text,
          settings.aiApiKey,
          openTitles,
        );
        const onlyList =
          batch.items.length > 0 &&
          batch.items.every((i) => i.action === 'list_tasks');
        if (settings.confirmBeforeSave && !onlyList) {
          setPending({ batch, source: head.source });
          setLastSyncNote('Fila pausada aguardando sua confirmação.');
          break;
        }
        await applyBatch(batch, head.source);
        setInputQueue((prev) => {
          if (prev[0]?.id !== head.id) return prev;
          const next = prev.slice(1);
          void saveInputQueue(next);
          return next;
        });
        const left = Math.max(0, inputQueueRef.current.length - 1);
        setLastSyncNote(
          left > 0
            ? `Fila: processado. Restam ${left}.`
            : 'Fila processada.',
        );
      }
    } catch (e) {
      const message =
        e instanceof Error ? e.message : 'Falha ao processar fila.';
      if (isLikelyNetworkError(message)) {
        setLastSyncNote('Sem internet. Fila pausada até voltar conexão.');
      } else {
        // Item inválido: remove só o primeiro para destravar.
        setInputQueue((prev) => {
          const next = prev.slice(1);
          void saveInputQueue(next);
          return next;
        });
        setError(message);
      }
    } finally {
      drainingQueueRef.current = false;
      setQueueProcessing(false);
    }
  }, [applyBatch, settings.aiApiKey, settings.confirmBeforeSave, todos]);

  useEffect(() => {
    if (!ready) return;
    void drainInputQueue();
    const stop = onAppBecameActive(() => {
      void drainInputQueue();
    });
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active' || state === 'background') {
        void drainInputQueue();
      }
    });
    const interval = setInterval(() => {
      void drainInputQueue();
    }, 8_000);
    return () => {
      stop();
      appStateSub.remove();
      clearInterval(interval);
    };
  }, [ready, drainInputQueue]);

  const confirmPending = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await applyBatch(pending.batch, pending.source);
      setPending(null);
      setInputQueue((prev) => {
        if (prev.length === 0) return prev;
        const next = prev.slice(1);
        void saveInputQueue(next);
        return next;
      });
      setLastSyncNote('Pedido confirmado e executado.');
    } finally {
      setBusy(false);
    }
    void drainInputQueue();
  }, [applyBatch, pending, drainInputQueue]);

  const cancelPending = useCallback(() => {
    setPending(null);
    setInputQueue((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.slice(1);
      void saveInputQueue(next);
      return next;
    });
    setLastSyncNote('Pedido da fila cancelado.');
    void drainInputQueue();
  }, [drainInputQueue]);

  const updateSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      const next = { ...settings, ...patch };
      setSettings(next);
      await saveSettings(next);
      if (
        patch.notificationsEnabled !== undefined ||
        patch.morningBriefHour !== undefined ||
        patch.reminderSound !== undefined
      ) {
        await ensureAndroidChannel(next.reminderSound);
        await scheduleMorningBrief({
          enabled: next.notificationsEnabled,
          hour: next.morningBriefHour,
          openTasks: countOpenTasks(todos),
          todayEvents: countTodayEvents(events),
        });
      }
    },
    [settings, todos, events],
  );

  useEffect(() => {
    if (!ready) return;
    void ensureAndroidChannel(settings.reminderSound);
    void scheduleMorningBrief({
      enabled: settings.notificationsEnabled,
      hour: settings.morningBriefHour,
      openTasks: countOpenTasks(todos),
      todayEvents: countTodayEvents(events),
    });
  }, [
    ready,
    settings.notificationsEnabled,
    settings.morningBriefHour,
    settings.reminderSound,
    todos,
    events,
  ]);

  const toggleTodoDone = useCallback(
    async (todoId: string) => {
      let updated: TodoItem | undefined;
      setTodos((prev) => {
        const next = prev.map((t) => {
          if (t.id !== todoId) return t;
          const done = !t.done;
          updated = {
            ...t,
            done,
            completedAt: done ? new Date().toISOString() : undefined,
            localNotificationIds: done ? undefined : t.localNotificationIds,
          };
          return updated;
        });
        void saveTodos(next);
        return next;
      });
      if (updated) {
        if (updated.done) {
          await cancelTodoLocalNotifications(updated);
        } else if (
          updated.reminderSeries &&
          settings.notificationsEnabled
        ) {
          const ids = await scheduleTaskReminderSeries(
            updated,
            settings.reminderSound,
          );
          if (ids.length > 0) {
            const withIds = { ...updated, localNotificationIds: ids };
            setTodos((prev) => {
              const next = prev.map((t) =>
                t.id === withIds.id ? withIds : t,
              );
              void saveTodos(next);
              return next;
            });
          }
        }
      }
      if (
        updated &&
        settings.googleConnected &&
        settings.syncToGoogle &&
        updated.googleTaskId
      ) {
        const sync = await completeTaskOnGoogle(updated);
        setLastSyncNote(sync.message);
      }
    },
    [
      settings.googleConnected,
      settings.syncToGoogle,
      settings.notificationsEnabled,
      settings.reminderSound,
    ],
  );

  const setTodoDue = useCallback(
    async (todoId: string, dueAt: string | null) => {
      let updated: TodoItem | undefined;
      setTodos((prev) => {
        const next = prev.map((t) => {
          if (t.id !== todoId) return t;
          updated = { ...t, dueAt: dueAt ?? undefined };
          return updated;
        });
        void saveTodos(next);
        return next;
      });
      if (
        updated &&
        settings.googleConnected &&
        settings.syncToGoogle &&
        updated.googleTaskId
      ) {
        const sync = await updateTaskOnGoogle(updated);
        setLastSyncNote(sync.message);
      }
    },
    [settings.googleConnected, settings.syncToGoogle],
  );

  const deleteTodo = useCallback(
    async (todoId: string) => {
      let removed: TodoItem | undefined;
      setTodos((prev) => {
        removed = prev.find((t) => t.id === todoId);
        const next = prev.filter((t) => t.id !== todoId);
        void saveTodos(next);
        return next;
      });
      if (removed) {
        await cancelTodoLocalNotifications(removed);
        if (
          settings.googleConnected &&
          settings.syncToGoogle &&
          removed.googleTaskId
        ) {
          const sync = await deleteTaskOnGoogle(removed);
          setLastSyncNote(sync.message);
        }
      }
    },
    [settings.googleConnected, settings.syncToGoogle],
  );

  const deleteEvent = useCallback(async (eventId: string) => {
    const target = eventsRef.current.find((e) => e.id === eventId);
    if (!target) return;

    setEvents((prev) => {
      const next = prev.filter((e) => e.id !== eventId);
      void saveEvents(next);
      return next;
    });
    await cancelEventLocalNotifications(target);
    softSnoozeRef.current.delete(eventId);
    if (softPromptIdRef.current === eventId) setSoftPromptEvent(null);

    // Com Google: remove só do app e não reimporta. A Agenda Google fica intacta.
    if (target.googleEventId) {
      if (!dismissedGoogleIdsRef.current.includes(target.googleEventId)) {
        dismissedGoogleIdsRef.current = [
          ...dismissedGoogleIdsRef.current,
          target.googleEventId,
        ];
        void saveDismissedGoogleEventIds(dismissedGoogleIdsRef.current);
      }
      setLastSyncNote(
        'Removido do app. Continuou na Agenda Google — apague lá se quiser tirar dos dois.',
      );
      return;
    }

    setLastSyncNote('Evento removido.');
  }, []);

  const scanSoftPrompt = useCallback(() => {
    if (softPromptEvent) return;
    const candidate = events.find(
      (e) =>
        needsSoftTimePrompt(e) && !softSnoozeRef.current.has(e.id),
    );
    if (candidate) setSoftPromptEvent(candidate);
  }, [events, softPromptEvent]);

  useEffect(() => {
    if (!ready) return;
    scanSoftPrompt();
    const interval = setInterval(scanSoftPrompt, 30_000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') scanSoftPrompt();
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [ready, scanSoftPrompt]);

  const resolveSoftTimeDone = useCallback(async (eventId: string) => {
    softSnoozeRef.current.delete(eventId);
    setSoftPromptEvent(null);
    let updated: CalendarEventItem | undefined;
    setEvents((prev) => {
      const next = prev.map((e) => {
        if (e.id !== eventId) return e;
        updated = { ...e, softResolved: true };
        return updated;
      });
      void saveEvents(next);
      return next;
    });
    if (updated) {
      await cancelEventLocalNotifications(updated);
      setLastSyncNote('Compromisso marcado como feito.');
    }
  }, []);

  const resolveSoftTimeReschedule = useCallback(
    async (eventId: string, hour: number) => {
      softSnoozeRef.current.delete(eventId);
      setSoftPromptEvent(null);
      let updated: CalendarEventItem | undefined;
      setEvents((prev) => {
        const match = prev.find((e) => e.id === eventId);
        if (!match) return prev;
        const dayKey = dayKeySaoPaulo(match.startAt);
        const duration = Math.max(
          30,
          Math.round(
            (new Date(match.endAt).getTime() -
              new Date(match.startAt).getTime()) /
              60_000,
          ),
        );
        const startAt = atHourSaoPaulo(dayKey, hour);
        const endAt = new Date(
          new Date(startAt).getTime() + duration * 60_000,
        ).toISOString();
        updated = {
          ...match,
          startAt,
          endAt,
          softTime: undefined,
          softResolved: true,
          wantsReminder: true,
          reminderMinutes: match.reminderMinutes ?? 30,
        };
        const next = prev.map((e) => (e.id === eventId ? updated! : e));
        void saveEvents(next);
        return next;
      });
      if (!updated) return;
      await cancelEventLocalNotifications(updated);
      if (settings.notificationsEnabled) {
        const notifId = await scheduleEventReminder(
          updated,
          settings.reminderSound,
        );
        if (notifId) {
          updated = { ...updated, localNotificationId: notifId };
          setEvents((prev) => {
            const next = prev.map((e) =>
              e.id === updated!.id ? updated! : e,
            );
            void saveEvents(next);
            return next;
          });
        }
      }
      if (
        settings.googleConnected &&
        settings.syncToGoogle &&
        updated.googleEventId
      ) {
        // Não sobrescreve o Calendar; a Agenda Google manda na próxima sync.
        setLastSyncNote(
          `Remarcado no app para ${String(hour).padStart(2, '0')}:00. Edite no Calendar se quiser manter na Agenda Google.`,
        );
      } else {
        setLastSyncNote(
          `Remarcado para ${String(hour).padStart(2, '0')}:00.`,
        );
      }
    },
    [
      settings.notificationsEnabled,
      settings.reminderSound,
      settings.googleConnected,
      settings.syncToGoogle,
    ],
  );

  const dismissSoftTimePrompt = useCallback(() => {
    if (softPromptEvent) {
      softSnoozeRef.current.add(softPromptEvent.id);
    }
    setSoftPromptEvent(null);
  }, [softPromptEvent]);

  const value = useMemo(
    () => ({
      ready,
      todos,
      events,
      history,
      settings,
      pending,
      busy,
      error,
      lastSyncNote,
      queuedCount: inputQueue.length,
      queueProcessing,
      clearError: () => setError(null),
      updateSettings,
      submitInput,
      confirmPending,
      cancelPending,
      toggleTodoDone,
      setTodoDue,
      deleteTodo,
      deleteEvent,
      refreshGoogleStatus,
      syncTasksFromGoogle,
      syncEventsFromGoogle,
      syncAgendaWithGoogle: () => syncAgendaWithGoogle(),
      undoSnapshot,
      undoLastChange,
      shareOpenTasks,
      softPromptEvent,
      resolveSoftTimeDone,
      resolveSoftTimeReschedule,
      dismissSoftTimePrompt,
    }),
    [
      ready,
      todos,
      events,
      history,
      settings,
      pending,
      busy,
      error,
      lastSyncNote,
      inputQueue.length,
      queueProcessing,
      updateSettings,
      submitInput,
      confirmPending,
      cancelPending,
      toggleTodoDone,
      setTodoDue,
      deleteTodo,
      deleteEvent,
      refreshGoogleStatus,
      syncTasksFromGoogle,
      syncEventsFromGoogle,
      syncAgendaWithGoogle,
      undoSnapshot,
      undoLastChange,
      shareOpenTasks,
      softPromptEvent,
      resolveSoftTimeDone,
      resolveSoftTimeReschedule,
      dismissSoftTimePrompt,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
