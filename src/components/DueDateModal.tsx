import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors } from '../theme/colors';
import { formatDueDatePtBr } from '../services/ai/shared';

type Props = {
  visible: boolean;
  title: string;
  currentDueAt?: string;
  onPick: (dueAt: string | null) => void;
  onClose: () => void;
};

function atNoonSaoPaulo(daysFromToday: number): string {
  const now = new Date();
  const local = new Date(
    now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }),
  );
  local.setHours(12, 0, 0, 0);
  local.setDate(local.getDate() + daysFromToday);
  return local.toISOString();
}

const PRESETS: Array<{ label: string; days: number | null }> = [
  { label: 'Hoje', days: 0 },
  { label: 'Amanhã', days: 1 },
  { label: 'Em 3 dias', days: 3 },
  { label: 'Em 1 semana', days: 7 },
  { label: 'Em 2 semanas', days: 14 },
];

/** Modal leve para definir ou limpar prazo de uma tarefa. */
export function DueDateModal({
  visible,
  title,
  currentDueAt,
  onPick,
  onClose,
}: Props) {
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.kicker}>Prazo</Text>
          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>
          {currentDueAt ? (
            <Text style={styles.current}>
              Atual: {formatDueDatePtBr(currentDueAt)}
            </Text>
          ) : (
            <Text style={styles.current}>Sem prazo definido</Text>
          )}

          <View style={styles.presets}>
            {PRESETS.map((p) => (
              <Pressable
                key={p.label}
                style={styles.preset}
                onPress={() => {
                  onPick(atNoonSaoPaulo(p.days as number));
                  onClose();
                }}
              >
                <Text style={styles.presetText}>{p.label}</Text>
              </Pressable>
            ))}
          </View>

          {currentDueAt ? (
            <Pressable
              style={styles.clear}
              onPress={() => {
                onPick(null);
                onClose();
              }}
            >
              <Text style={styles.clearText}>Remover prazo</Text>
            </Pressable>
          ) : null}

          <Pressable style={styles.cancel} onPress={onClose}>
            <Text style={styles.cancelText}>Fechar</Text>
          </Pressable>
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
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 28,
    gap: 10,
  },
  kicker: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: colors.inkMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  title: {
    fontFamily: 'Fraunces_600SemiBold',
    fontSize: 22,
    color: colors.ink,
  },
  current: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: colors.inkMuted,
    marginBottom: 4,
  },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  preset: {
    backgroundColor: colors.bgSoft,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  presetText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: colors.ink,
  },
  clear: { paddingVertical: 10, alignItems: 'center' },
  clearText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: colors.danger,
  },
  cancel: {
    marginTop: 4,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: colors.bgSoft,
    borderRadius: 12,
  },
  cancelText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    color: colors.ink,
  },
});
