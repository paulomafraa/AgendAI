import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as SecureStore from 'expo-secure-store';
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
    if (!raw) return null;
    return JSON.parse(raw) as GoogleTokens;
  } catch {
    return null;
  }
}

async function saveGoogleTokens(tokens: GoogleTokens | null): Promise<void> {
  if (!tokens) {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    return;
  }
  await SecureStore.setItemAsync(TOKEN_KEY, JSON.stringify(tokens));
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
        : undefined,
      email,
    };
    await saveGoogleTokens(tokens);

    return {
      ok: true,
      message: email
        ? `Conectado como ${email}. Novas tarefas/eventos vão para o Google.`
        : 'Google conectado. Novas tarefas/eventos serão sincronizados.',
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
        expiresAt: native.expiresAt,
        email: native.email,
      };
      if (!tokens.email) {
        tokens.email = await fetchEmail(tokens.accessToken);
      }
      await saveGoogleTokens(tokens);
      pendingGoogleAuth = null;
      return {
        ok: true,
        message: tokens.email
          ? `Conectado como ${tokens.email}. Novas tarefas/eventos vão para o Google.`
          : 'Google conectado. Novas tarefas/eventos serão sincronizados.',
      };
    }
    // DEVELOPER_ERROR / misconfig: fall through to browser OAuth (agendai://).
    // Cancelamento do utilizador não deve abrir o browser.
    const cancelled =
      native.error.includes('cancelado') || native.error.includes('em andamento');
    if (cancelled) {
      return { ok: false, message: native.error };
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

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: webClientId,
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
    }).toString(),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!data.access_token) return null;
  const next: GoogleTokens = {
    ...tokens,
    accessToken: data.access_token,
    expiresAt: data.expires_in
      ? Date.now() + data.expires_in * 1000
      : undefined,
  };
  await saveGoogleTokens(next);
  return next;
}

async function getValidAccessToken(): Promise<string | null> {
  let tokens = await loadGoogleTokens();
  if (!tokens?.accessToken) return null;

  const expired =
    !tokens.expiresAt || Date.now() > tokens.expiresAt - 60_000;

  if (!expired) return tokens.accessToken;

  // 1) Preferência: refresh_token OAuth (fica meses/anos até revogar)
  if (tokens.refreshToken) {
    const refreshed = await refreshAccessToken(tokens);
    if (refreshed?.accessToken) return refreshed.accessToken;
  }

  // 2) Fallback nativo: renova sem tela de login
  const webClientId = await resolveWebClientId();
  if (webClientId && canUseNativeGoogleSignIn()) {
    const silent = await nativeSilentRefreshAccessToken(webClientId);
    if (silent?.accessToken) {
      const next: GoogleTokens = {
        ...tokens,
        accessToken: silent.accessToken,
        expiresAt: silent.expiresAt,
      };
      await saveGoogleTokens(next);
      return next.accessToken;
    }
  }

  // Sem refresh possível: access antigo ainda pode falhar com 401
  return tokens.accessToken;
}

async function ensureTaskListId(accessToken: string): Promise<string> {
  const listRes = await fetch(
    'https://tasks.googleapis.com/tasks/v1/users/@me/lists',
    { headers: { Authorization: `Bearer ${accessToken}` } },
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

  const create = await fetch(
    'https://tasks.googleapis.com/tasks/v1/users/@me/lists',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
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
    const listId = await ensureTaskListId(accessToken);
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

    const res = await fetch(
      `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
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
    const accessToken = await getValidAccessToken();
    if (!accessToken) {
      return { ok: false, message: 'Google não conectado.' };
    }
    const listId = await ensureTaskListId(accessToken);
    const body: Record<string, unknown> = {
      status: task.done ? 'completed' : 'needsAction',
    };
    if (task.done) {
      body.completed = task.completedAt ?? new Date().toISOString();
    }
    const res = await fetch(
      `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${task.googleTaskId}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      return { ok: false, message: `Google Tasks PATCH HTTP ${res.status}` };
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
    const accessToken = await getValidAccessToken();
    if (!accessToken) {
      return { ok: false, message: 'Google não conectado.' };
    }
    const listId = await ensureTaskListId(accessToken);
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
    const res = await fetch(
      `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${task.googleTaskId}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
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
    const accessToken = await getValidAccessToken();
    if (!accessToken) {
      return { ok: false, message: 'Google não conectado.' };
    }
    const listId = await ensureTaskListId(accessToken);
    const url =
      `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks` +
      `?showCompleted=true&showHidden=true&maxResults=100`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
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

    if (
      todo.done === nextDone &&
      (todo.completedAt ?? '') === (nextCompletedAt ?? '') &&
      (todo.dueAt ?? '') === (nextDueAt ?? '')
    ) {
      return todo;
    }
    changed += 1;
    return {
      ...todo,
      done: nextDone,
      completedAt: nextCompletedAt,
      dueAt: nextDueAt,
    };
  });
  return { todos, changed };
}

export async function pushEventToGoogle(
  event: CalendarEventItem,
): Promise<GoogleSyncResult> {
  try {
    const accessToken = await getValidAccessToken();
    if (!accessToken) {
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

    const res = await fetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );
    if (res.status === 401) {
      const tokens = await loadGoogleTokens();
      if (tokens?.refreshToken) {
        const refreshed = await refreshAccessToken(tokens);
        if (refreshed?.accessToken) {
          const retry = await fetch(
            'https://www.googleapis.com/calendar/v3/calendars/primary/events',
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${refreshed.accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(body),
            },
          );
          if (!retry.ok) {
            const err = await retry.text();
            return {
              ok: false,
              message: formatGoogleHttpError(
                'Google Calendar',
                retry.status,
                err,
              ),
            };
          }
          const data = (await retry.json()) as { id?: string };
          return {
            ok: true,
            message: event.wantsReminder
              ? `Evento no Calendar com lembrete ${reminderMinutes} min antes.`
              : 'Evento enviado à Agenda Google.',
            remoteId: data.id,
          };
        }
      }
    }
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
    const accessToken = await getValidAccessToken();
    if (!accessToken) {
      return { ok: false, message: 'Google não conectado.' };
    }
    const listId = await ensureTaskListId(accessToken);
    const res = await fetch(
      `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${task.googleTaskId}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      },
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
    const accessToken = await getValidAccessToken();
    if (!accessToken) {
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
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${event.googleEventId}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
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
    const accessToken = await getValidAccessToken();
    if (!accessToken) {
      return { ok: false, message: 'Google não conectado.' };
    }
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${event.googleEventId}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      },
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

/**
 * Busca eventos na Agenda Google (14 dias atrás até 60 dias à frente).
 * Inclui eventos com horário e all-day.
 */
export async function fetchGoogleCalendarEvents(): Promise<
  | { ok: true; items: GoogleCalendarRemoteEvent[]; windowStartMs: number; windowEndMs: number }
  | { ok: false; message: string }
> {
  try {
    const accessToken = await getValidAccessToken();
    if (!accessToken) {
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
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
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
    if (
      ev.title === rem.title &&
      ev.startAt === rem.startAt &&
      ev.endAt === rem.endAt &&
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
      startAt: rem.startAt,
      endAt: rem.endAt,
      wantsReminder: rem.wantsReminder,
      reminderMinutes: rem.reminderMinutes ?? ev.reminderMinutes,
    });
  }

  const imports: CalendarEventItem[] = [];
  for (const rem of remote) {
    if (seen.has(rem.googleEventId)) continue;
    if (local.some((e) => e.googleEventId === rem.googleEventId)) continue;
    if (dismissed.has(rem.googleEventId)) continue;
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
    return `${service}: sessão Google expirou. Em Ajustes, Desconectar e Continuar com o Google de novo.`;
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
