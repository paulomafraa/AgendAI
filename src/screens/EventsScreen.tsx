import React, { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../context/AppContext';
import { OrganizeSheet } from '../components/OrganizeSheet';
import { ItemDetailModal } from '../components/ItemDetailModal';
import { colors } from '../theme/colors';
import type { CalendarEventItem } from '../types';
import {
  isEventPast,
  isEventToday,
  isEventUpcoming,
} from '../utils/eventTime';
import { useNowTick } from '../hooks/useNowTick';

type EventFilter = 'all' | 'upcoming' | 'today' | 'past';
type EventSort = 'soonest' | 'latest' | 'newest' | 'alpha';

const FILTERS: Array<{ id: EventFilter; label: string }> = [
  { id: 'all', label: 'Todos' },
  { id: 'upcoming', label: 'Próximos' },
  { id: 'today', label: 'Hoje' },
  { id: 'past', label: 'Passados' },
];

const SORTS: Array<{ id: EventSort; label: string }> = [
  { id: 'soonest', label: 'Mais cedo' },
  { id: 'latest', label: 'Mais tarde' },
  { id: 'newest', label: 'Criados' },
  { id: 'alpha', label: 'A–Z' },
];

function filterEvents(
  items: CalendarEventItem[],
  filter: EventFilter,
  nowMs: number,
): CalendarEventItem[] {
  switch (filter) {
    case 'today':
      return items.filter((e) => isEventToday(e, new Date(nowMs)));
    case 'upcoming':
      return items.filter((e) => isEventUpcoming(e, nowMs));
    case 'past':
      return items.filter((e) => isEventPast(e, nowMs));
    default:
      return items;
  }
}

function sortEvents(
  items: CalendarEventItem[],
  sort: EventSort,
  filter: EventFilter,
  nowMs: number,
): CalendarEventItem[] {
  const copy = [...items];
  const byStartAsc = (a: CalendarEventItem, b: CalendarEventItem) =>
    new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
  const byStartDesc = (a: CalendarEventItem, b: CalendarEventItem) =>
    new Date(b.startAt).getTime() - new Date(a.startAt).getTime();

  switch (sort) {
    case 'soonest':
      copy.sort(byStartAsc);
      break;
    case 'latest':
      copy.sort(byStartDesc);
      break;
    case 'newest':
      copy.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      break;
    case 'alpha':
      copy.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
      break;
    default:
      break;
  }

  if (filter === 'today' || filter === 'all') {
    const ranked = copy.map((e, index) => ({ e, index }));
    ranked.sort((a, b) => {
      const ap = isEventPast(a.e, nowMs) ? 1 : 0;
      const bp = isEventPast(b.e, nowMs) ? 1 : 0;
      if (ap !== bp) return ap - bp;
      return a.index - b.index;
    });
    return ranked.map((r) => r.e);
  }

  return copy;
}

function formatWhen(item: CalendarEventItem): string {
  if (item.allDay) {
    return `${new Date(item.startAt).toLocaleDateString('pt-BR')} · dia todo`;
  }
  const base = new Date(item.startAt).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  if (item.softTime && !item.softResolved) {
    return `${base} · sugerido`;
  }
  return base;
}

function EventRow({
  item,
  past,
  onOpen,
  onDelete,
}: {
  item: CalendarEventItem;
  past: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const hasExtra = Boolean(
    item.notes?.trim() || item.location || item.broadcastStartAt,
  );
  const synced = Boolean(item.googleEventId);

  return (
    <View style={[styles.row, past && styles.rowPast]}>
      <Pressable style={styles.body} onPress={onOpen}>
        <Text style={[styles.title, past && styles.titlePast]}>{item.title}</Text>
        <Text style={[styles.when, past && styles.whenPast]}>
          {past ? `Passado · ${formatWhen(item)}` : formatWhen(item)}
        </Text>
        {synced ? (
          <Text style={styles.syncHint}>Na Agenda Google · Apagar só tira do app</Text>
        ) : null}
        {hasExtra ? (
          <Text style={styles.expandHint}>Toque para detalhes</Text>
        ) : null}
      </Pressable>
      <Pressable onPress={onDelete} hitSlop={8}>
        <Text style={styles.delete}>Apagar</Text>
      </Pressable>
    </View>
  );
}

export function EventsScreen() {
  const insets = useSafeAreaInsets();
  const {
    events,
    deleteEvent,
    syncEventsFromGoogle,
    syncAgendaWithGoogle,
    settings,
    lastSyncNote,
  } = useApp();
  const [filter, setFilter] = useState<EventFilter>('all');
  const [sort, setSort] = useState<EventSort>('soonest');
  const [selected, setSelected] = useState<CalendarEventItem | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const nowMs = useNowTick(20_000);

  const list = useMemo(
    () => sortEvents(filterEvents(events, filter, nowMs), sort, filter, nowMs),
    [events, filter, sort, nowMs],
  );

  useFocusEffect(
    useCallback(() => {
      void syncEventsFromGoogle();
    }, [syncEventsFromGoogle]),
  );

  const onSync = async () => {
    if (!settings.googleConnected || syncBusy) return;
    setSyncBusy(true);
    try {
      await syncAgendaWithGoogle();
    } finally {
      setSyncBusy(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: Math.max(insets.top, 16) + 12 }]}>
      <View style={styles.headerRow}>
        <Text style={styles.heading}>Eventos</Text>
        <View style={styles.headerActions}>
          {settings.googleConnected ? (
            <Pressable onPress={() => void onSync()} hitSlop={8}>
              <Text style={styles.syncBtn}>
                {syncBusy ? 'Sincronizando…' : 'Sincronizar'}
              </Text>
            </Pressable>
          ) : null}
          <OrganizeSheet
            triggerLabel="Organizar"
            title="Mostrar"
            options={FILTERS}
            value={filter}
            onChange={setFilter}
            secondaryTitle="Ordenar"
            secondaryOptions={SORTS}
            secondaryValue={sort}
            onSecondaryChange={(id) => setSort(id as EventSort)}
          />
        </View>
      </View>
      {lastSyncNote ? (
        <Text style={styles.syncNote}>{lastSyncNote}</Text>
      ) : null}

      <FlatList
        data={list}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>
            Nenhum evento neste filtro. Peça na Home, ex.: “me lembra amanhã às
            10 do dentista”.
          </Text>
        }
        renderItem={({ item }) => (
          <EventRow
            item={item}
            past={isEventPast(item, nowMs)}
            onOpen={() => setSelected(item)}
            onDelete={() => deleteEvent(item.id)}
          />
        )}
      />

      <ItemDetailModal
        event={selected}
        onClose={() => setSelected(null)}
        onDelete={
          selected
            ? () => {
                void deleteEvent(selected.id);
                setSelected(null);
              }
            : undefined
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    marginBottom: 12,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  syncBtn: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: colors.accent,
  },
  syncNote: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: colors.accent,
    paddingHorizontal: 24,
    marginBottom: 8,
    lineHeight: 18,
  },
  heading: {
    fontFamily: 'Fraunces_700Bold',
    fontSize: 32,
    color: colors.ink,
  },
  list: { paddingHorizontal: 24, paddingBottom: 40, gap: 10 },
  empty: {
    fontFamily: 'DMSans_400Regular',
    color: colors.inkMuted,
    marginTop: 24,
    lineHeight: 22,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 14,
    gap: 12,
  },
  rowPast: {
    opacity: 0.62,
    backgroundColor: colors.bgSoft,
  },
  body: { flex: 1, gap: 4 },
  title: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 16,
    color: colors.ink,
  },
  titlePast: {
    color: colors.inkMuted,
  },
  when: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: colors.accentDeep,
  },
  whenPast: {
    color: colors.inkMuted,
  },
  location: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: colors.ink,
  },
  notes: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: colors.inkMuted,
    lineHeight: 20,
  },
  mutedText: {
    color: colors.inkMuted,
  },
  syncHint: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: colors.inkMuted,
  },
  expandHint: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: colors.accent,
    marginTop: 2,
  },
  delete: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: colors.danger,
  },
});
