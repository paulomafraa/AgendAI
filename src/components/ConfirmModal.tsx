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
import type { PendingAction } from '../types';

type Props = {
  pending: PendingAction | null;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

const actionLabel: Record<string, string> = {
  create_task: 'Tarefa',
  complete_task: 'Concluir',
  delete_task: 'Apagar',
  set_task_due: 'Prazo',
  create_event: 'Evento',
  reschedule_event: 'Remarcar',
  list_tasks: 'Listar',
  unknown: '?',
};

export function ConfirmModal({ pending, busy, onConfirm, onCancel }: Props) {
  if (!pending) return null;
  const { batch } = pending;
  const count = batch.items.length;

  return (
    <Modal transparent animationType="fade" visible>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.kicker}>Confirmar</Text>
          <Text style={styles.title}>
            {count === 1 ? '1 item' : `${count} itens`}
          </Text>
          <Text style={styles.summary}>{batch.summary}</Text>

          <ScrollView style={styles.list}>
            {batch.items.map((item, index) => (
              <View key={`${item.title}-${index}`} style={styles.box}>
                <Text style={styles.badge}>
                  {actionLabel[item.action] ?? item.action}
                  {item.category ? ` · ${item.category}` : ''}
                </Text>
                <Text style={styles.value}>{item.title}</Text>
                {item.dueDate ? (
                  <Text style={styles.meta}>
                    Prazo{' '}
                    {new Date(item.dueDate).toLocaleDateString('pt-BR')}
                  </Text>
                ) : null}
                {item.datetime ? (
                  <Text style={styles.meta}>
                    {item.allDay
                      ? `${new Date(item.datetime).toLocaleDateString('pt-BR')} · dia inteiro`
                      : item.softTime
                        ? `${new Date(item.datetime).toLocaleDateString('pt-BR')} · sugerido 13:00`
                        : new Date(item.datetime).toLocaleString('pt-BR')}
                    {item.wantsReminder
                      ? ` · lembrete ${item.reminderMinutes ?? 30} min antes`
                      : ''}
                  </Text>
                ) : null}
                {item.reminderSeries ? (
                  <Text style={styles.meta}>
                    Série a cada {item.reminderSeries.intervalMinutes} min ·{' '}
                    {item.reminderSeries.fromHour}h–
                    {item.reminderSeries.toHour}h
                    {item.reminderSeries.untilDone !== false
                      ? ' · até marcar feito'
                      : ''}
                  </Text>
                ) : null}
                {item.location ? (
                  <Text style={styles.meta}>{item.location}</Text>
                ) : null}
                {item.broadcastStartAt ? (
                  <Text style={styles.meta}>
                    Transmissão / pré{' '}
                    {new Date(item.broadcastStartAt).toLocaleString('pt-BR')}
                  </Text>
                ) : null}
                {item.notes ? (
                  <Text style={styles.meta}>{item.notes}</Text>
                ) : null}
              </View>
            ))}
          </ScrollView>

          <View style={styles.row}>
            <Pressable
              style={[styles.btn, styles.ghost]}
              onPress={onCancel}
              disabled={busy}
            >
              <Text style={styles.ghostText}>Cancelar</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, styles.primary]}
              onPress={onConfirm}
              disabled={busy}
            >
              <Text style={styles.primaryText}>
                {busy ? 'Salvando…' : 'Confirmar'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 22,
    gap: 10,
    maxHeight: '85%',
  },
  kicker: {
    fontFamily: 'DMSans_500Medium',
    color: colors.accent,
    fontSize: 13,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: 'Fraunces_600SemiBold',
    fontSize: 24,
    color: colors.ink,
  },
  summary: {
    fontFamily: 'DMSans_400Regular',
    color: colors.inkMuted,
    fontSize: 15,
    lineHeight: 22,
  },
  list: {
    marginTop: 4,
    maxHeight: 280,
  },
  box: {
    backgroundColor: colors.bgSoft,
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
    gap: 4,
  },
  badge: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 11,
    color: colors.accentDeep,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  value: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 16,
    color: colors.ink,
  },
  meta: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: colors.inkMuted,
  },
  row: { flexDirection: 'row', gap: 10, marginTop: 8 },
  btn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  ghost: {
    backgroundColor: colors.bgSoft,
  },
  ghostText: {
    fontFamily: 'DMSans_500Medium',
    color: colors.ink,
  },
  primary: {
    backgroundColor: colors.accent,
  },
  primaryText: {
    fontFamily: 'DMSans_500Medium',
    color: '#fff',
  },
});
