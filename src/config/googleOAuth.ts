/**
 * Credenciais do APP (não do usuário final).
 * Quem publica o AgendAI preenche UMA vez. Usuários só tocam em
 * "Continuar com o Google" — nunca veem estes valores.
 *
 * Web Client ID: obrigatório (tokens / PKCE / offline access).
 * Android Client: criado no Google Cloud com package `com.agendai.app` + SHA-1;
 *   não precisa estar aqui — o Google valida no dispositivo.
 * iOS: depois — reversed client id no plugin (ver docs/NATIVE_BUILD.md).
 */
export const EMBEDDED_GOOGLE_WEB_CLIENT_ID =
  '605150411112-5lqd9scaj3ucthirb21cd3jovgvd8slh.apps.googleusercontent.com';

/** Opcional: reversed iOS client id, ex. com.googleusercontent.apps.XXXX */
export const EMBEDDED_GOOGLE_IOS_URL_SCHEME = '';
