import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors } from '../theme/colors';
import type { CalendarEventItem } from '../types';

type Props = {
  event: CalendarEventItem | null;
  onDone: () => void;
  onReschedule: (hour: number) => void;
  onDismiss: () => void;
};

const HOURS = [14, 15, 16, 17, 18, 19, 20, 21];

export function SoftTimePromptModal({
  event,
  onDone,
  onReschedule,
  onDismiss,
}: Props) {
  if (!event) return null;

  const nowHour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      hour12: false,
    })
      .formatToParts(new Date())
      .find((p) => p.type === 'hour')?.value ?? '13',
  );
  const laterHours = HOURS.filter((h) => h > nowHour);

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onDismiss}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.kicker}>Horário sugerido</Text>
          <Text style={styles.title}>{event.title}</Text>
          <Text style={styles.body}>
            Você não definiu hora, então sugerimos 13:00. Já fez, ou prefere
            marcar para mais tarde hoje?
          </Text>

          <Pressable style={styles.primary} onPress={onDone}>
            <Text style={styles.primaryText}>Já fiz</Text>
          </Pressable>

          {laterHours.length > 0 ? (
            <>
              <Text style={styles.section}>Remarcar para</Text>
              <View style={styles.hours}>
                {laterHours.map((h) => (
                  <Pressable
                    key={h}
                    style={styles.hourBtn}
                    onPress={() => onReschedule(h)}
                  >
                    <Text style={styles.hourText}>{`${h}:00`}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}

          <Pressable onPress={onDismiss} hitSlop={8}>
            <Text style={styles.later}>Perguntar de novo depois</Text>
          </Pressable>
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
    gap: 12,
  },
  kicker: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: colors.accent,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  title: {
    fontFamily: 'Fraunces_600SemiBold',
    fontSize: 22,
    color: colors.ink,
  },
  body: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 15,
    color: colors.inkMuted,
    lineHeight: 22,
  },
  primary: {
    backgroundColor: colors.accent,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 16,
    color: '#fff',
  },
  section: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: colors.inkMuted,
    marginTop: 4,
  },
  hours: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  hourBtn: {
    backgroundColor: colors.accentSoft,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  hourText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: colors.accentDeep,
  },
  later: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: colors.inkMuted,
    textAlign: 'center',
    marginTop: 6,
  },
});
