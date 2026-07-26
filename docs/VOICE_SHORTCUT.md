# Atalho de voz (sem poluir a UI)

O app já abre o microfone quando chega o deep link:

```
agendai://voice
```

## Como usar no Android

1. Rebuild o **Dev APK** (notificações + `expo-quick-actions` + intent filter).
2. Long-press no ícone do AgendAI → atalho **Voz** (abre o microfone).
3. Ou abra `agendai://voice` (automação / Tasker / link).

## Widget nativo

Um widget só-com-microfone ainda não está no app (seria outro módulo nativo). O atalho de long-press cobre o mesmo fluxo sem poluir a UI.
