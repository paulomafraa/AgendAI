# Widget de microfone (visão)

## Melhor UX (meta)

1 toque → fala → silêncio → tarefas/eventos gravados.  
Sem modal, sem “Enviar”, sem abrir ecrãs.

No app isso já fica assim quando **Confirmar antes de gravar** está **desligado**.

## Widget na home do Android

Gravar **sem abrir o app** de verdade (só no widget, em background) é difícil no Android moderno (microfone + serviço em 1º plano + restrições).

**Abordagem recomendada (simples e fiável):**

1. Widget na home = botão de microfone  
2. Ao tocar, abre o AgendAI com deep link `agendai://voice`  
3. O app já começa a ouvir e, com confirmação desligada, grava sozinho  
4. Volta para a home / mostra um toast curto

Isto sente-se “quase sem abrir o app” (ecrã abre 1–2 s) e evita rejeição na Play Store / kills de background.

## Deep link (já no código)

```
agendai://voice
```

O Início inicia a escuta ao receber este link.

## Próximo passo técnico

Pacote típico: `react-native-android-widget` (+ config plugin no Expo) no próximo build.  
O widget só dispara o intent/`agendai://voice`.

## Checklist agora (sem widget ainda)

1. Ajustes → **Confirmar antes de gravar** = OFF  
2. Toque **Voz** → fale → pare → itens criados  
3. Ative **Google Calendar API** + **Google Tasks API** no Cloud Console  
4. Desconecte/reconecte Google se o Calendar der 403
