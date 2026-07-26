import React, { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useApp } from '../context/AppContext';
import { DueDateModal } from '../components/DueDateModal';
import { ItemDetailModal } from '../components/ItemDetailModal';
import { OrganizeSheet } from '../components/OrganizeSheet';
import { formatDueDatePtBr } from '../services/ai/shared';
import { colors } from '../theme/colors';
import type { TodoItem } from '../types';

type TaskSort = 'oldest' | 'newest' | 'due' | 'alpha' | 'category';

const SORT_OPTIONS: Array<{ id: TaskSort; label: string }> = [
  { id: 'oldest', label: 'Mais antigas' },
  { id: 'newest', label: 'Mais novas' },
  { id: 'due', label: 'Prazo' },
  { id: 'alpha', label: 'A–Z' },
  { id: 'category', label: 'Categoria' },
];

type ListRow =
  | { kind: 'header'; key: string; label: string }
  | { kind: 'todo'; key: string; item: TodoItem };

function sortTodos(items: TodoItem[], sort: TaskSort): TodoItem[] {
  const copy = [...items];
  switch (sort) {
    case 'oldest':
      return copy.sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
    case 'newest':
      return copy.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    case 'due':
      return copy.sort((a, b) => {
        if (a.dueAt && b.dueAt) {
          return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
        }
        if (a.dueAt) return -1;
        if (b.dueAt) return 1;
        return a.title.localeCompare(b.title, 'pt-BR');
      });
    case 'alpha':
      return copy.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
    case 'category':
      return copy.sort((a, b) => {
        const ca = (a.category ?? 'zzz').localeCompare(
          b.category ?? 'zzz',
          'pt-BR',
        );
        if (ca !== 0) return ca;
        return a.title.localeCompare(b.title, 'pt-BR');
      });
    default:
      return copy;
  }
}

function categoryLabel(raw?: string): string {
  const t = raw?.trim();
  if (!t) return 'Sem categoria';
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function buildRows(
  open: TodoItem[],
  done: TodoItem[],
  sort: TaskSort,
): ListRow[] {
  const rows: ListRow[] = [];

  if (sort === 'category') {
    let last = '';
    for (const item of open) {
      const label = categoryLabel(item.category);
      if (label !== last) {
        rows.push({ kind: 'header', key: `cat-open-${label}`, label });
        last = label;
      }
      rows.push({ kind: 'todo', key: item.id, item });
    }
    if (done.length > 0) {
      rows.push({
        kind: 'header',
        key: 'done-header',
        label: 'Concluídas',
      });
      let lastDone = '';
      for (const item of done) {
        const label = categoryLabel(item.category);
        if (label !== lastDone) {
          rows.push({
            kind: 'header',
            key: `cat-done-${label}`,
            label,
          });
          lastDone = label;
        }
        rows.push({ kind: 'todo', key: item.id, item });
      }
    }
    return rows;
  }

  for (const item of open) {
    rows.push({ kind: 'todo', key: item.id, item });
  }
  if (done.length > 0) {
    rows.push({ kind: 'header', key: 'done-header', label: 'Concluídas' });
    for (const item of done) {
      rows.push({ kind: 'todo', key: item.id, item });
    }
  }
  return rows;
}

function TodoRow({
  item,
  onToggle,
  onDelete,
  onPressBody,
}: {
  item: TodoItem;
  onToggle: () => void;
  onDelete: () => void;
  onPressBody: () => void;
}) {
  const overdue =
    !item.done &&
    item.dueAt &&
    new Date(item.dueAt).getTime() < Date.now() - 12 * 60 * 60 * 1000;

  return (
    <View style={[styles.row, item.done && styles.rowDone]}>
      <Pressable onPress={onToggle} style={styles.checkHit} hitSlop={8}>
        <View style={[styles.check, item.done && styles.checkOn]}>
          {item.done ? <Text style={styles.checkMark}>✓</Text> : null}
        </View>
      </Pressable>
      <Pressable style={styles.body} onPress={onPressBody}>
        <Text style={[styles.title, item.done && styles.titleDone]}>
          {item.title}
        </Text>
        <Text style={[styles.meta, overdue && styles.metaOverdue]}>
          {item.reminderSeries
            ? `A cada ${item.reminderSeries.intervalMinutes} min · ${item.reminderSeries.fromHour}h–${item.reminderSeries.toHour}h`
            : item.dueAt
              ? formatDueDatePtBr(item.dueAt)
              : item.notes?.trim()
                ? 'Toque para detalhes'
                : 'Toque para detalhes ou prazo'}
          {item.category ? ` · ${item.category}` : ''}
        </Text>
      </Pressable>
      <Pressable onPress={onDelete} hitSlop={8}>
        <Text style={styles.delete}>Apagar</Text>
      </Pressable>
    </View>
  );
}

export function TasksScreen() {
  const insets = useSafeAreaInsets();
  const {
    todos,
    toggleTodoDone,
    deleteTodo,
    setTodoDue,
    syncTasksFromGoogle,
    shareOpenTasks,
  } = useApp();
  const [sort, setSort] = useState<TaskSort>('oldest');
  const [detail, setDetail] = useState<TodoItem | null>(null);
  const [editing, setEditing] = useState<TodoItem | null>(null);

  const open = useMemo(
    () => sortTodos(todos.filter((t) => !t.done), sort),
    [todos, sort],
  );
  const done = useMemo(
    () =>
      sortTodos(todos.filter((t) => t.done), sort === 'due' ? 'newest' : sort),
    [todos, sort],
  );
  const rows = useMemo(() => buildRows(open, done, sort), [open, done, sort]);

  useFocusEffect(
    useCallback(() => {
      void syncTasksFromGoogle();
    }, [syncTasksFromGoogle]),
  );

  return (
    <View style={[styles.root, { paddingTop: Math.max(insets.top, 16) + 12 }]}>
      <View style={styles.headerRow}>
        <Text style={styles.heading}>Tarefas</Text>
        <View style={styles.headerActions}>
          <OrganizeSheet
            triggerLabel="Organizar"
            title="Ordenar tarefas"
            options={SORT_OPTIONS}
            value={sort}
            onChange={setSort}
          />
          {open.length > 0 ? (
            <Pressable onPress={() => void shareOpenTasks()} hitSlop={8}>
              <Text style={styles.share}>Compartilhar</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>
            Nenhuma tarefa ainda. Experimente na Home.
          </Text>
        }
        renderItem={({ item: row }) => {
          if (row.kind === 'header') {
            return (
              <View style={styles.sectionHead}>
                <Text style={styles.sectionLabel}>{row.label}</Text>
                <View style={styles.sectionLine} />
              </View>
            );
          }
          return (
            <TodoRow
              item={row.item}
              onToggle={() => toggleTodoDone(row.item.id)}
              onDelete={() => deleteTodo(row.item.id)}
            onPressBody={() => setDetail(row.item)}
          />
          );
        }}
      />

      <ItemDetailModal
        todo={detail}
        onClose={() => setDetail(null)}
        onDelete={
          detail
            ? () => {
                void deleteTodo(detail.id);
                setDetail(null);
              }
            : undefined
        }
        onEditDue={
          detail
            ? () => {
                setEditing(detail);
                setDetail(null);
              }
            : undefined
        }
      />

      <DueDateModal
        visible={Boolean(editing)}
        title={editing?.title ?? ''}
        currentDueAt={editing?.dueAt}
        onClose={() => setEditing(null)}
        onPick={(dueAt) => {
          if (editing) void setTodoDue(editing.id, dueAt);
        }}
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
  heading: {
    fontFamily: 'Fraunces_700Bold',
    fontSize: 32,
    color: colors.ink,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  share: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: colors.accent,
  },
  list: { paddingHorizontal: 24, paddingBottom: 40, gap: 10 },
  empty: {
    fontFamily: 'DMSans_400Regular',
    color: colors.inkMuted,
    marginTop: 24,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 6,
    marginBottom: 2,
  },
  sectionLabel: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: colors.inkMuted,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  sectionLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.line,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 14,
    gap: 12,
  },
  rowDone: { opacity: 0.72 },
  checkHit: { paddingTop: 2 },
  check: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: {
    backgroundColor: colors.accent,
  },
  checkMark: {
    color: '#fff',
    fontSize: 12,
    fontFamily: 'DMSans_500Medium',
  },
  body: { flex: 1, gap: 4 },
  title: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 16,
    color: colors.ink,
  },
  titleDone: {
    textDecorationLine: 'line-through',
    color: colors.inkMuted,
  },
  meta: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: colors.inkMuted,
  },
  metaOverdue: {
    color: colors.danger,
  },
  delete: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: colors.danger,
  },
});
