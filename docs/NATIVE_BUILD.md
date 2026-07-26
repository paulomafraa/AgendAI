# Build nativo AgendAI (Android)

O Expo Go continua útil para testar IA + sync (com colar URL).  
O build estável traz **Google Sign-In nativo**, **voz** e redirect `agendai://` sem colar URL.

## Plano (o que já está no código)

1. `expo-dev-client` + `eas.json` (profiles `development` / `preview` / `production`)
2. `@react-native-google-signin/google-signin` — usado automaticamente fora do Expo Go
3. Fallback Expo Go: browser + colar `http://localhost/?code=…`
4. No build nativo (se Sign-In falhar no futuro): browser com `agendai://oauth`

## SHA-1 deste APK de produção (EAS)

```
85:B9:3D:60:A7:DF:92:B8:01:A1:06:07:C7:C1:12:78:59:95:BA:92
```

Package: `com.agendai.app`

Passo a passo curto: [GOOGLE_SIGNIN_FIX.md](./GOOGLE_SIGNIN_FIX.md)

## 1. Google Cloud — Client Android (obrigatório para Sign-In nativo)

No mesmo projeto OAuth do Web Client já embutido:

1. APIs & Services → Credentials → **Create credentials** → OAuth client ID  
2. Application type: **Android**  
3. Package name: `com.agendai.app`  
4. SHA-1: use o do keystore de debug **ou** o do EAS (abaixo)

### SHA-1 debug (build local `expo run:android`)

```bash
# Windows (keystore debug padrão)
keytool -list -v -alias androiddebugkey -keystore %USERPROFILE%\.android\debug.keystore -storepass android -keypass android
```

Copie o **SHA1** e cole no Client Android.

### SHA-1 via EAS

Depois do primeiro `eas build` / `eas credentials`:

```bash
npx eas credentials -p android
```

Use o SHA-1 da keystore do profile `development` (e o de `production` quando for publicar).

## 2. Redirect URIs (Web Client — só se usar fallback browser)

No **OAuth Client tipo Web** (já usado), em Authorized redirect URIs:

- `http://localhost/` ← Expo Go (já deve estar)
- `agendai://oauth` ← build nativo / browser fallback

## 3. Consent screen

Em Testing: adicione o Gmail de teste em **Test users**.  
Scopes já pedidos pelo app: Tasks, Calendar events, email.

## 4. Gerar o APK de desenvolvimento

### Opção A — EAS (recomendado se não tiver Android Studio/SDK)

```bash
npm i -g eas-cli
npx eas login
npx eas init          # grava projectId em app.json → extra.eas.projectId
npm run eas:dev       # APK development client
```

Instale o APK no telemóvel, depois no PC:

```bash
npm run start:dev
```

Escaneie o QR com o **AgendAI** (não o Expo Go).

### Opção B — Local (precisa Android SDK + USB/emulador)

```bash
npm run run:android
```

## 5. O que validar no build nativo

- [ ] Continuar com o Google → UI nativa, **sem** localhost / colar URL  
- [ ] Criar tarefa/evento → aparece no Google  
- [ ] Microfone / voz no Início  
- [ ] Desconectar Google e reconectar  

## 6. iOS (depois)

1. Criar OAuth Client **iOS** (`com.agendai.app`)  
2. No plugin do Google Sign-In, passar `iosUrlScheme` = reversed client id  
   (`com.googleusercontent.apps.XXXX`)  
3. Rebuild

## Notas

- `src/config/googleOAuth.ts` continua com o **Web** Client ID (necessário para tokens / offline).  
- O Client **Android** não vai no código — o Google valida package + SHA-1 no dispositivo.  
- Enquanto testas no Expo Go, o fluxo de colar URL mantém-se; o código nativo só ativa fora do Expo Go.
