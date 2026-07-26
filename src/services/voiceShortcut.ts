import * as QuickActions from 'expo-quick-actions';

export const VOICE_DEEP_LINK = 'agendai://voice';
export const VOICE_QUICK_ACTION_ID = 'voice';

/** Registra atalho de long-press no ícone (Android/iOS). Precisa de rebuild nativo. */
export async function registerVoiceQuickAction(): Promise<void> {
  try {
    if (!(await QuickActions.isSupported())) return;
    await QuickActions.setItems([
      {
        id: VOICE_QUICK_ACTION_ID,
        title: 'Voz',
        subtitle: 'Falar com o AgendAI',
        icon: 'symbol:mic',
        params: { href: VOICE_DEEP_LINK },
      },
    ]);
  } catch {
    // ignore (Expo Go / sem nativo)
  }
}

export function isVoiceQuickAction(
  action: QuickActions.Action | null | undefined,
): boolean {
  if (!action) return false;
  return action.id === VOICE_QUICK_ACTION_ID;
}

export function addVoiceQuickActionListener(
  onVoice: () => void,
): { remove: () => void } {
  try {
    if (isVoiceQuickAction(QuickActions.initial)) {
      // defer so navigation is ready
      setTimeout(onVoice, 400);
    }
    return QuickActions.addListener((action) => {
      if (isVoiceQuickAction(action)) onVoice();
    });
  } catch {
    return { remove: () => undefined };
  }
}
