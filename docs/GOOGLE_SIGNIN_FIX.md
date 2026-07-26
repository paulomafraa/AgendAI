# Corrigir Google Sign-In (APK atual)

O erro **“Google Sign-In nativo não está configurado”** resolve-se no Google Cloud.
**Não precisa gerar APK de novo** — só criar o Client Android com estes dados:

| Campo | Valor |
|--------|--------|
| Tipo | OAuth client ID → **Android** |
| Nome | AgendAI Android |
| Package name | `com.agendai.app` |
| SHA-1 | `85:B9:3D:60:A7:DF:92:B8:01:A1:06:07:C7:C1:12:78:59:95:BA:92` |

## Passos (2–5 min)

1. Abre: https://console.cloud.google.com/apis/credentials  
2. Seleciona o **mesmo projeto** do Client Web  
   (`605150411112-5lqd9scaj3ucthirb21cd3jovgvd8slh...`)
3. **+ Create credentials** → **OAuth client ID**
4. Application type: **Android**
5. Package name: `com.agendai.app`
6. SHA-1 certificate fingerprint: cola o SHA-1 da tabela
7. Create
8. Confirma que estas APIs estão ativas no projeto:
   - Google Calendar API
   - Google Tasks API
9. Em **OAuth consent screen** → Test users: o teu Gmail (se o app estiver em Testing)
10. Espera 1–2 minutos, abre o AgendAI no telemóvel e toca em **Continuar com o Google** de novo

## Nota

O Client **Android** não se cola no código. O Google valida `package` + `SHA-1` no telemóvel.
O Client **Web** (já no app) continua necessário para os tokens.
