import React from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../context/AppContext';
import { colors } from '../theme/colors';

const actionLabel: Record<string, string> = {
  create_task: 'Tarefa',
  complete_task: 'Conclusão',
  delete_task: 'Apagar',
  set_task_due: 'Prazo',
  create_event: 'Evento',
  reschedule_event: 'Remarcar',
  list_tasks: 'Listagem',
  unknown: 'Desconhecido',
  batch: 'Vários itens',
};

export function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const { history, submitInput, busy } = useApp();

  return (
    <View style={[styles.root, { paddingTop: Math.max(insets.top, 16) + 12 }]}>
      <Text style={styles.heading}>Histórico</Text>
      <Text style={styles.sub}>
        O que você pediu e quando. Toque em Repetir para rodar de novo.
      </Text>
      <FlatList
        data={history}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>Ainda sem histórico.</Text>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.top}>
              <Text style={styles.badge}>
                {actionLabel[item.action] ?? item.action}
              </Text>
              <Text style={styles.source}>
                {item.source === 'voice' ? 'voz' : 'texto'}
              </Text>
            </View>
            <Text style={styles.raw}>“{item.rawInput}”</Text>
            <Text style={styles.summary}>{item.summary}</Text>
            {item.detail ? (
              <Text style={styles.detail}>{item.detail}</Text>
            ) : null}
            <View style={styles.footer}>
              <Text style={styles.when}>
                {new Date(item.createdAt).toLocaleString('pt-BR')}
                {item.success ? '' : ' · falhou'}
              </Text>
              {item.rawInput.trim() ? (
                <Pressable
                  onPress={() => void submitInput(item.rawInput, item.source)}
                  disabled={busy}
                  hitSlop={8}
                >
                  <Text style={styles.repeat}>Repetir</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  heading: {
    fontFamily: 'Fraunces_700Bold',
    fontSize: 32,
    color: colors.ink,
    paddingHorizontal: 24,
  },
  sub: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 15,
    color: colors.inkMuted,
    paddingHorizontal: 24,
    marginTop: 4,
    marginBottom: 12,
  },
  list: { paddingHorizontal: 24, paddingBottom: 40, gap: 10 },
  empty: {
    fontFamily: 'DMSans_400Regular',
    color: colors.inkMuted,
    marginTop: 24,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 14,
    gap: 6,
  },
  top: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  badge: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: colors.accentDeep,
    backgroundColor: colors.accentSoft,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  source: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: colors.inkMuted,
    textTransform: 'uppercase',
  },
  raw: {
    fontFamily: 'Fraunces_600SemiBold',
    fontSize: 17,
    color: colors.ink,
    marginTop: 4,
  },
  summary: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: colors.inkMuted,
  },
  detail: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: colors.ink,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  when: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: colors.inkMuted,
  },
  repeat: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: colors.accent,
  },
});
