# Como testar sem buildar toda hora

## Ideia

| App | Para quê | Precisa rebuild? |
|-----|----------|------------------|
| **AgendAI Dev** (development build) | Testar voz, Google, UI todos os dias | Só quando muda nativo |
| **AgendAI** (production) | Versão “boa” para usar no dia a dia | Quando estiver estável |

O **Expo Go** da loja **não serve** para voz / Google Sign-In nativo.

## Setup uma vez

### 1. Gerar o APK de desenvolvimento

```bash
cd C:\Users\paulo\Desktop\AgendAI
npm run eas:dev
```

Instala esse APK no telemóvel (é o “AgendAI” com dev client por dentro).

### 2. No PC, ligar o Metro (todos os dias)

```bash
npm run start:dev -- --tunnel
```

Abre o app **já instalado** no telemóvel (não o Expo Go).  
Ele liga ao PC e carrega o código **novo** sem baixar APK.

### 3. Mudou o código?

- Guarda o ficheiro → no app: sacode o telemóvel → **Reload** (ou abre de novo)
- **Não** precisas de `eas build`

## Quando VOLTAR a buildar o Dev

Só se mudares coisas **nativas**, por exemplo:
- novo pacote com código nativo (`expo-notifications`, `expo-quick-actions`, widget, etc.)
- `app.json` plugins / permissões
- atualizar Expo SDK

Aí: `npm run eas:dev` de novo e reinstala.

### Erro `ExpoPushTokenManager` / módulo nativo não encontrado

O APK Dev instalado é **anterior** a `expo-notifications`. Reload **não resolve**.

1. `npm run eas:dev`
2. Instala o APK novo no telemóvel
3. `npm run test:device` (ou `start:dev -- --tunnel`)

Até rebuildar, o app sobe sem notificação local (o resto continua a funcionar).

## Quando buildar Production

Quando a versão estiver boa para “ficar”:

```bash
npm run eas:prod
```

Isso gera o APK estável (o que usas sem Metro ligado).

## Resumo mental

1. **Dev APK** = motor (voz, Google) — raro reinstalar  
2. **`npm run start:dev`** = testes rápidos de voz/UI/sync  
3. **`eas:prod`** = só releases estáveis  
