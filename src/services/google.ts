import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { EMBEDDED_GOOGLE_WEB_CLIENT_ID } from '../config/googleOAuth';
import { toGoogleRecurrence, toDateOnlySaoPaulo, toGoogleTaskDue } from './ai/shared';
import {
  canUseNativeGoogleSignIn,
  isExpoGo,
  nativeGoogleSignIn,
  nativeGoogleSignOut,
  nativeSilentRefreshAccessToken,
} from './googleNative';
import type {
  CalendarEventItem,
  GoogleTokens,
  TodoItem,
} from '../types';

WebBrowser.maybeCompleteAuthSession();

const TOKEN_KEY = 'agendai_google_tokens';
/** Backup: SecureStore falha em alguns aparelhos e a sessão “some”. */
const TOKEN_BACKUP_KEY = '@agendai/google_tokens_backup';
const CLIENT_ID_OVERRIDE_KEY = 'agendai_google_web_client_id';
const TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email';

export type GoogleSyncResult = {
  ok: boolean;
  message: string;
  remoteId?: string;
};

/**
 * Priority: embedded (production) → optional on-device override (dev) → env/app.json
 */
async function resolveWebClientId(): Promise<string | undefined> {
  if (EMBEDDED_GOOGLE_WEB_CLIENT_ID.trim()) {
    return EMBEDDED_GOOGLE_WEB_CLIENT_ID.trim();
  }

  try {
    const override = await SecureStore.getItemAsync(CLIENT_ID_OVERRIDE_KEY);
    if (override?.trim()) return override.trim();
  } catch {
    // ignore
  }

  const extra =
    (
      Constants.expoConfig?.extra as
        | { googleOAuth?: { webClientId?: string } }
        | undefined
    )?.googleOAuth ?? {};

  return (
    extra.webClientId?.trim() ||
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim() ||
    undefined
  );
}

export async function isGoogleOAuthConfigured(): Promise<boolean> {
  return Boolean(await resolveWebClientId());
}

export function getGoogleRedirectUri(): string {
  // Expo Go: Google rejects custom schemes; localhost is the workable option
  // (often needs paste-URL fallback on Android).
  if (isExpoGo()) {
    return 'http://localhost/';
  }
  // Dev / production builds: custom scheme returns cleanly to the app.
  // Must also be listed in Google Cloud → Authorized redirect URIs.
  return AuthSession.makeRedirectUri({
    scheme: 'agendai',
    path: 'oauth',
  });
}

export async function saveGoogleClientIdOverride(
  clientId: string,
): Promise<void> {
  const trimmed = clientId.trim();
  if (trimmed) {
    await SecureStore.setItemAsync(CLIENT_ID_OVERRIDE_KEY, trimmed);
  } else {
    await SecureStore.deleteItemAsync(CLIENT_ID_OVERRIDE_KEY);
  }
}

export async function loadGoogleTokens(): Promise<GoogleTokens | null> {
  try {
    const raw = await SecureStore.getItemAsync(TOKEN_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as GoogleTokens;
      // Garante backup alinhado
      void AsyncStorage.setItem(TOKEN_BACKUP_KEY, raw);
      return parsed;
    }
  } catch {
    // tenta backup
  }
  try {
    const backup = await AsyncStorage.getItem(TOKEN_BACKUP_KEY);
    if (!backup) return null;
    const parsed = JSON.parse(backup) as GoogleTokens;
    // Restaura no SecureStore se possível
    try {
      await SecureStore.setItemAsync(TOKEN_KEY, backup);
    } catch {
      // ignore
    }
    return parsed;
  } catch {
    return null;
  }
}

async function saveGoogleTokens(tokens: GoogleTokens | null): Promise<void> {
  if (!tokens) {
    try {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
    } catch {
      // ignore
    }
    try {
      await AsyncStorage.removeItem(TOKEN_BACKUP_KEY);
    } catch {
      // ignore
    }
    return;
  }
  const raw = JSON.stringify(tokens);
  try {
    await SecureStore.setItemAsync(TOKEN_KEY, raw);
  } catch {
    // SecureStore pode falhar; backup ainda salva
  }
  try {
    await AsyncStorage.setItem(TOKEN_BACKUP_KEY, raw);
  } catch {
    // ignore
  }
}

/** Há refresh_token? Sem ele a sessão cai ~1h. */
export async function hasGoogleRefreshToken(): Promise<boolean> {
  const tokens = await loadGoogleTokens();
  return Boolean(tokens?.refreshToken);
}

async function fetchEmail(accessToken: string): Promise<string | undefined> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { email?: string };
    return data.email;
  } catch {
    return undefined;
  }
}

/**
 * Google OAuth via the system browser (Google blocks embedded WebViews).
 * On Expo Go, Chrome often fails to hand http://localhost back to the app —
 * in that case we ask the user to paste the URL from the address bar (it still
 * contains the authorization code).
 */
export type GoogleAuthPreparation = {
  authUrl: string;
  redirectUri: string;
  codeVerifier: string;
  webClientId: string;
};

export type GoogleConnectResult = GoogleSyncResult & {
  needsUrlPaste?: boolean;
};

const discovery = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
};

let pendingGoogleAuth: GoogleAuthPreparation | null = null;

export function hasPendingGoogleAuth(): boolean {
  return pendingGoogleAuth != null;
}

export async function prepareGoogleAuth(): Promise<
  GoogleAuthPreparation | { error: string }
> {
  const webClientId = await resolveWebClientId();
  if (!webClientId) {
    return {
      error:
        'Login Google ainda não está ativado neste build. Se você desenvolve o app, use Opções de desenvolvedor em Ajustes (só uma vez).',
    };
  }

  const redirectUri = getGoogleRedirectUri();
  const request = new AuthSession.AuthRequest({
    clientId: webClientId,
    redirectUri,
    scopes: [TASKS_SCOPE, CALENDAR_SCOPE, EMAIL_SCOPE, 'openid'],
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
    extraParams: {
      access_type: 'offline',
      prompt: 'consent',
    },
  });

  const authUrl = await request.makeAuthUrlAsync(discovery);
  if (!request.codeVerifier) {
    return { error: 'Falha ao preparar PKCE do login Google.' };
  }

  return {
    authUrl,
    redirectUri,
    codeVerifier: request.codeVerifier,
    webClientId,
  };
}

export async function finishGoogleAuth(params: {
  callbackUrl: string;
  codeVerifier: string;
  redirectUri: string;
  webClientId: string;
}): Promise<GoogleSyncResult> {
  try {
    let code = '';
    let oauthError = '';
    try {
      const url = new URL(params.callbackUrl);
      code = url.searchParams.get('code') ?? '';
      oauthError = url.searchParams.get('error') ?? '';
    } catch {
      const match = params.callbackUrl.match(/[?&]code=([^&]+)/);
      code = match?.[1] ? decodeURIComponent(match[1]) : '';
      const errMatch = params.callbackUrl.match(/[?&]error=([^&]+)/);
      oauthError = errMatch?.[1] ? decodeURIComponent(errMatch[1]) : '';
    }

    if (oauthError) {
      return {
        ok: false,
        message:
          oauthError === 'access_denied'
            ? 'Login Google cancelado ou conta sem permissão (adicione o e-mail em Usuários de teste).'
            : `Google retornou erro: ${oauthError}`,
      };
    }

    if (!code) {
      return {
        ok: false,
        message:
          'Não encontrei o código na URL. Copie a URL inteira da barra de endereço (deve ter “code=” no meio).',
      };
    }

    const tokenResult = await AuthSession.exchangeCodeAsync(
      {
        clientId: params.webClientId,
        code,
        redirectUri: params.redirectUri,
        extraParams: {
          code_verifier: params.codeVerifier,
        },
      },
      discovery,
    );

    const accessToken = tokenResult.accessToken;
    if (!accessToken) {
      return { ok: false, message: 'Google não devolveu access token.' };
    }

    const email = await fetchEmail(accessToken);
    const tokens: GoogleTokens = {
      accessToken,
      refreshToken: tokenResult.refreshToken,
      expiresAt: tokenResult.expiresIn
        ? Date.now() + tokenResult.expiresIn * 1000
        : Date.now() + 55 * 60 * 1000,
      email,
    };
    await saveGoogleTokens(tokens);

    const sessionHint = tokens.refreshToken
      ? ''
      : ' Se pedir login de novo em breve, conecte outra vez aceitando todas as permissões.';
    return {
      ok: true,
      message: email
        ? `Conectado como ${email}. Novas tarefas/eventos vão para o Google.${sessionHint}`
        : `Google conectado. Novas tarefas/eventos serão sincronizados.${sessionHint}`,
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Falha ao concluir login Google.',
    };
  }
}

export async function connectGoogleAccount(): Promise<GoogleConnectResult> {
  const webClientId = await resolveWebClientId();
  if (!webClientId) {
    return {
      ok: false,
      message:
        'Login Google ainda não está ativado neste build. Se você desenvolve o app, use Opções de desenvolvedor em Ajustes (só uma vez).',
    };
  }

  // Preferred path on development / production builds.
  if (canUseNativeGoogleSignIn()) {
    const native = await nativeGoogleSignIn(webClientId);
    if (!('error' in native)) {
      const tokens: GoogleTokens = {
        accessToken: native.accessToken,
        refreshToken: native.refreshToken,
        expiresAt: native.expiresAt ?? Date.now() + 55 * 60 * 1000,
        email: native.email,
      };
      if (!tokens.email) {
        tokens.email = await fetchEmail(tokens.accessToken);
      }
      await saveGoogleTokens(tokens);
      pendingGoogleAuth = null;

      // Com refresh_token a sessão dura meses. Sem ele, cai ~1h — pede consent offline.
      if (tokens.refreshToken) {
        return {
          ok: true,
          message: tokens.email
            ? `Conectado como ${tokens.email}. Sessão estável (renova sozinha).`
            : 'Google conectado. Sessão estável (renova sozinha).',
        };
      }
      // Continua no fluxo browser para obter refresh_token (prompt=consent).
    } else {
      const cancelled =
        native.error.includes('cancelado') ||
        native.error.includes('em andamento');
      if (cancelled) {
        return { ok: false, message: native.error };
      }
      // DEVELOPER_ERROR / misconfig: fall through to browser OAuth.
    }
  }

  // Browser + PKCE (Expo Go, or native fallback when Android OAuth client missing).
  const prepared = await prepareGoogleAuth();
  if ('error' in prepared) {
    return { ok: false, message: prepared.error };
  }

  pendingGoogleAuth = prepared;

  const browserResult = await WebBrowser.openAuthSessionAsync(
    prepared.authUrl,
    prepared.redirectUri,
  );

  if (
    browserResult.type === 'success' &&
    'url' in browserResult &&
    browserResult.url &&
    /[?&]code=/.test(browserResult.url)
  ) {
    const result = await finishGoogleAuth({
      callbackUrl: browserResult.url,
      codeVerifier: prepared.codeVerifier,
      redirectUri: prepared.redirectUri,
      webClientId: prepared.webClientId,
    });
    if (result.ok) pendingGoogleAuth = null;
    return result;
  }

  // Expo Go + Android often leaves the user on a dead localhost page.
  // On standalone builds, redirect is agendai://oauth and usually returns cleanly.
  const isStandalone = !isExpoGo();
  return {
    ok: false,
    needsUrlPaste: !isStandalone,
    message: isStandalone
      ? 'Login incompleto. Tenta de novo. Se persistir, cria o Client Android no Google Cloud (docs/GOOGLE_SIGNIN_FIX.md).'
      : 'O Google autenticou, mas o Expo Go não pega o retorno de localhost. Na página de erro, toque na barra de endereço, copie a URL inteira e cole no campo abaixo.',
  };
}

export async function completeGoogleAuthWithPastedUrl(
  pastedUrl: string,
): Promise<GoogleSyncResult> {
  if (!pendingGoogleAuth) {
    return {
      ok: false,
      message: 'Sessão expirada. Toque em Continuar com o Google de novo.',
    };
  }
  const result = await finishGoogleAuth({
    callbackUrl: pastedUrl.trim(),
    codeVerifier: pendingGoogleAuth.codeVerifier,
    redirectUri: pendingGoogleAuth.redirectUri,
    webClientId: pendingGoogleAuth.webClientId,
  });
  if (result.ok) pendingGoogleAuth = null;
  return result;
}

export async function disconnectGoogleAccount(): Promise<void> {
  await nativeGoogleSignOut();
  await saveGoogleTokens(null);
}

async function refreshAccessToken(
  tokens: GoogleTokens,
): Promise<GoogleTokens | null> {
  const webClientId = await resolveWebClientId();
  if (!tokens.refreshToken || !webClientId) return null;

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: webClientId,
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
      }).toString(),
    });
    if (!res.ok) {
      // invalid_grant = usuário revogou ou refresh morto — não apaga aqui
      return null;
    }
    const data = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
      refresh_token?: string;
    };
    if (!data.access_token) return null;
    const next: GoogleTokens = {
      ...tokens,
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? tokens.refreshToken,
      expiresAt: data.expires_in
        ? Date.now() + data.expires_in * 1000
        : Date.now() + 55 * 60 * 1000,
    };
    await saveGoogleTokens(next);
    return next;
  } catch {
    return null;
  }
}

/** Uma renovação por vez (várias APIs chamam ao mesmo tempo). */
let refreshInFlight: Promise<GoogleTokens | null> | null = null;

async function forceRefreshTokens(
  tokens: GoogleTokens,
): Promise<GoogleTokens | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      // Sempre tenta silent nativo também (mesmo com refresh), se refresh falhar.
      if (tokens.refreshToken) {
        const refreshed = await refreshAccessToken(tokens);
        if (refreshed?.accessToken) return refreshed;
      }

      const webClientId = await resolveWebClientId();
      if (webClientId && canUseNativeGoogleSignIn()) {
        const silent = await nativeSilentRefreshAccessToken(webClientId);
        if (silent?.accessToken) {
          const next: GoogleTokens = {
            ...tokens,
            accessToken: silent.accessToken,
            expiresAt:
              silent.expiresAt ?? Date.now() + 55 * 60 * 1000,
          };
          await saveGoogleTokens(next);
          return next;
        }
      }
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function getValidAccessToken(): Promise<string | null> {
  let tokens = await loadGoogleTokens();
  if (!tokens?.accessToken) return null;

  const now = Date.now();
  const expired =
    tokens.expiresAt != null && now > tokens.expiresAt - 60_000;

  // Sem expiresAt: tenta renovar em background, mas não invalida o access atual.
  if (!tokens.expiresAt) {
    void forceRefreshTokens(tokens);
    return tokens.accessToken;
  }

  if (!expired) return tokens.accessToken;

  const refreshed = await forceRefreshTokens(tokens);
  if (refreshed?.accessToken) return refreshed.accessToken;

  // Refresh falhou: ainda usa o access se não estiver morto há muito tempo
  // (evita “desconectar” o usuário por falha de rede momentânea).
  if (now < tokens.expiresAt + 6 * 60 * 60 * 1000) {
    return tokens.accessToken;
  }
  return null;
}

/**
 * Renova o access token proativamente (abertura do app / sync diária).
 * Retorna true se há tokens salvos (não marca desconectado por falha transitória).
 */
export async function ensureGoogleSessionFresh(): Promise<boolean> {
  const tokens = await loadGoogleTokens();
  if (!tokens?.accessToken) return false;
  await forceRefreshTokens(tokens);
  const again = await loadGoogleTokens();
  return Boolean(again?.accessToken);
}

/**
 * fetch com Authorization e 1 retry automático após renovar o token.
 */
async function googleAuthorizedFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return new Response(
      JSON.stringify({
        error: {
          message: 'Google não conectado.',
          status: 'UNAUTHENTICATED',
        },
      }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const withAuth = (token: string): RequestInit => ({
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${token}`,
    },
  });

  let res = await fetch(url, withAuth(accessToken));
  if (res.status !== 401) return res;

  const tokens = await loadGoogleTokens();
  if (!tokens) return res;
  const refreshed = await forceRefreshTokens(tokens);
  if (!refreshed?.accessToken) return res;
  return fetch(url, withAuth(refreshed.accessToken));
}

async function ensureTaskListId(): Promise<string> {
  const listRes = await googleAuthorizedFetch(
    'https://tasks.googleapis.com/tasks/v1/users/@me/lists',
  );
  if (!listRes.ok) {
    const err = await listRes.text();
    throw new Error(
      formatGoogleHttpError('Google Tasks', listRes.status, err),
    );
  }
  const data = (await listRes.json()) as {
    items?: Array<{ id?: string; title?: string }>;
  };
  const preferred =
    data.items?.find((l) => l.title === 'AgendAI') ?? data.items?.[0];
  if (preferred?.id) return preferred.id;

  const create = await googleAuthorizedFetch(
    'https://tasks.googleapis.com/tasks/v1/users/@me/lists',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: 'AgendAI' }),
    },
  );
  if (!create.ok) {
    const err = await create.text();
    throw new Error(
      formatGoogleHttpError('Google Tasks', create.status, err),
    );
  }
  const created = (await create.json()) as { id?: string };
  if (!created.id) throw new Error('Lista de tarefas sem id.');
  return created.id;
}

export async function pushTaskToGoogle(
  task: TodoItem,
): Promise<GoogleSyncResult> {
  try {
    const accessToken = await getValidAccessToken();
    if (!accessToken) {
      return {
        ok: false,
        message: 'Google não conectado. A tarefa ficou só no aparelho.',
      };
    }
    const listId = await ensureTaskListId();
    const notes = [task.category ? `Categoria: ${task.category}` : '', task.notes ?? '']
      .filter(Boolean)
      .join('\n');

    const body: Record<string, unknown> = {
      title: task.title,
      notes: notes || undefined,
      status: task.done ? 'completed' : 'needsAction',
    };
    if (task.dueAt) {
      body.due = toGoogleTaskDue(task.dueAt);
    }

    const res = await googleAuthorizedFetch(
      `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      const err = await res.text();
      return {
        ok: false,
        message: formatGoogleHttpError('Google Tasks', res.status, err),
      };
    }
    const data = (await res.json()) as { id?: string };
    return {
      ok: true,
      message: 'Tarefa enviada ao Google Tasks.',
      remoteId: data.id,
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Falha no Google Tasks.',
    };
  }
}

export async function completeTaskOnGoogle(
  task: TodoItem,
): Promise<GoogleSyncResult> {
  if (!task.googleTaskId) {
    return { ok: false, message: 'Tarefa sem id remoto no Google.' };
  }
  try {
    if (!(await getValidAccessToken())) {
      return { ok: false, message: 'Google não conectado.' };
    }
    const listId = await ensureTaskListId();
    const body: Record<string, unknown> = {
      status: task.done ? 'completed' : 'needsAction',
    };
    if (task.done) {
      body.completed = task.completedAt ?? new Date().toISOString();
    }
    const res = await googleAuthorizedFetch(
      `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${task.googleTaskId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      const err = await res.text();
      return {
        ok: false,
        message: formatGoogleHttpError('Google Tasks', res.status, err),
      };
    }
    return { ok: true, message: 'Status atualizado no Google Tasks.' };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Falha ao atualizar Tasks.',
    };
  }
}

export async function updateTaskOnGoogle(
  task: TodoItem,
): Promise<GoogleSyncResult> {
  if (!task.googleTaskId) {
    return { ok: false, message: 'Tarefa sem id remoto no Google.' };
  }
  try {
    if (!(await getValidAccessToken())) {
      return { ok: false, message: 'Google não conectado.' };
    }
    const listId = await ensureTaskListId();
    const notes = [task.category ? `Categoria: ${task.category}` : '', task.notes ?? '']
      .filter(Boolean)
      .join('\n');
    const body: Record<string, unknown> = {
      title: task.title,
      notes: notes || undefined,
      status: task.done ? 'completed' : 'needsAction',
    };
    if (task.dueAt) {
      body.due = toGoogleTaskDue(task.dueAt);
    } else {
      body.due = null;
    }
    const res = await googleAuthorizedFetch(
      `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${task.googleTaskId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      const err = await res.text();
      return {
        ok: false,
        message: formatGoogleHttpError('Google Tasks', res.status, err),
      };
    }
    return { ok: true, message: 'Tarefa atualizada no Google Tasks.' };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Falha ao atualizar Tasks.',
    };
  }
}

export type GoogleTaskRemoteStatus = {
  googleTaskId: string;
  done: boolean;
  completedAt?: string;
  title?: string;
  dueAt?: string;
};

/**
 * Lê o status das tarefas na lista Google e devolve o mapa por googleTaskId.
 * Assim o app reflete conclusões feitas no app Google Tasks.
 */
export async function fetchGoogleTaskStatuses(): Promise<
  | { ok: true; items: GoogleTaskRemoteStatus[] }
  | { ok: false; message: string }
> {
  try {
    if (!(await getValidAccessToken())) {
      return { ok: false, message: 'Google não conectado.' };
    }
    const listId = await ensureTaskListId();
    const url =
      `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks` +
      `?showCompleted=true&showHidden=true&maxResults=100`;
    const res = await googleAuthorizedFetch(url);
    if (!res.ok) {
      const err = await res.text();
      return {
        ok: false,
        message: formatGoogleHttpError('Google Tasks', res.status, err),
      };
    }
    const data = (await res.json()) as {
      items?: Array<{
        id?: string;
        title?: string;
        status?: string;
        completed?: string;
        due?: string;
      }>;
    };
    const items: GoogleTaskRemoteStatus[] = (data.items ?? [])
      .filter((t) => t.id)
      .map((t) => ({
        googleTaskId: t.id as string,
        done: t.status === 'completed',
        completedAt: t.completed,
        title: t.title,
        dueAt: t.due,
      }));
    return { ok: true, items };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Falha ao ler Google Tasks.',
    };
  }
}

/**
 * Aplica status remoto nas tarefas locais que têm googleTaskId.
 */
export function mergeGoogleTaskStatuses(
  localTodos: TodoItem[],
  remote: GoogleTaskRemoteStatus[],
): { todos: TodoItem[]; changed: number } {
  const byId = new Map(remote.map((r) => [r.googleTaskId, r]));
  let changed = 0;
  const todos = localTodos.map((todo) => {
    if (!todo.googleTaskId) return todo;
    const remoteItem = byId.get(todo.googleTaskId);
    if (!remoteItem) return todo;

    const nextDone = remoteItem.done;
    const nextCompletedAt = nextDone
      ? remoteItem.completedAt ?? todo.completedAt ?? new Date().toISOString()
      : undefined;
    const nextDueAt = remoteItem.dueAt ?? undefined;

    // Não reabre tarefa concluída no app só porque o Google ainda não refletiu
    // (ex.: PATCH falhou ou sync chegou antes da conclusão remota).
    const effectiveDone = todo.done && !nextDone ? true : nextDone;
    const effectiveCompletedAt = effectiveDone
      ? nextDone
        ? nextCompletedAt
        : todo.completedAt ?? new Date().toISOString()
      : undefined;

    if (
      todo.done === effectiveDone &&
      (todo.completedAt ?? '') === (effectiveCompletedAt ?? '') &&
      (todo.dueAt ?? '') === (nextDueAt ?? '')
    ) {
      return todo;
    }
    changed += 1;
    return {
      ...todo,
      done: effectiveDone,
      completedAt: effectiveCompletedAt,
      dueAt: nextDueAt,
    };
  });
  return { todos, changed };
}

export async function pushEventToGoogle(
  event: CalendarEventItem,
): Promise<GoogleSyncResult> {
  try {
    if (!(await getValidAccessToken())) {
      return {
        ok: false,
        message: 'Google não conectado. O evento ficou só no aparelho.',
      };
    }

    const description = [
      event.category ? `Categoria: ${event.category}` : '',
      event.broadcastStartAt
        ? `Transmissão / pré: ${new Date(event.broadcastStartAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`
        : '',
      event.notes ?? '',
      'Criado pelo AgendAI',
    ]
      .filter(Boolean)
      .join('\n');

    const timeZone = 'America/Sao_Paulo';
    const reminderMinutes =
      event.reminderMinutes && event.reminderMinutes > 0
        ? event.reminderMinutes
        : 30;

    const body: Record<string, unknown> = {
      summary: event.title,
      description,
    };
    if (event.location?.trim()) {
      body.location = event.location.trim();
    }
    if (event.allDay) {
      const startDate = toDateOnlySaoPaulo(event.startAt);
      const endDate = toDateOnlySaoPaulo(
        event.endAt && event.endAt !== event.startAt
          ? event.endAt
          : new Date(
              new Date(event.startAt).getTime() + 24 * 60 * 60 * 1000,
            ).toISOString(),
      );
      // Google all-day end is exclusive; bump +1 day if same day
      let exclusiveEnd = endDate;
      if (exclusiveEnd <= startDate) {
        const d = new Date(`${startDate}T12:00:00`);
        d.setDate(d.getDate() + 1);
        exclusiveEnd = d.toISOString().slice(0, 10);
      }
      body.start = { date: startDate };
      body.end = { date: exclusiveEnd };
    } else {
      body.start = { dateTime: event.startAt, timeZone };
      body.end = { dateTime: event.endAt, timeZone };
    }
    const recurrence = toGoogleRecurrence(event.recurrence);
    if (recurrence) body.recurrence = recurrence;
    if (event.wantsReminder) {
      body.reminders = {
        useDefault: false,
        overrides: [{ method: 'popup', minutes: reminderMinutes }],
      };
    }

    const res = await googleAuthorizedFetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      const err = await res.text();
      return {
        ok: false,
        message: formatGoogleHttpError('Google Calendar', res.status, err),
      };
    }
    const data = (await res.json()) as { id?: string };
    return {
      ok: true,
      message: event.wantsReminder
        ? `Evento no Calendar com lembrete ${reminderMinutes} min antes.`
        : 'Evento enviado à Agenda Google.',
      remoteId: data.id,
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Falha no Google Calendar.',
    };
  }
}

export async function deleteTaskOnGoogle(
  task: TodoItem,
): Promise<GoogleSyncResult> {
  if (!task.googleTaskId) {
    return { ok: true, message: 'Tarefa só local.' };
  }
  try {
    if (!(await getValidAccessToken())) {
      return { ok: false, message: 'Google não conectado.' };
    }
    const listId = await ensureTaskListId();
    const res = await googleAuthorizedFetch(
      `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${task.googleTaskId}`,
      { method: 'DELETE' },
    );
    if (!res.ok && res.status !== 204) {
      const err = await res.text();
      return {
        ok: false,
        message: formatGoogleHttpError('Google Tasks', res.status, err),
      };
    }
    return { ok: true, message: 'Tarefa removida no Google Tasks.' };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Falha ao apagar no Google.',
    };
  }
}

export async function updateEventOnGoogle(
  event: CalendarEventItem,
): Promise<GoogleSyncResult> {
  if (!event.googleEventId) {
    return { ok: false, message: 'Evento sem id no Google.' };
  }
  try {
    if (!(await getValidAccessToken())) {
      return { ok: false, message: 'Google não conectado.' };
    }
    const timeZone = 'America/Sao_Paulo';
    const reminderMinutes = event.reminderMinutes ?? 30;
    const body: Record<string, unknown> = {
      summary: event.title,
      description: event.notes,
    };
    if (event.location?.trim()) {
      body.location = event.location.trim();
    }
    if (event.allDay) {
      const startDate = toDateOnlySaoPaulo(event.startAt);
      let exclusiveEnd = toDateOnlySaoPaulo(event.endAt);
      if (exclusiveEnd <= startDate) {
        const d = new Date(`${startDate}T12:00:00`);
        d.setDate(d.getDate() + 1);
        exclusiveEnd = d.toISOString().slice(0, 10);
      }
      body.start = { date: startDate };
      body.end = { date: exclusiveEnd };
    } else {
      body.start = { dateTime: event.startAt, timeZone };
      body.end = { dateTime: event.endAt, timeZone };
    }
    if (event.wantsReminder) {
      body.reminders = {
        useDefault: false,
        overrides: [{ method: 'popup', minutes: reminderMinutes }],
      };
    }
    const res = await googleAuthorizedFetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${event.googleEventId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      const err = await res.text();
      return {
        ok: false,
        message: formatGoogleHttpError('Google Calendar', res.status, err),
      };
    }
    return { ok: true, message: 'Evento atualizado no Calendar.' };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Falha ao atualizar evento.',
    };
  }
}

export async function deleteEventOnGoogle(
  event: CalendarEventItem,
): Promise<GoogleSyncResult> {
  if (!event.googleEventId) {
    return { ok: true, message: 'Evento só local.' };
  }
  try {
    if (!(await getValidAccessToken())) {
      return { ok: false, message: 'Google não conectado.' };
    }
    const res = await googleAuthorizedFetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${event.googleEventId}`,
      { method: 'DELETE' },
    );
    if (!res.ok && res.status !== 204) {
      const err = await res.text();
      return {
        ok: false,
        message: formatGoogleHttpError('Google Calendar', res.status, err),
      };
    }
    return { ok: true, message: 'Evento removido no Calendar.' };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Falha ao apagar evento.',
    };
  }
}

export type GoogleCalendarRemoteEvent = {
  googleEventId: string;
  title: string;
  notes?: string;
  location?: string;
  allDay?: boolean;
  startAt: string;
  endAt: string;
  wantsReminder: boolean;
  reminderMinutes?: number;
};

function normalizeEventTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Considera o mesmo compromisso se título igual e início perto (±3 min) ou ambos all-day no mesmo dia. */
export function eventsLookSame(
  a: { title: string; startAt: string; allDay?: boolean },
  b: { title: string; startAt: string; allDay?: boolean },
): boolean {
  if (normalizeEventTitle(a.title) !== normalizeEventTitle(b.title)) return false;
  if (Boolean(a.allDay) !== Boolean(b.allDay)) return false;
  if (a.allDay || b.allDay) {
    return a.startAt.slice(0, 10) === b.startAt.slice(0, 10);
  }
  return Math.abs(new Date(a.startAt).getTime() - new Date(b.startAt).getTime()) <= 3 * 60_000;
}

export function findMatchingRemoteEvent(
  local: CalendarEventItem,
  remote: GoogleCalendarRemoteEvent[],
  usedRemoteIds?: Set<string>,
): GoogleCalendarRemoteEvent | undefined {
  return remote.find((r) => {
    if (usedRemoteIds?.has(r.googleEventId)) return false;
    return eventsLookSame(local, r);
  });
}

/**
 * Remove cópias locais do mesmo compromisso (mesmo googleEventId ou título+hora).
 * Prefere o que já tem googleEventId.
 */
export function dedupeLocalEvents(events: CalendarEventItem[]): {
  events: CalendarEventItem[];
  removed: CalendarEventItem[];
} {
  const kept: CalendarEventItem[] = [];
  const removed: CalendarEventItem[] = [];
  const seenRemote = new Set<string>();

  const ranked = [...events].sort((a, b) => {
    const ag = a.googleEventId ? 1 : 0;
    const bg = b.googleEventId ? 1 : 0;
    if (ag !== bg) return bg - ag;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  for (const ev of ranked) {
    if (ev.googleEventId && seenRemote.has(ev.googleEventId)) {
      removed.push(ev);
      continue;
    }
    const twin = kept.find((k) => eventsLookSame(k, ev));
    if (twin) {
      removed.push(ev);
      continue;
    }
    if (ev.googleEventId) seenRemote.add(ev.googleEventId);
    kept.push(ev);
  }

  return { events: kept, removed };
}

/**
 * Busca eventos na Agenda Google (14 dias atrás até 60 dias à frente).
 * Inclui eventos com horário e all-day.
 */
export async function fetchGoogleCalendarEvents(): Promise<
  | { ok: true; items: GoogleCalendarRemoteEvent[]; windowStartMs: number; windowEndMs: number }
  | { ok: false; message: string }
> {
  try {
    if (!(await getValidAccessToken())) {
      return { ok: false, message: 'Google não conectado.' };
    }
    const windowStartMs = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const windowEndMs = Date.now() + 60 * 24 * 60 * 60 * 1000;
    const timeMin = new Date(windowStartMs).toISOString();
    const timeMax = new Date(windowEndMs).toISOString();
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '100',
    });
    const res = await googleAuthorizedFetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    );
    if (!res.ok) {
      const err = await res.text();
      return {
        ok: false,
        message: formatGoogleHttpError('Google Calendar', res.status, err),
      };
    }
    const data = (await res.json()) as {
      items?: Array<{
        id?: string;
        summary?: string;
        description?: string;
        location?: string;
        start?: { dateTime?: string; date?: string };
        end?: { dateTime?: string; date?: string };
        reminders?: {
          useDefault?: boolean;
          overrides?: Array<{ method?: string; minutes?: number }>;
        };
      }>;
    };
    const items: GoogleCalendarRemoteEvent[] = [];
    for (const ev of data.items ?? []) {
      if (!ev.id || (!ev.start?.dateTime && !ev.start?.date)) continue;
      const allDay = Boolean(ev.start?.date && !ev.start?.dateTime);
      let startAt: string;
      let endAt: string;
      if (allDay && ev.start?.date) {
        startAt = `${ev.start.date}T12:00:00.000-03:00`;
        const endDate = ev.end?.date ?? ev.start.date;
        endAt = `${endDate}T12:00:00.000-03:00`;
      } else {
        startAt = ev.start!.dateTime as string;
        endAt =
          ev.end?.dateTime ??
          new Date(new Date(startAt).getTime() + 60 * 60 * 1000).toISOString();
      }
      const popup = ev.reminders?.overrides?.find((o) => o.method === 'popup');
      const reminderMinutes = popup?.minutes;
      items.push({
        googleEventId: ev.id,
        title: (ev.summary ?? 'Sem título').trim() || 'Sem título',
        notes: ev.description?.trim() || undefined,
        location: ev.location?.trim() || undefined,
        allDay: allDay || undefined,
        startAt,
        endAt,
        wantsReminder:
          Boolean(reminderMinutes) || Boolean(ev.reminders?.useDefault),
        reminderMinutes: reminderMinutes ?? 30,
      });
    }
    return { ok: true, items, windowStartMs, windowEndMs };
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error ? e.message : 'Falha ao ler Google Calendar.',
    };
  }
}

/**
 * Merge Agenda Google → app.
 * - Agenda é fonte da verdade para eventos já ligados (googleEventId).
 * - Se sumiu no Calendar, remove do app.
 * - Importa eventos novos do Calendar.
 * - Mantém eventos só locais (sem googleEventId) — nunca apaga nada no Google.
 * - Nunca sobrescreve o Calendar a partir do app.
 */
export function mergeGoogleCalendarEvents(
  local: CalendarEventItem[],
  remote: GoogleCalendarRemoteEvent[],
  opts?: {
    windowStartMs?: number;
    windowEndMs?: number;
    /** Eventos que o usuário apagou só no app — não reimportar do Calendar. */
    dismissedGoogleEventIds?: string[];
  },
): {
  events: CalendarEventItem[];
  changed: number;
  removed: CalendarEventItem[];
  /** IDs que sumiram do Calendar e podem sair da lista de dispensados. */
  clearedDismissedIds: string[];
} {
  const byRemoteId = new Map(remote.map((r) => [r.googleEventId, r]));
  const dismissed = new Set(opts?.dismissedGoogleEventIds ?? []);
  let changed = 0;
  const seen = new Set<string>();
  const removed: CalendarEventItem[] = [];
  const kept: CalendarEventItem[] = [];
  const clearedDismissedIds: string[] = [];
  const windowStartMs =
    opts?.windowStartMs ?? Date.now() - 14 * 24 * 60 * 60 * 1000;
  const windowEndMs =
    opts?.windowEndMs ?? Date.now() + 60 * 24 * 60 * 60 * 1000;

  for (const ev of local) {
    if (!ev.googleEventId) {
      kept.push(ev);
      continue;
    }
    const rem = byRemoteId.get(ev.googleEventId);
    if (!rem) {
      const startMs = new Date(ev.startAt).getTime();
      // Só remove se estiver na janela buscada — fora dela a ausência não prova exclusão.
      const inWindow = startMs >= windowStartMs && startMs <= windowEndMs;
      if (inWindow) {
        changed += 1;
        removed.push(ev);
        if (dismissed.has(ev.googleEventId)) {
          clearedDismissedIds.push(ev.googleEventId);
        }
      } else {
        kept.push(ev);
      }
      continue;
    }
    seen.add(ev.googleEventId);
    // Horário sugerido (soft) ainda não confirmado: não deixa o Calendar
    // sobrescrever o horário local até o usuário resolver o prompt.
    const protectSoft =
      Boolean(ev.softTime) && !ev.softResolved && !ev.allDay;
    if (
      ev.title === rem.title &&
      (protectSoft || ev.startAt === rem.startAt) &&
      (protectSoft || ev.endAt === rem.endAt) &&
      (ev.notes ?? '') === (rem.notes ?? '') &&
      (ev.location ?? '') === (rem.location ?? '') &&
      Boolean(ev.allDay) === Boolean(rem.allDay)
    ) {
      kept.push(ev);
      continue;
    }
    changed += 1;
    kept.push({
      ...ev,
      title: rem.title,
      notes: rem.notes,
      location: rem.location,
      allDay: rem.allDay,
      startAt: protectSoft ? ev.startAt : rem.startAt,
      endAt: protectSoft ? ev.endAt : rem.endAt,
      wantsReminder: rem.wantsReminder,
      reminderMinutes: rem.reminderMinutes ?? ev.reminderMinutes,
    });
  }

  const imports: CalendarEventItem[] = [];
  for (const rem of remote) {
    if (seen.has(rem.googleEventId)) continue;
    if (local.some((e) => e.googleEventId === rem.googleEventId)) continue;
    if (dismissed.has(rem.googleEventId)) continue;
    // Já temos o mesmo compromisso local (ainda sem id ou com outro id) → não duplica
    if (kept.some((e) => eventsLookSame(e, rem))) continue;
    if (
      local.some(
        (e) => !e.googleEventId && eventsLookSame(e, rem),
      )
    ) {
      continue;
    }
    changed += 1;
    imports.push({
      id: `gcal-${rem.googleEventId}`,
      title: rem.title,
      notes: rem.notes,
      location: rem.location,
      allDay: rem.allDay,
      startAt: rem.startAt,
      endAt: rem.endAt,
      wantsReminder: rem.wantsReminder,
      reminderMinutes: rem.reminderMinutes,
      createdAt: new Date().toISOString(),
      source: 'text',
      googleEventId: rem.googleEventId,
      category: 'agenda',
    });
  }

  return { events: [...imports, ...kept], changed, removed, clearedDismissedIds };
}

function formatGoogleHttpError(
  service: string,
  status: number,
  body: string,
): string {
  let reason = '';
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string; status?: string; errors?: Array<{ reason?: string }> };
    };
    reason =
      parsed.error?.message ??
      parsed.error?.errors?.[0]?.reason ??
      parsed.error?.status ??
      '';
  } catch {
    reason = body.slice(0, 160);
  }

  if (status === 401) {
    return `${service}: não foi possível renovar a sessão Google. Em Ajustes, Desconectar e Continuar com o Google de novo.`;
  }

  if (status === 403) {
    const lower = reason.toLowerCase();
    if (
      lower.includes('access_not_configured') ||
      lower.includes('has not been used') ||
      lower.includes('disabled') ||
      lower.includes('not been enabled')
    ) {
      return `${service}: API desligada no Google Cloud. Ative Google Calendar API (e Tasks) no mesmo projeto do OAuth, espere 1 min e tente de novo.`;
    }
    if (
      lower.includes('insufficient') ||
      lower.includes('access_token_scope') ||
      lower.includes('PERMISSION_DENIED'.toLowerCase())
    ) {
      return `${service}: falta permissão. Em Ajustes, Desconectar Google e conectar de novo (aceite Agenda e Tasks).`;
    }
    return `${service}: acesso negado (403). ${reason || 'Ative a API no Cloud Console ou reconecte o Google.'}`;
  }

  return `${service} (${status}): ${reason || body.slice(0, 120)}`;
}
