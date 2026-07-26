import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors } from '../theme/colors';
import { formatDueDatePtBr } from '../services/ai/shared';
import type { CalendarEventItem, TodoItem } from '../types';

type Props = {
  event?: CalendarEventItem | null;
  todo?: TodoItem | null;
  onClose: () => void;
  onDelete?: () => void;
  onEditDue?: () => void;
};

function formatWhen(iso: string, allDay?: boolean): string {
  if (allDay) {
    return new Date(iso).toLocaleDateString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      weekday: 'short',
      day: '2-digit',
      month: 'short',
    });
  }
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

export function ItemDetailModal({
  event,
  todo,
  onClose,
  onDelete,
  onEditDue,
}: Props) {
  const visible = Boolean(event || todo);
  if (!visible) return null;

  const title = event?.title ?? todo?.title ?? '';
  const category = event?.category ?? todo?.category;
  const notes = event?.notes ?? todo?.notes;
  const location = event?.location;

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.kicker}>
            {event ? 'Compromisso' : 'Tarefa'}
            {category ? ` · ${category}` : ''}
          </Text>
          <Text style={styles.title}>{title}</Text>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            {location ? <Row label="Onde" value={location} /> : null}

            {event?.broadcastStartAt ? (
              <Row
                label="Transmissão / pré"
                value={formatWhen(event.broadcastStartAt)}
              />
            ) : null}

            {event ? (
              <Row
                label={
                  event.broadcastStartAt
                    ? event.allDay
                      ? 'Dia do evento'
                      : 'Horário principal'
                    : event.allDay
                      ? 'Dia'
                      : event.softTime && !event.softResolved
                        ? 'Quando (sugerido)'
                        : 'Quando'
                }
                value={
                  event.allDay
                    ? `${formatWhen(event.startAt, true)} · dia todo`
                    : event.softTime && !event.softResolved
                      ? `${formatWhen(event.startAt)} · sem hora definida`
                      : formatWhen(event.startAt)
                }
              />
            ) : null}

            {todo?.dueAt ? (
              <Row label="Prazo" value={formatDueDatePtBr(todo.dueAt)} />
            ) : null}

            {todo?.reminderSeries ? (
              <Row
                label="Lembretes"
                value={`A cada ${todo.reminderSeries.intervalMinutes} min · ${todo.reminderSeries.fromHour}h–${todo.reminderSeries.toHour}h${todo.reminderSeries.untilDone ? ' · até marcar feito' : ''}`}
              />
            ) : null}

            {notes ? (
              <View style={styles.notesBlock}>
                <Text style={styles.rowLabel}>Detalhes</Text>
                <Text style={styles.notes}>{notes}</Text>
              </View>
            ) : null}

            {!location &&
            !notes &&
            !event?.broadcastStartAt &&
            !todo?.dueAt &&
            event &&
            !event.allDay ? (
              <Text style={styles.emptyHint}>
                Só o horário na agenda. Em eventos públicos (esporte, shows), a
                IA costuma trazer local e transmissão quando achar na web.
              </Text>
            ) : null}

            {!location && !notes && !todo?.dueAt && todo ? (
              <Text style={styles.emptyHint}>
                Sem detalhes extras. Toque em prazo para definir uma data.
              </Text>
            ) : null}
          </ScrollView>

          <View style={styles.actions}>
            {todo && onEditDue ? (
              <Pressable style={styles.secondaryBtn} onPress={onEditDue}>
                <Text style={styles.secondaryText}>Prazo</Text>
              </Pressable>
            ) : null}
            {onDelete ? (
              <Pressable style={styles.dangerBtn} onPress={onDelete}>
                <Text style={styles.dangerText}>Apagar</Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.primaryBtn} onPress={onClose}>
              <Text style={styles.primaryText}>Fechar</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 28,
    maxHeight: '78%',
    gap: 10,
  },
  kicker: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: colors.accent,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  title: {
    fontFamily: 'Fraunces_600SemiBold',
    fontSize: 24,
    color: colors.ink,
    lineHeight: 30,
  },
  body: { marginTop: 4 },
  row: { marginBottom: 12, gap: 3 },
  rowLabel: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: colors.inkMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  rowValue: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 16,
    color: colors.ink,
    lineHeight: 22,
  },
  notesBlock: { marginBottom: 12, gap: 4 },
  notes: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 15,
    color: colors.ink,
    lineHeight: 22,
  },
  emptyHint: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: colors.inkMuted,
    lineHeight: 20,
    marginTop: 4,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  primaryBtn: {
    flex: 1,
    backgroundColor: colors.ink,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    color: '#fff',
  },
  secondaryBtn: {
    paddingHorizontal: 16,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
  },
  secondaryText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    color: colors.accentDeep,
  },
  dangerBtn: {
    paddingHorizontal: 16,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: colors.bgSoft,
  },
  dangerText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    color: colors.danger,
  },
});
