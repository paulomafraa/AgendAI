import Constants from 'expo-constants';

/**
 * Speech is optional: Expo Go does not include ExpoSpeechRecognition.
 * Text input always works; voice needs a development build (`npx expo run:android`).
 */

export type SpeechResultEvent = {
  isFinal: boolean;
  results: Array<{ transcript?: string }>;
};

/** Espera ~3s de silêncio antes de considerar a fala terminada. */
export const SPEECH_END_SILENCE_MS = 1800;

type SpeechModule = {
  start: (options: {
    lang?: string;
    interimResults?: boolean;
    continuous?: boolean;
    volumeChangeEventOptions?: {
      enabled?: boolean;
      intervalMillis?: number;
    };
    androidIntentOptions?: {
      EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS?: number;
      EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS?: number;
      EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS?: number;
    };
  }) => void;
  stop: () => void;
  abort: () => void;
  requestPermissionsAsync: () => Promise<{ granted: boolean }>;
  addListener: (
    eventName: string,
    listener: (event: unknown) => void,
  ) => { remove: () => void };
};

let cached: SpeechModule | null | undefined;

function isExpoGo(): boolean {
  // Expo Go cannot load custom native modules like ExpoSpeechRecognition.
  return Constants.appOwnership === 'expo';
}

export function getSpeechModule(): SpeechModule | null {
  if (cached !== undefined) return cached;
  if (isExpoGo()) {
    cached = null;
    return cached;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-speech-recognition') as {
      ExpoSpeechRecognitionModule: SpeechModule;
    };
    cached = mod.ExpoSpeechRecognitionModule;
  } catch {
    cached = null;
  }
  return cached;
}

export function isSpeechAvailable(): boolean {
  return getSpeechModule() != null;
}
