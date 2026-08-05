import Constants from 'expo-constants';

const SCOPES = [
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
];

export function isExpoGo(): boolean {
  return Constants.appOwnership === 'expo';
}

/**
 * Native Google Sign-In is unavailable in Expo Go (no custom native modules).
 */
export function canUseNativeGoogleSignIn(): boolean {
  if (isExpoGo()) return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@react-native-google-signin/google-signin');
    return true;
  } catch {
    return false;
  }
}

type NativeSignInSuccess = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  email?: string;
};

/**
 * Sign in with the native Google UI and obtain tokens for Calendar/Tasks APIs.
 * Prefers offline access (refresh_token via serverAuthCode); falls back to accessToken.
 */
export async function nativeGoogleSignIn(
  webClientId: string,
): Promise<NativeSignInSuccess | { error: string }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@react-native-google-signin/google-signin') as {
      GoogleSignin: {
        configure: (opts: Record<string, unknown>) => void;
        hasPlayServices: (opts?: {
          showPlayServicesUpdateDialog?: boolean;
        }) => Promise<boolean>;
        signIn: () => Promise<{
          type: string;
          data?: {
            serverAuthCode?: string | null;
            user?: { email?: string };
          };
        }>;
        addScopes: (opts: { scopes: string[] }) => Promise<unknown>;
        getTokens: () => Promise<{ accessToken: string; idToken?: string }>;
        signOut: () => Promise<null>;
      };
      isSuccessResponse: (r: { type: string }) => boolean;
      statusCodes: { SIGN_IN_CANCELLED: string; IN_PROGRESS: string };
      isErrorWithCode: (e: unknown) => e is { code: string; message?: string };
    };

    const { GoogleSignin, isSuccessResponse, statusCodes, isErrorWithCode } =
      mod;

    GoogleSignin.configure({
      webClientId,
      offlineAccess: true,
      forceCodeForRefreshToken: true,
      scopes: SCOPES,
    });

    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await GoogleSignin.signIn();

    if (!isSuccessResponse(response)) {
      return { error: 'Login Google cancelado.' };
    }

    // Ensure Calendar/Tasks scopes (Android sometimes signs in with profile only).
    try {
      if (typeof GoogleSignin.addScopes === 'function') {
        await GoogleSignin.addScopes({ scopes: SCOPES });
      }
    } catch {
      // User may deny extra scopes; API calls will surface a clear error.
    }

    const email = response.data?.user?.email;
    const serverAuthCode = response.data?.serverAuthCode ?? undefined;

    if (serverAuthCode) {
      const exchanged = await exchangeServerAuthCode(webClientId, serverAuthCode);
      if (!('error' in exchanged) && exchanged.accessToken) {
        return {
          accessToken: exchanged.accessToken,
          refreshToken: exchanged.refreshToken,
          expiresAt: exchanged.expiresAt,
          email: email ?? exchanged.email,
        };
      }
    }

    // Sem refresh_token o access token dura ~1h e força relogar.
    // Ainda assim salvamos o access atual; o app tenta silent refresh depois.
    const tokens = await GoogleSignin.getTokens();
    return {
      accessToken: tokens.accessToken,
      email,
    };
  } catch (e) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@react-native-google-signin/google-signin') as {
      statusCodes: { SIGN_IN_CANCELLED: string; IN_PROGRESS: string };
      isErrorWithCode: (err: unknown) => err is { code: string; message?: string };
    };
    if (mod.isErrorWithCode(e)) {
      if (e.code === mod.statusCodes.SIGN_IN_CANCELLED) {
        return { error: 'Login Google cancelado.' };
      }
      if (e.code === mod.statusCodes.IN_PROGRESS) {
        return { error: 'Login Google já em andamento.' };
      }
      // DEVELOPER_ERROR usually means missing Android OAuth client / wrong SHA-1
      if (
        e.message?.includes('DEVELOPER_ERROR') ||
        e.code === 'DEVELOPER_ERROR' ||
        e.message?.includes('10:')
      ) {
        return {
          error:
            'Google Sign-In nativo não está configurado (Client ID Android + SHA-1). Veja docs/NATIVE_BUILD.md.',
        };
      }
      return { error: e.message ?? `Erro Google Sign-In (${e.code})` };
    }
    return {
      error: e instanceof Error ? e.message : 'Falha no Google Sign-In nativo.',
    };
  }
}

export async function nativeGoogleSignOut(): Promise<void> {
  if (!canUseNativeGoogleSignIn()) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { GoogleSignin } = require('@react-native-google-signin/google-signin') as {
      GoogleSignin: { signOut: () => Promise<null> };
    };
    await GoogleSignin.signOut();
  } catch {
    // ignore
  }
}

/**
 * Tenta renovar o access token sem UI (conta já autorizada no aparelho).
 */
export async function nativeSilentRefreshAccessToken(
  webClientId: string,
): Promise<{ accessToken: string; expiresAt?: number } | null> {
  if (!canUseNativeGoogleSignIn()) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@react-native-google-signin/google-signin') as {
      GoogleSignin: {
        configure: (opts: Record<string, unknown>) => void;
        hasPreviousSignIn?: () => boolean;
        signInSilently: () => Promise<{ type: string }>;
        getTokens: () => Promise<{ accessToken: string }>;
        clearCachedAccessToken?: (token: string) => Promise<null>;
      };
      isSuccessResponse: (r: { type: string }) => boolean;
    };
    const { GoogleSignin, isSuccessResponse } = mod;
    GoogleSignin.configure({
      webClientId,
      offlineAccess: true,
      forceCodeForRefreshToken: true,
      scopes: SCOPES,
    });

    if (
      typeof GoogleSignin.hasPreviousSignIn === 'function' &&
      !GoogleSignin.hasPreviousSignIn()
    ) {
      return null;
    }

    const silent = await GoogleSignin.signInSilently();
    if (!isSuccessResponse(silent)) return null;

    let tokens = await GoogleSignin.getTokens();
    // Descarta cache velho e pede access token novo ao Google.
    if (
      tokens.accessToken &&
      typeof GoogleSignin.clearCachedAccessToken === 'function'
    ) {
      try {
        await GoogleSignin.clearCachedAccessToken(tokens.accessToken);
        tokens = await GoogleSignin.getTokens();
      } catch {
        // mantém o token obtido
      }
    }
    if (!tokens.accessToken) return null;
    return {
      accessToken: tokens.accessToken,
      expiresAt: Date.now() + 55 * 60 * 1000,
    };
  } catch {
    return null;
  }
}

async function exchangeServerAuthCode(
  webClientId: string,
  code: string,
): Promise<
  | {
      accessToken: string;
      refreshToken?: string;
      expiresAt?: number;
      email?: string;
    }
  | { error: string }
> {
  const body = new URLSearchParams({
    code,
    client_id: webClientId,
    grant_type: 'authorization_code',
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    return { error: `Troca do serverAuthCode falhou: ${err.slice(0, 160)}` };
  }

  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (!data.access_token) {
    return { error: 'Google não devolveu access_token no serverAuthCode.' };
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in
      ? Date.now() + data.expires_in * 1000
      : undefined,
  };
}

