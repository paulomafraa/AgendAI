import React, { useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  Keyboard,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../context/AppContext';
import { detectProvider, providerLabel } from '../services/ai';
import {
  completeGoogleAuthWithPastedUrl,
  connectGoogleAccount,
  disconnectGoogleAccount,
  getGoogleRedirectUri,
  hasPendingGoogleAuth,
  isGoogleOAuthConfigured,
  loadGoogleTokens,
  saveGoogleClientIdOverride,
} from '../services/google';
import {
  openAppNotificationSettings,
  openReminderChannelSettings,
  REMINDER_SOUND_OPTIONS,
} from '../services/notifications';
import { GoogleGIcon } from '../components/GoogleGIcon';
import { colors } from '../theme/colors';
import * as Clipboard from 'expo-clipboard';
import { isSpeechAvailable } from '../services/speech';
import type { AppSettings } from '../types';
import { openSafeHttps } from '../utils/security';

const GEMINI_KEY_URL = 'https://aistudio.google.com/apikey';
const CLOUD_CREDENTIALS_URL =
  'https://console.cloud.google.com/apis/credentials';

export function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);
  const scrollYRef = useRef(0);
  const { settings, updateSettings, refreshGoogleStatus, syncAgendaWithGoogle } =
    useApp();
  const [keyDraft, setKeyDraft] = useState(settings.aiApiKey);
  const [clientIdDraft, setClientIdDraft] = useState(settings.googleWebClientId);
  const [googleMsg, setGoogleMsg] = useState<string | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [clientSaved, setClientSaved] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [showGuide, setShowGuide] = useState(false);
  const [showApiDetails, setShowApiDetails] = useState(false);
  const [showDevOptions, setShowDevOptions] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);
  const [googleEmail, setGoogleEmail] = useState<string | null>(null);
  const [copiedUri, setCopiedUri] = useState(false);
  const [needsUrlPaste, setNeedsUrlPaste] = useState(false);
  const [pastedGoogleUrl, setPastedGoogleUrl] = useState('');
  const redirectUri = getGoogleRedirectUri();

  useEffect(() => {
    setKeyDraft(settings.aiApiKey);
  }, [settings.aiApiKey]);

  useEffect(() => {
    setClientIdDraft(settings.googleWebClientId);
  }, [settings.googleWebClientId]);

  useEffect(() => {
    void (async () => {
      setGoogleReady(await isGoogleOAuthConfigured());
      const tokens = await loadGoogleTokens();
      setGoogleEmail(tokens?.email ?? null);
    })();
  }, [settings.googleConnected, settings.googleWebClientId]);

  useEffect(() => {
    const showEvent =
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent =
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const ensureKeyFieldVisible = (kbHeight: number) => {
      if (kbHeight <= 0) return;
      const winH = Dimensions.get('window').height;
      const keyboardTop = winH - kbHeight;
      const margin = 12;
      inputRef.current?.measureInWindow((_x, y, _w, h) => {
        const bottom = y + h + margin;
        if (bottom <= keyboardTop) return;
        const delta = bottom - keyboardTop;
        scrollRef.current?.scrollTo({
          y: Math.max(0, scrollYRef.current + delta),
          animated: true,
        });
      });
    };

    const show = Keyboard.addListener(showEvent, (e) => {
      const h = e.endCoordinates.height;
      setKeyboardHeight(h);
      setTimeout(() => ensureKeyFieldVisible(h), 60);
    });
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const detected = detectProvider(keyDraft);
  const detectedLabel = providerLabel(detected);

  const saveKey = async () => {
    Keyboard.dismiss();
    await updateSettings({ aiApiKey: keyDraft.trim() });
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };

  const saveClientId = async () => {
    Keyboard.dismiss();
    const id = clientIdDraft.trim();
    await saveGoogleClientIdOverride(id);
    await updateSettings({ googleWebClientId: id });
    setGoogleReady(await isGoogleOAuthConfigured());
    setClientSaved(true);
    setTimeout(() => setClientSaved(false), 1600);
  };

  const copyRedirectUri = async () => {
    await Clipboard.setStringAsync(redirectUri);
    setCopiedUri(true);
    setTimeout(() => setCopiedUri(false), 1600);
  };

  const openGeminiGuide = async () => {
    setShowGuide(true);
    try {
      await openSafeHttps(GEMINI_KEY_URL);
    } catch {
      // ignore
    }
  };

  const applyGoogleResult = async (result: {
    ok: boolean;
    message: string;
  }) => {
    setGoogleMsg(result.message);
    await refreshGoogleStatus();
    const tokens = await loadGoogleTokens();
    setGoogleEmail(tokens?.email ?? null);
    if (result.ok) {
      setNeedsUrlPaste(false);
      setPastedGoogleUrl('');
      await updateSettings({ googleConnected: true, syncToGoogle: true });
    }
  };

  const onGoogleConnect = async () => {
    setGoogleBusy(true);
    setGoogleMsg(null);
    setNeedsUrlPaste(false);
    try {
      const result = await connectGoogleAccount();
      if (result.needsUrlPaste) {
        setNeedsUrlPaste(true);
        setGoogleMsg(result.message);
        return;
      }
      await applyGoogleResult(result);
      if (!result.ok && !(await isGoogleOAuthConfigured())) {
        setShowDevOptions(true);
      }
    } finally {
      setGoogleBusy(false);
    }
  };

  const onPasteGoogleUrl = async () => {
    setGoogleBusy(true);
    try {
      let url = pastedGoogleUrl.trim();
      if (!url) {
        url = (await Clipboard.getStringAsync()).trim();
        setPastedGoogleUrl(url);
      }
      const result = await completeGoogleAuthWithPastedUrl(url);
      await applyGoogleResult(result);
    } finally {
      setGoogleBusy(false);
    }
  };

  const onGoogleDisconnect = async () => {
    setGoogleBusy(true);
    try {
      await disconnectGoogleAccount();
      await updateSettings({ googleConnected: false });
      setGoogleEmail(null);
      setNeedsUrlPaste(false);
      setGoogleMsg('Google desconectado.');
    } finally {
      setGoogleBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView
        ref={scrollRef}
        style={styles.root}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: Math.max(insets.top, 16) + 12,
            paddingBottom: 48 + keyboardHeight,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScrollBeginDrag={Keyboard.dismiss}
        scrollEventThrottle={16}
        onScroll={(e) => {
          scrollYRef.current = e.nativeEvent.contentOffset.y;
        }}
      >
        <Pressable onPress={Keyboard.dismiss}>
          <Text style={styles.heading}>Ajustes</Text>

          <View style={styles.card}>
            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.label}>Confirmar antes de salvar</Text>
                <Text style={styles.hint}>
                  Por padrão vem desligado (salva ao terminar de falar). Ligue só
                  se quiser ver um resumo e confirmar antes.
                </Text>
              </View>
              <Switch
                value={settings.confirmBeforeSave}
                onValueChange={(v) => updateSettings({ confirmBeforeSave: v })}
                trackColor={{ false: colors.line, true: colors.accent }}
                thumbColor="#fff"
              />
            </View>
          </View>

          <View style={[styles.card, styles.cardGap]}>
            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.label}>Lembretes no celular</Text>
                <Text style={styles.hint}>
                  Avisa antes e na hora do compromisso, com som e vibração. Funciona
                  sem internet e sem e-mail.
                </Text>
              </View>
              <Switch
                value={settings.notificationsEnabled}
                onValueChange={(v) =>
                  updateSettings({ notificationsEnabled: v })
                }
                trackColor={{ false: colors.line, true: colors.accent }}
                thumbColor="#fff"
              />
            </View>
            {settings.notificationsEnabled ? (
              <>
                <View style={styles.sectionSpacer} />
                <View style={styles.hourRow}>
                  <Text style={styles.hint}>Resumo de manhã às</Text>
                  <View style={styles.hourBtns}>
                    {[7, 8, 9].map((h) => (
                      <Pressable
                        key={h}
                        style={[
                          styles.hourBtn,
                          settings.morningBriefHour === h && styles.hourBtnOn,
                        ]}
                        onPress={() => updateSettings({ morningBriefHour: h })}
                      >
                        <Text
                          style={[
                            styles.hourBtnText,
                            settings.morningBriefHour === h &&
                              styles.hourBtnTextOn,
                          ]}
                        >
                          {h}:00
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>

                <View style={styles.sectionSpacer} />
                <Text style={styles.label}>Som do lembrete</Text>
                <Text style={styles.hint}>
                  Suave é o recomendado. Sistema costuma ser mais agudo.
                </Text>
                <View style={styles.hourBtns}>
                  {REMINDER_SOUND_OPTIONS.map((opt) => (
                    <Pressable
                      key={opt.id}
                      style={[
                        styles.hourBtn,
                        settings.reminderSound === opt.id && styles.hourBtnOn,
                      ]}
                      onPress={() =>
                        updateSettings({
                          reminderSound: opt.id as AppSettings['reminderSound'],
                        })
                      }
                    >
                      <Text
                        style={[
                          styles.hourBtnText,
                          settings.reminderSound === opt.id &&
                            styles.hourBtnTextOn,
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                {Platform.OS === 'android' ? (
                  <>
                    <Pressable
                      onPress={() =>
                        void openReminderChannelSettings(settings.reminderSound)
                      }
                      hitSlop={6}
                    >
                      <Text style={styles.linkInline}>
                        Abrir som no Android
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => void openAppNotificationSettings()}
                      hitSlop={6}
                    >
                      <Text style={styles.linkInline}>
                        Permissões do app (notificação, alarme, bateria)
                      </Text>
                    </Pressable>
                  </>
                ) : null}
              </>
            ) : null}
            <View style={styles.sectionSpacer} />
            <Text style={styles.hint}>
              Dica: pressione o ícone do AgendAI e escolha Voz para falar rápido.
              No Android, você também pode adicionar widgets (Tarefas, Agenda ou
              os dois) na tela inicial; o botão do microfone no widget abre o app
              já ouvindo.
            </Text>
          </View>

          <View style={[styles.card, styles.cardGap]}>
            <Text style={styles.label}>Chave da inteligência</Text>
            <Text style={styles.hint}>
              É o “código” que permite o app entender o que você fala ou digita.
              Cole abaixo. Gemini (Google) costuma ser a opção mais simples.
            </Text>

            <View style={styles.recommend}>
              <Text style={styles.recommendTitle}>Sugestão: Google Gemini</Text>
              <Text style={styles.recommendBody}>
                Funciona bem com o AgendAI e o plano gratuito costuma bastar no
                começo.
              </Text>
              <Pressable style={styles.linkBtn} onPress={openGeminiGuide}>
                <Text style={styles.linkBtnText}>
                  Abrir site e ver como gerar a chave
                </Text>
              </Pressable>
            </View>

            {showGuide ? (
              <View style={styles.guide}>
                <Text style={styles.guideTitle}>Passo a passo (Gemini)</Text>
                <Text style={styles.hint}>
                  1. Faça login com sua conta Google{'\n'}
                  2. Toque em “Criar chave de API”{'\n'}
                  3. Escolha ou crie um projeto{'\n'}
                  4. Copie a chave{'\n'}
                  5. Volte ao AgendAI, cole abaixo e salve
                </Text>
                <Pressable onPress={() => setShowGuide(false)}>
                  <Text style={styles.dismissGuide}>Ocultar guia</Text>
                </Pressable>
              </View>
            ) : null}

            <TextInput
              ref={inputRef}
              style={styles.input}
              value={keyDraft}
              onChangeText={setKeyDraft}
              placeholder="Cole a chave aqui"
              placeholderTextColor={colors.inkMuted}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              textContentType="password"
              onFocus={() => {
                if (keyboardHeight > 0) {
                  setTimeout(() => {
                    const winH = Dimensions.get('window').height;
                    const keyboardTop = winH - keyboardHeight;
                    inputRef.current?.measureInWindow((_x, y, _w, h) => {
                      const bottom = y + h + 12;
                      if (bottom <= keyboardTop) return;
                      scrollRef.current?.scrollTo({
                        y: Math.max(
                          0,
                          scrollYRef.current + (bottom - keyboardTop),
                        ),
                        animated: true,
                      });
                    });
                  }, 80);
                }
              }}
            />

            {keyDraft.trim() ? (
              <Text style={styles.detect}>
                Detectamos: {detectedLabel}
              </Text>
            ) : null}

            <Pressable style={styles.btn} onPress={saveKey}>
              <Text style={styles.btnText}>
                {saved
                  ? 'Salva ✓'
                  : settings.aiApiKey
                    ? 'Atualizar chave'
                    : 'Salvar chave'}
              </Text>
            </Pressable>
            {settings.aiApiKey ? (
              <Text style={styles.okHint}>
                Chave pronta ({providerLabel(detectProvider(settings.aiApiKey))}
                ).
              </Text>
            ) : null}

            <Pressable
              onPress={() => setShowApiDetails((v) => !v)}
              hitSlop={6}
            >
              <Text style={styles.linkInline}>
                {showApiDetails
                  ? 'Ocultar detalhes técnicos'
                  : 'Mais detalhes técnicos (OpenAI, Claude…)'}
              </Text>
            </Pressable>
            {showApiDetails ? (
              <Text style={styles.hint}>
                Também aceita OpenAI (chave começa com sk-) e Anthropic Claude
                (sk-ant-). O app reconhece sozinho.
              </Text>
            ) : null}
          </View>

          <View style={[styles.card, styles.cardGap]}>
            <Text style={styles.label}>Google (opcional)</Text>
            <Text style={styles.hint}>
              O AgendAI já funciona sozinho no celular. Se quiser, pode ligar a
              Agenda e as Tarefas do Google para espelhar o que criar aqui.
            </Text>
            {!isSpeechAvailable() ? (
              <Text style={styles.hint}>
                Voz: use o APK Dev mais recente se o microfone não aparecer.
              </Text>
            ) : null}

            {settings.googleConnected ? (
              <>
                <Text style={styles.okHint}>
                  Conectado{googleEmail ? ` · ${googleEmail}` : ''}
                </Text>
                <Text style={styles.hint}>
                  Os compromissos do app vão para a Agenda Google. Apagar no app
                  tira só daqui (a Agenda fica). Para sumir dos dois, apague no
                  Calendar e sincronize. Sem Google, o app funciona sozinho.
                </Text>
                <View style={styles.row}>
                  <View style={styles.rowText}>
                    <Text style={styles.label}>Sincronizar ao salvar</Text>
                    <Text style={styles.hint}>
                      Envia novos itens para Agenda e Tasks. Desligado: fica só
                      no aparelho até você sincronizar.
                    </Text>
                  </View>
                  <Switch
                    value={settings.syncToGoogle}
                    onValueChange={(v) => updateSettings({ syncToGoogle: v })}
                    trackColor={{ false: colors.line, true: colors.accent }}
                    thumbColor="#fff"
                  />
                </View>
                <Pressable
                  style={styles.btn}
                  onPress={() => {
                    setGoogleBusy(true);
                    void (async () => {
                      try {
                        await syncAgendaWithGoogle();
                      } finally {
                        setGoogleBusy(false);
                      }
                    })();
                  }}
                  disabled={googleBusy}
                >
                  <Text style={styles.btnText}>
                    {googleBusy ? 'Sincronizando…' : 'Sincronizar agenda'}
                  </Text>
                </Pressable>
                <Text style={styles.hint}>
                  Use Continuar com o Google e escolha a conta certa na tela
                  nativa (não no navegador). O app sincroniza sozinho 1x por dia.
                </Text>
                <Pressable
                  style={styles.btnSecondary}
                  onPress={onGoogleDisconnect}
                  disabled={googleBusy}
                >
                  <Text style={styles.btnSecondaryText}>
                    {googleBusy ? 'Aguarde…' : 'Desconectar'}
                  </Text>
                </Pressable>
              </>
            ) : (
              <>
                <Pressable
                  style={styles.googleBtn}
                  onPress={onGoogleConnect}
                  disabled={googleBusy}
                >
                  <GoogleGIcon size={22} />
                  <Text style={styles.googleBtnText}>
                    {googleBusy ? 'Abrindo…' : 'Continuar com o Google'}
                  </Text>
                </Pressable>

                {(needsUrlPaste || hasPendingGoogleAuth()) && (
                  <View style={styles.pasteBox}>
                    <Text style={styles.guideTitle}>Finalizar login</Text>
                    <Text style={styles.hint}>
                      1. Na página “localhost / can’t be reached”, toque na barra
                      de endereço{'\n'}
                      2. Copie a URL inteira (tem “code=” no meio){'\n'}
                      3. Volte ao AgendAI, cole abaixo e confirme
                    </Text>
                    <TextInput
                      style={styles.input}
                      value={pastedGoogleUrl}
                      onChangeText={setPastedGoogleUrl}
                      placeholder="http://localhost/?code=..."
                      placeholderTextColor={colors.inkMuted}
                      autoCapitalize="none"
                      autoCorrect={false}
                      multiline
                    />
                    <Pressable
                      style={styles.btn}
                      onPress={onPasteGoogleUrl}
                      disabled={googleBusy}
                    >
                      <Text style={styles.btnText}>
                        {googleBusy ? 'Conectando…' : 'Confirmar URL colada'}
                      </Text>
                    </Pressable>
                  </View>
                )}
              </>
            )}
            {googleMsg ? <Text style={styles.hint}>{googleMsg}</Text> : null}
          </View>

          <Pressable
            style={styles.devToggle}
            onPress={() => setShowDevOptions((v) => !v)}
          >
            <Text style={styles.devToggleText}>
              {showDevOptions
                ? 'Ocultar configuração avançada do Google'
                : 'Configuração avançada do Google'}
            </Text>
          </Pressable>

          {showDevOptions ? (
            <View style={[styles.card, styles.cardGap]}>
              <Text style={styles.guideTitle}>Ativar login Google (1×)</Text>
              <Text style={styles.hint}>
                No Google Cloud (Client ID tipo Web), use exatamente estes
                valores. O Google não aceita o link exp:// do Expo:
              </Text>
              <Text style={styles.hint}>
                Origens JavaScript:{'\n'}
                http://localhost
              </Text>
              <Text style={styles.hint}>
                URI de redirecionamento:{'\n'}
                http://localhost/
              </Text>
              <Text style={styles.hint}>
                Se aparecer “acesso bloqueado / 403”, no Cloud Console → tela de
                consentimento OAuth → Usuários de teste → adicione seu Gmail.
              </Text>
              <Pressable style={styles.btnSecondary} onPress={copyRedirectUri}>
                <Text style={styles.btnSecondaryText}>
                  {copiedUri ? 'URI copiada ✓' : 'Copiar http://localhost/'}
                </Text>
              </Pressable>
              <Pressable
                style={styles.linkBtn}
                onPress={() => void openSafeHttps(CLOUD_CREDENTIALS_URL)}
              >
                <Text style={styles.linkBtnText}>Abrir Google Cloud</Text>
              </Pressable>
              <Text style={styles.hint}>
                Depois copie o Client ID e cole abaixo.
              </Text>
              <TextInput
                style={styles.input}
                value={clientIdDraft}
                onChangeText={setClientIdDraft}
                placeholder="Client ID …apps.googleusercontent.com"
                placeholderTextColor={colors.inkMuted}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Pressable style={styles.btnSecondary} onPress={saveClientId}>
                <Text style={styles.btnSecondaryText}>
                  {clientSaved ? 'Salvo ✓' : 'Salvar Client ID neste aparelho'}
                </Text>
              </Pressable>
              <Text style={styles.hint}>
                Status: {googleReady ? 'login pronto' : 'ainda falta o Client ID'}
              </Text>
            </View>
          ) : null}

          <Text style={styles.footer}>AgendAI · Android first · Expo</Text>
        </Pressable>
      </ScrollView>

      {keyboardHeight > 0 ? (
        <Pressable
          style={[styles.kbBar, { bottom: keyboardHeight }]}
          onPress={Keyboard.dismiss}
        >
          <Text style={styles.kbBarText}>Fechar teclado</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 24 },
  heading: {
    fontFamily: 'Fraunces_700Bold',
    fontSize: 32,
    color: colors.ink,
    marginBottom: 18,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 18,
    gap: 14,
  },
  cardGap: { marginTop: 18 },
  sectionSpacer: { height: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowText: { flex: 1, gap: 6 },
  hourRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  hourBtns: { flexDirection: 'row', gap: 8 },
  hourBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.bgSoft,
  },
  hourBtnOn: { backgroundColor: colors.accentSoft },
  hourBtnText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: colors.inkMuted,
  },
  hourBtnTextOn: { color: colors.accentDeep },
  linkInline: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: colors.accent,
    marginTop: 4,
  },
  label: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 16,
    color: colors.ink,
  },
  hint: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: colors.inkMuted,
    lineHeight: 19,
  },
  recommend: {
    backgroundColor: colors.accentSoft,
    borderRadius: 14,
    padding: 12,
    gap: 8,
  },
  recommendTitle: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: colors.accentDeep,
  },
  recommendBody: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: colors.accentDeep,
    lineHeight: 18,
  },
  guide: {
    backgroundColor: colors.bgSoft,
    borderRadius: 14,
    padding: 12,
    gap: 8,
  },
  guideTitle: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: colors.ink,
  },
  dismissGuide: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: colors.accent,
  },
  okHint: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: colors.success,
  },
  detect: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: colors.inkMuted,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontFamily: 'DMSans_400Regular',
    fontSize: 15,
    color: colors.ink,
    backgroundColor: colors.bg,
  },
  btn: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.45 },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingVertical: 14,
  },
  googleBtnText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 16,
    color: colors.ink,
  },
  pasteBox: {
    marginTop: 12,
    backgroundColor: colors.warnSoft,
    borderRadius: 14,
    padding: 12,
    gap: 10,
  },
  devToggle: {
    marginTop: 18,
    alignItems: 'center',
  },
  devToggleText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: colors.inkMuted,
    textDecorationLine: 'underline',
  },
  btnText: {
    fontFamily: 'DMSans_500Medium',
    color: '#fff',
    fontSize: 15,
  },
  uriBox: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: colors.ink,
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 10,
    overflow: 'hidden',
  },
  linkBtn: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  linkBtnText: {
    fontFamily: 'DMSans_500Medium',
    color: colors.accentDeep,
    fontSize: 14,
  },
  btnSecondary: {
    backgroundColor: colors.bgSoft,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnSecondaryText: {
    fontFamily: 'DMSans_500Medium',
    color: colors.ink,
    fontSize: 15,
  },
  footer: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: colors.inkMuted,
    textAlign: 'center',
    marginTop: 20,
  },
  kbBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: colors.bgSoft,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingVertical: 10,
    alignItems: 'center',
  },
  kbBarText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: colors.ink,
  },
});
