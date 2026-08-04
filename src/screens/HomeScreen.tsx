import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useApp } from '../context/AppContext';
import { ConfirmModal } from '../components/ConfirmModal';
import { DueDateModal } from '../components/DueDateModal';
import { ItemDetailModal } from '../components/ItemDetailModal';
import { SoftTimePromptModal } from '../components/SoftTimePromptModal';
import { UndoBar } from '../components/UndoBar';
import { VoiceWaveRings } from '../components/VoiceWaveRings';
import { getSpeechModule, isSpeechAvailable, SPEECH_END_SILENCE_MS } from '../services/speech';
import type { SpeechResultEvent } from '../services/speech';
import { addVoiceQuickActionListener } from '../services/voiceShortcut';
import type { RootTabParamList } from '../navigation/types';
import { colors } from '../theme/colors';
import type { CalendarEventItem, TodoItem } from '../types';
import {
  isEventPast,
  pickHomeAgendaEvents,
  taskDeadlineTone,
  todayKeySaoPaulo,
  dayKeySaoPaulo,
  tomorrowKeySaoPaulo,
} from '../utils/eventTime';
import { useNowTick } from '../hooks/useNowTick';
import { isAgendaiVoiceDeepLink } from '../utils/security';

function urlWantsVoice(url: string | null): boolean {
  return isAgendaiVoiceDeepLink(url);
}

function formatEventTime(item: CalendarEventItem, nowMs: number): string {
  if (item.allDay) {
    const today = todayKeySaoPaulo(new Date(nowMs));
    const key = dayKeySaoPaulo(item.startAt);
    if (key === today) return 'Dia todo';
    if (key === tomorrowKeySaoPaulo(new Date(nowMs))) return 'Amanhã';
    return new Date(item.startAt).toLocaleDateString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
    });
  }
  const today = todayKeySaoPaulo(new Date(nowMs));
  const tomorrow = tomorrowKeySaoPaulo(new Date(nowMs));
  const key = dayKeySaoPaulo(item.startAt);
  const time = new Date(item.startAt).toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  });
  if (key === today) {
    if (item.softTime && !item.softResolved) return `${time}*`;
    return time;
  }
  if (key === tomorrow) return `am ${time}`;
  const day = new Date(item.startAt).toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
  });
  return `${day} ${time}`;
}

/** Home: só o núcleo do título (sem "· Corrida", categoria, etc.). */
function shortHomeTitle(title: string): string {
  const t = title.trim();
  const cut = t.split(/\s+[·|–—]\s+/)[0]?.trim();
  if (cut && cut.length >= 3 && cut.length < t.length) return cut;
  return t;
}

function agendaSlotKey(event: CalendarEventItem): string {
  const day = dayKeySaoPaulo(event.startAt);
  if (event.allDay) return `${day}|allday`;
  const hm = new Date(event.startAt).toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${day}|${hm}`;
}

type HomeAgendaBlock = {
  key: string;
  timeLabel: string;
  past: boolean;
  events: CalendarEventItem[];
};

function buildHomeAgendaBlocks(
  items: CalendarEventItem[],
  nowMs: number,
): HomeAgendaBlock[] {
  const blocks: HomeAgendaBlock[] = [];
  const indexByKey = new Map<string, number>();
  for (const event of items) {
    const key = agendaSlotKey(event);
    const existing = indexByKey.get(key);
    if (existing != null) {
      blocks[existing].events.push(event);
      blocks[existing].past =
        blocks[existing].past && isEventPast(event, nowMs);
      continue;
    }
    indexByKey.set(key, blocks.length);
    blocks.push({
      key,
      timeLabel: formatEventTime(event, nowMs),
      past: isEventPast(event, nowMs),
      events: [event],
    });
  }
  return blocks;
}

function titleFontSize(title: string): number {
  const n = title.trim().length;
  if (n > 42) return 11;
  if (n > 28) return 12;
  return 14;
}

function DeadlineDot({ dueAt, nowMs }: { dueAt?: string; nowMs: number }) {
  const tone = taskDeadlineTone(dueAt, new Date(nowMs));
  return (
    <View
      style={[
        styles.deadlineDot,
        tone === 'green' && styles.dotGreen,
        tone === 'yellow' && styles.dotYellow,
        tone === 'red' && styles.dotRed,
      ]}
    />
  );
}

export function HomeScreen() {
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const navigation =
    useNavigation<BottomTabNavigationProp<RootTabParamList>>();
  const {
    submitInput,
    busy,
    error,
    clearError,
    pending,
    confirmPending,
    cancelPending,
    todos,
    events,
    settings,
    lastSyncNote,
    queuedCount,
    queueProcessing,
    setTodoDue,
    syncTasksFromGoogle,
    softPromptEvent,
    resolveSoftTimeDone,
    resolveSoftTimeReschedule,
    dismissSoftTimePrompt,
  } = useApp();

  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [voiceVolume, setVoiceVolume] = useState(0);
  const [voiceDraft, setVoiceDraft] = useState('');
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [composerHeight, setComposerHeight] = useState(120);
  const [inputFocused, setInputFocused] = useState(false);
  const [detailEvent, setDetailEvent] = useState<CalendarEventItem | null>(
    null,
  );
  const [detailTodo, setDetailTodo] = useState<TodoItem | null>(null);
  const [editingDue, setEditingDue] = useState<TodoItem | null>(null);
  const speechOk = isSpeechAvailable();
  const keyboardOpen = keyboardHeight > 0;
  const handsFree = !settings.confirmBeforeSave;
  // Mic fica embaixo; some só com teclado aberto (polegar livre ao digitar)
  const showMicDock = !keyboardOpen && !inputFocused;

  const busyRef = useRef(busy);
  const handsFreeRef = useRef(handsFree);
  const submitRef = useRef(submitInput);
  const autoSubmittedRef = useRef(false);
  const endSilenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestVoiceRef = useRef('');
  busyRef.current = busy;
  handsFreeRef.current = handsFree;
  submitRef.current = submitInput;

  const clearEndSilenceTimer = useCallback(() => {
    if (endSilenceTimerRef.current) {
      clearTimeout(endSilenceTimerRef.current);
      endSilenceTimerRef.current = null;
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void syncTasksFromGoogle();
    }, [syncTasksFromGoogle]),
  );

  const dismissKeyboard = useCallback(() => {
    Keyboard.dismiss();
    inputRef.current?.blur();
    setInputFocused(false);
  }, []);

  const submitVoice = useCallback(
    async (transcript: string) => {
      const payload = transcript.trim();
      if (!payload || busyRef.current || autoSubmittedRef.current) return;
      autoSubmittedRef.current = true;
      clearEndSilenceTimer();
      setText(payload);
      setVoiceDraft(payload);
      dismissKeyboard();
      try {
        await submitRef.current(payload, 'voice');
        setText('');
        setVoiceDraft('');
        latestVoiceRef.current = '';
      } finally {
        autoSubmittedRef.current = false;
      }
    },
    [clearEndSilenceTimer, dismissKeyboard],
  );

  const finishListeningAfterSilence = useCallback(
    (transcript: string) => {
      const speech = getSpeechModule();
      try {
        speech?.stop();
      } catch {
        // ignore
      }
      if (handsFreeRef.current) {
        void submitVoice(transcript);
      }
    },
    [submitVoice],
  );

  const bumpEndSilenceTimer = useCallback(
    (transcript: string) => {
      latestVoiceRef.current = transcript;
      clearEndSilenceTimer();
      endSilenceTimerRef.current = setTimeout(() => {
        endSilenceTimerRef.current = null;
        finishListeningAfterSilence(latestVoiceRef.current);
      }, SPEECH_END_SILENCE_MS);
    },
    [clearEndSilenceTimer, finishListeningAfterSilence],
  );

  useEffect(() => {
    const showEvent =
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent =
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const show = Keyboard.addListener(showEvent, (e) => {
      const height = e.endCoordinates.height;
      setKeyboardHeight(height > 0 ? height : 0);
    });
    const hide = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });

    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => {
    const speech = getSpeechModule();
    if (!speech) return;

    const subs = [
      speech.addListener('start', () => {
        setListening(true);
        setVoiceVolume(0);
        autoSubmittedRef.current = false;
        clearEndSilenceTimer();
      }),
      speech.addListener('end', () => {
        setListening(false);
        setVoiceVolume(0);
      }),
      speech.addListener('volumechange', (event) => {
        const value = (event as { value?: number }).value;
        if (typeof value === 'number') setVoiceVolume(value);
      }),
      speech.addListener('result', (event) => {
        const e = event as SpeechResultEvent;
        const transcript = (e.results[0]?.transcript ?? '').trim();
        if (!transcript) return;
        setVoiceDraft(transcript);
        setText(transcript);
        // Qualquer trecho novo reinicia a espera de ~3s de silêncio
        bumpEndSilenceTimer(transcript);
      }),
      speech.addListener('error', () => {
        setListening(false);
        setVoiceVolume(0);
        clearEndSilenceTimer();
      }),
    ];

    return () => {
      clearEndSilenceTimer();
      subs.forEach((s) => s.remove());
      try {
        speech.abort();
      } catch {
        // ignore
      }
    };
  }, [bumpEndSilenceTimer, clearEndSilenceTimer]);

  const startListening = useCallback(async () => {
    const speech = getSpeechModule();
    if (!speech || busyRef.current) return;
    try {
      const perm = await speech.requestPermissionsAsync();
      if (!perm.granted) return;
      setVoiceDraft('');
      latestVoiceRef.current = '';
      clearError();
      dismissKeyboard();
      autoSubmittedRef.current = false;
      clearEndSilenceTimer();
      speech.start({
        lang: 'pt-BR',
        interimResults: true,
        continuous: true,
        androidIntentOptions: {
          EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS:
            SPEECH_END_SILENCE_MS,
          EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS:
            SPEECH_END_SILENCE_MS,
          EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS: 1200,
        },
        volumeChangeEventOptions: {
          enabled: true,
          intervalMillis: 80,
        },
      });
    } catch {
      // ignore
    }
  }, [clearEndSilenceTimer, clearError, dismissKeyboard]);

  const toggleMic = async () => {
    const speech = getSpeechModule();
    if (!speech) return;

    if (listening) {
      clearEndSilenceTimer();
      speech.stop();
      if (handsFree && voiceDraft.trim()) {
        await submitVoice(voiceDraft);
      }
      return;
    }
    await startListening();
  };

  useEffect(() => {
    const handleUrl = (url: string | null) => {
      if (!urlWantsVoice(url)) return;
      navigation.navigate('Home');
      void startListening();
    };
    void Linking.getInitialURL().then(handleUrl);
    const sub = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    const quick = addVoiceQuickActionListener(() => {
      navigation.navigate('Home');
      void startListening();
    });
    return () => {
      sub.remove();
      quick.remove();
    };
  }, [navigation, startListening]);

  const onSend = async () => {
    const payload = text.trim();
    if (!payload || busy) return;
    const source = voiceDraft.trim() === payload ? 'voice' : 'text';
    dismissKeyboard();
    await submitInput(payload, source);
    setText('');
    setVoiceDraft('');
  };

  const homeTasks = todos
    .filter((t) => !t.done)
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

  const nowMs = useNowTick(20_000);

  const homeEvents = pickHomeAgendaEvents(events, nowMs, 12);
  const homeAgendaBlocks = buildHomeAgendaBlocks(homeEvents, nowMs);

  return (
    <View style={styles.root}>
      <View
        style={[
          styles.main,
          {
            paddingTop: Math.max(insets.top, 16) + 8,
            paddingBottom: composerHeight + 8,
          },
        ]}
      >
        <Pressable onPress={dismissKeyboard}>
          <Text style={styles.brand}>AgendAI</Text>
          <Text style={styles.tagline}>
            Fale ou digite. Eu organizo tarefas e lembretes.
          </Text>
        </Pressable>

        <View style={styles.textCard}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder='Digite: "comprar ração pros cachorros"'
            placeholderTextColor={colors.inkMuted}
            value={text}
            onChangeText={setText}
            multiline
            editable={!busy}
            blurOnSubmit={false}
            showSoftInputOnFocus
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {lastSyncNote && !error ? (
            <Text style={styles.syncNote}>{lastSyncNote}</Text>
          ) : null}
          {queuedCount > 0 ? (
            <Text style={styles.syncNote}>
              {queueProcessing
                ? queuedCount === 1
                  ? 'Processando (pode trocar de app)'
                  : `Processando fila (${queuedCount}) — pode trocar de app`
                : queuedCount === 1
                  ? '1 pedido aguardando na fila'
                  : `${queuedCount} pedidos aguardando na fila`}
            </Text>
          ) : null}
          <Pressable
            style={[
              styles.send,
              (!text.trim() || busy) && styles.sendDisabled,
            ]}
            onPress={onSend}
            disabled={!text.trim() || busy}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.sendText}>Enviar texto</Text>
            )}
          </Pressable>
        </View>

        {!settings.aiApiKey ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              Em Ajustes, cole sua chave da IA para o app entender os pedidos.
              Recomendamos a do Google (Gemini).
            </Text>
          </View>
        ) : null}

        {!speechOk ? (
          <View style={styles.infoBanner}>
            <Text style={styles.infoBannerText}>
              Voz indisponível neste ambiente. Use texto ou reinstale o APK
              nativo mais recente.
            </Text>
          </View>
        ) : null}

        <View style={styles.split}>
          <View style={styles.panel}>
            <Pressable
              style={styles.panelHead}
              onPress={() => {
                dismissKeyboard();
                navigation.navigate('Tasks');
              }}
            >
              <Text style={styles.panelTitle}>Tarefas</Text>
              <Text style={styles.panelCount}>{homeTasks.length}</Text>
            </Pressable>
            <FlatList
              data={homeTasks}
              keyExtractor={(item) => item.id}
              style={styles.panelList}
              contentContainerStyle={styles.panelListContent}
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={
                <Text style={styles.panelEmpty}>Nenhuma aberta</Text>
              }
              renderItem={({ item }: { item: TodoItem }) => (
                <Pressable
                  style={styles.compactRow}
                  onPress={() => {
                    dismissKeyboard();
                    setDetailTodo(item);
                  }}
                >
                  <View style={styles.leadingSlot}>
                    <DeadlineDot dueAt={item.dueAt} nowMs={nowMs} />
                  </View>
                  <Text
                    style={[
                      styles.compactTitle,
                      { fontSize: titleFontSize(item.title) },
                    ]}
                    numberOfLines={2}
                  >
                    {item.title}
                  </Text>
                </Pressable>
              )}
            />
          </View>

          <View style={styles.panel}>
            <Pressable
              style={styles.panelHead}
              onPress={() => {
                dismissKeyboard();
                navigation.navigate('Events');
              }}
            >
              <Text style={styles.panelTitle}>Agenda</Text>
              <Text style={styles.panelCount}>{homeEvents.length}</Text>
            </Pressable>
            <FlatList
              data={homeAgendaBlocks}
              keyExtractor={(block) => block.key}
              style={styles.panelList}
              contentContainerStyle={styles.panelListContent}
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={
                <Text style={styles.panelEmpty}>Nenhum compromisso próximo</Text>
              }
              renderItem={({ item: block }: { item: HomeAgendaBlock }) => (
                <View
                  style={[
                    styles.agendaBlock,
                    block.events.length === 1 && styles.agendaBlockSingle,
                    block.past && styles.compactRowPast,
                  ]}
                >
                  <View style={styles.leadingSlot}>
                    <Text
                      style={[
                        styles.compactTime,
                        block.past && styles.compactTextPast,
                      ]}
                    >
                      {block.timeLabel}
                    </Text>
                  </View>
                  <View style={styles.agendaTopics}>
                    {block.events.map((event) => {
                      const label = shortHomeTitle(event.title);
                      return (
                        <Pressable
                          key={event.id}
                          onPress={() => {
                            dismissKeyboard();
                            setDetailEvent(event);
                          }}
                          hitSlop={4}
                        >
                          <Text
                            style={[
                              styles.compactTitle,
                              block.past && styles.compactTextPast,
                              { fontSize: titleFontSize(label) },
                            ]}
                            numberOfLines={2}
                          >
                            {block.events.length > 1 ? `• ${label}` : label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              )}
            />
          </View>
        </View>
      </View>

      <View
        style={[styles.composerDock, { bottom: keyboardHeight }]}
        onLayout={(e) => setComposerHeight(e.nativeEvent.layout.height)}
      >
        {keyboardOpen ? (
          <Pressable style={styles.dismissBar} onPress={dismissKeyboard}>
            <Text style={styles.dismissText}>Fechar teclado</Text>
          </Pressable>
        ) : null}

        {showMicDock ? (
          <View
            style={[
              styles.micDock,
              { paddingBottom: Math.max(insets.bottom, 12) },
            ]}
          >
            {listening ? (
              <Text style={styles.listening}>
                Ouvindo… {voiceDraft || 'pode falar'}
                {handsFree ? ' · gravo ao terminar' : ''}
              </Text>
            ) : null}
            <Pressable
              style={[
                styles.voiceHero,
                listening && styles.voiceHeroOn,
                (!speechOk || busy) && styles.voiceHeroDisabled,
              ]}
              onPress={toggleMic}
              disabled={busy || !speechOk}
              accessibilityRole="button"
              accessibilityLabel={listening ? 'Parar de ouvir' : 'Falar'}
            >
              <View style={styles.micStage}>
                <VoiceWaveRings active={listening} volume={voiceVolume} />
                <Ionicons
                  name={listening ? 'stop-circle' : 'mic'}
                  size={40}
                  color="#fff"
                />
              </View>
              <Text style={styles.voiceHeroSub}>
                {listening
                  ? voiceDraft || 'Pode falar agora'
                  : handsFree
                    ? 'Toque, fale e eu gravo ao terminar.'
                    : 'Toque para ditar.'}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <UndoBar />

      <ItemDetailModal
        event={detailEvent}
        todo={detailTodo}
        onClose={() => {
          setDetailEvent(null);
          setDetailTodo(null);
        }}
        onEditDue={
          detailTodo
            ? () => {
                setEditingDue(detailTodo);
                setDetailTodo(null);
              }
            : undefined
        }
      />

      <DueDateModal
        visible={Boolean(editingDue)}
        title={editingDue?.title ?? ''}
        currentDueAt={editingDue?.dueAt}
        onClose={() => setEditingDue(null)}
        onPick={(dueAt) => {
          if (editingDue) void setTodoDue(editingDue.id, dueAt);
        }}
      />

      <ConfirmModal
        pending={pending}
        busy={busy}
        onConfirm={confirmPending}
        onCancel={cancelPending}
      />

      <SoftTimePromptModal
        event={softPromptEvent}
        onDone={() => {
          if (softPromptEvent) void resolveSoftTimeDone(softPromptEvent.id);
        }}
        onReschedule={(hour) => {
          if (softPromptEvent) {
            void resolveSoftTimeReschedule(softPromptEvent.id, hour);
          }
        }}
        onDismiss={dismissSoftTimePrompt}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  main: { flex: 1, paddingHorizontal: 20 },
  brand: {
    fontFamily: 'Fraunces_700Bold',
    fontSize: 32,
    color: colors.ink,
    letterSpacing: -0.5,
  },
  tagline: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: colors.inkMuted,
    marginTop: 2,
    marginBottom: 10,
    lineHeight: 20,
  },
  textCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 12,
    gap: 10,
    marginBottom: 10,
  },
  input: {
    minHeight: 48,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: 'DMSans_400Regular',
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.bg,
  },
  send: {
    backgroundColor: colors.ink,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  sendDisabled: { opacity: 0.35 },
  sendText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 15,
    color: '#fff',
  },
  error: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#B91C1C',
    lineHeight: 18,
  },
  syncNote: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: colors.accent,
    lineHeight: 18,
  },
  banner: {
    backgroundColor: '#FEF3C7',
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
  },
  bannerText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#92400E',
    lineHeight: 18,
  },
  infoBanner: {
    backgroundColor: colors.accentSoft,
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
  },
  infoBannerText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: colors.ink,
    lineHeight: 18,
  },
  split: {
    flex: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 160,
  },
  panel: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: 'hidden',
  },
  panelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  panelTitle: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: colors.ink,
  },
  panelCount: {
    fontFamily: 'Fraunces_600SemiBold',
    fontSize: 16,
    color: colors.accentDeep,
  },
  panelList: { flex: 1 },
  panelListContent: { paddingVertical: 4, paddingBottom: 8 },
  panelEmpty: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: colors.inkMuted,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 34,
  },
  agendaBlock: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 34,
  },
  agendaBlockSingle: {
    alignItems: 'center',
  },
  leadingSlot: {
    width: 48,
    minHeight: 18,
    flexShrink: 0,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  agendaTopics: {
    flex: 1,
    flexShrink: 1,
    gap: 4,
    justifyContent: 'center',
  },
  compactRowPast: {
    opacity: 0.55,
  },
  compactTime: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    lineHeight: 18,
    color: colors.accentDeep,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  compactTitle: {
    flex: 1,
    flexShrink: 1,
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    lineHeight: 18,
    color: colors.ink,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  compactTextPast: {
    color: colors.inkMuted,
  },
  deadlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: 2,
    flexShrink: 0,
  },
  dotGreen: { backgroundColor: '#22C55E' },
  dotYellow: { backgroundColor: '#EAB308' },
  dotRed: { backgroundColor: '#EF4444' },
  composerDock: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  dismissBar: {
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  dismissText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: colors.accent,
  },
  micDock: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 6,
  },
  listening: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: colors.accent,
    textAlign: 'center',
  },
  voiceHero: {
    backgroundColor: colors.accent,
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 112,
    overflow: 'visible',
  },
  voiceHeroOn: { backgroundColor: '#0D9488' },
  voiceHeroDisabled: { opacity: 0.45 },
  micStage: {
    width: 92,
    height: 92,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceHeroSub: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: 'rgba(255,255,255,0.9)',
    textAlign: 'center',
    marginTop: 2,
    lineHeight: 16,
    maxWidth: 280,
  },
});
