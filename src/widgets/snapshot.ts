import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CalendarEventItem, TodoItem } from '../types';
import {
  dayKeySaoPaulo,
  pickHomeAgendaEvents,
  todayKeySaoPaulo,
  tomorrowKeySaoPaulo,
} from '../utils/eventTime';

const KEY = '@agendai/widget_snapshot';

export type WidgetTaskLine = { title: string };
export type WidgetEventLine = { title: string; when: string };

export type WidgetSnapshot = {
  updatedAt: string;
  tasks: WidgetTaskLine[];
  events: WidgetEventLine[];
};

function formatWhen(item: CalendarEventItem, nowMs: number): string {
  const today = todayKeySaoPaulo(new Date(nowMs));
  const tomorrow = tomorrowKeySaoPaulo(new Date(nowMs));
  const key = dayKeySaoPaulo(item.startAt);

  if (item.allDay) {
    if (key === today) return 'Dia todo';
    if (key === tomorrow) return 'Amanhã';
    return new Date(item.startAt).toLocaleDateString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
    });
  }

  const time = new Date(item.startAt).toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  });
  if (key === today) return time;
  if (key === tomorrow) return `am ${time}`;
  const day = new Date(item.startAt).toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
  });
  return `${day} ${time}`;
}

export function buildWidgetSnapshot(
  todos: TodoItem[],
  events: CalendarEventItem[],
  nowMs = Date.now(),
): WidgetSnapshot {
  const tasks = todos
    .filter((t) => !t.done)
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    )
    .slice(0, 6)
    .map((t) => ({ title: t.title }));

  const upcoming = pickHomeAgendaEvents(events, nowMs, 6).map((e) => ({
    title: e.title,
    when: formatWhen(e, nowMs),
  }));

  return {
    updatedAt: new Date(nowMs).toISOString(),
    tasks,
    events: upcoming,
  };
}

export async function saveWidgetSnapshot(
  snapshot: WidgetSnapshot,
): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(snapshot));
}

export async function loadWidgetSnapshot(): Promise<WidgetSnapshot> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) {
      return { updatedAt: new Date().toISOString(), tasks: [], events: [] };
    }
    return JSON.parse(raw) as WidgetSnapshot;
  } catch {
    return { updatedAt: new Date().toISOString(), tasks: [], events: [] };
  }
}
