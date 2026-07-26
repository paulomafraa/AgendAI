import type { CalendarEventItem } from '../types';

export function dayKeySaoPaulo(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

export function todayKeySaoPaulo(now = new Date()): string {
  return dayKeySaoPaulo(now.toISOString());
}

/** Monta ISO em horário de Brasília (sem DST). */
export function atHourSaoPaulo(
  dayKey: string,
  hour: number,
  minute = 0,
): string {
  const hh = String(Math.min(23, Math.max(0, Math.round(hour)))).padStart(
    2,
    '0',
  );
  const mm = String(Math.min(59, Math.max(0, Math.round(minute)))).padStart(
    2,
    '0',
  );
  return new Date(`${dayKey}T${hh}:${mm}:00-03:00`).toISOString();
}

/**
 * Horário do compromisso já passou.
 * Soft-time (só data → 13h): só “passou” no dia seguinte ou se resolvido.
 */
export function isEventPast(
  event: CalendarEventItem,
  nowMs = Date.now(),
): boolean {
  if (event.softResolved) return true;
  if (event.allDay || event.softTime) {
    return (
      dayKeySaoPaulo(event.startAt) <
      dayKeySaoPaulo(new Date(nowMs).toISOString())
    );
  }
  return new Date(event.startAt).getTime() <= nowMs;
}

/** Ainda é “próximo”: horário ainda não chegou. */
export function isEventUpcoming(
  event: CalendarEventItem,
  nowMs = Date.now(),
): boolean {
  return !isEventPast(event, nowMs);
}

export function isEventToday(
  event: CalendarEventItem,
  now = new Date(),
): boolean {
  return dayKeySaoPaulo(event.startAt) === todayKeySaoPaulo(now);
}

export function tomorrowKeySaoPaulo(now = new Date()): string {
  const today = todayKeySaoPaulo(now);
  const [y, m, d] = today.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const yy = next.getUTCFullYear();
  const mm = String(next.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(next.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** Hoje ou amanhã (fuso America/Sao_Paulo). */
export function isEventTodayOrTomorrow(
  event: CalendarEventItem,
  now = new Date(),
): boolean {
  const key = dayKeySaoPaulo(event.startAt);
  return key === todayKeySaoPaulo(now) || key === tomorrowKeySaoPaulo(now);
}

/**
 * Agenda da Home/widget: prioriza hoje+amanhã;
 * se vazio, traz os próximos futuros para não ficar em branco.
 */
export function pickHomeAgendaEvents(
  events: CalendarEventItem[],
  nowMs = Date.now(),
  limit = 12,
): CalendarEventItem[] {
  const now = new Date(nowMs);
  const sortNear = (a: CalendarEventItem, b: CalendarEventItem) => {
    const ap = isEventPast(a, nowMs) ? 1 : 0;
    const bp = isEventPast(b, nowMs) ? 1 : 0;
    if (ap !== bp) return ap - bp;
    return new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
  };

  const near = events
    .filter((e) => isEventTodayOrTomorrow(e, now))
    .sort(sortNear);
  if (near.length > 0) return near.slice(0, limit);

  return events
    .filter((e) => isEventUpcoming(e, nowMs))
    .sort(
      (a, b) =>
        new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
    )
    .slice(0, limit);
}

/**
 * Soft-time: já passou das 13h sugeridas no dia, ainda não resolveu.
 */
export function needsSoftTimePrompt(
  event: CalendarEventItem,
  nowMs = Date.now(),
): boolean {
  if (!event.softTime || event.softResolved) return false;
  if (
    dayKeySaoPaulo(event.startAt) !==
    dayKeySaoPaulo(new Date(nowMs).toISOString())
  ) {
    return false;
  }
  return new Date(event.startAt).getTime() <= nowMs;
}

/**
 * Semáforo de prazo na Home:
 * verde = sem prazo ou longe · amarelo = véspera · vermelho = no dia / atrasado
 */
export function taskDeadlineTone(
  dueAt: string | undefined,
  now = new Date(),
): 'green' | 'yellow' | 'red' {
  if (!dueAt) return 'green';
  const due = dayKeySaoPaulo(dueAt);
  const today = todayKeySaoPaulo(now);
  const tomorrow = tomorrowKeySaoPaulo(now);
  if (due <= today) return 'red';
  if (due === tomorrow) return 'yellow';
  return 'green';
}

/** Expande série de lembretes em timestamps (ms). */
export function expandReminderSeriesTimes(
  dayKey: string,
  fromHour: number,
  toHour: number,
  intervalMinutes: number,
): number[] {
  const interval = Math.max(15, Math.round(intervalMinutes || 60));
  const from = Math.min(fromHour, toHour);
  const to = Math.max(fromHour, toHour);
  const startMs = new Date(atHourSaoPaulo(dayKey, from, 0)).getTime();
  const endMs = new Date(atHourSaoPaulo(dayKey, to, 0)).getTime();
  const out: number[] = [];
  for (let t = startMs; t <= endMs + 500; t += interval * 60_000) {
    out.push(t);
  }
  return out;
}
