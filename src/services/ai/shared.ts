import type { AiProviderId, IntentItem, ParsedBatch } from '../../types';
import { clampText, LIMITS } from '../../utils/security';

export const INTENT_SYSTEM_PROMPT = `Você é o motor de interpretação do app AgendAI (português do Brasil).
O usuário fala ou digita UM pedido que pode conter VÁRIAS intenções misturadas.

Sua missão: ler, quebrar e categorizar. Nunca junte várias tarefas distintas num único item.

PRIORIDADE DE INTERPRETAÇÃO (nessa ordem):
1) EVENTO PÚBLICO / PROGRAMAÇÃO NA WEB: futebol, F1, NBA, UFC, shows, sorteio, "próximo jogo do X", "assistir Y", "próxima corrida".
   → USE busca na web (obrigatório) para data, hora de início (kickoff/largada), adversário, local e transmissão.
   → Escolha SEMPRE o PRÓXIMO evento FUTURO depois de {{NOW}} (agora). Se o resultado da busca já começou ou já acabou, IGNORE e pegue o seguinte.
   → datetime ISO America/Sao_Paulo com a HORA REAL da busca (ex.: 19:00). timeExplicit true, softTime false.
   → softTime 13h é PROIBIDO para esporte/F1/jogo/show quando a busca mostrar qualquer HH:MM (19:00, 10:00, etc.).
   → Título curto tipo "Vasco x Medellín" ou "F1 GP da Bélgica"; sessão (Corrida/Quali) em notes.
   → NÃO use notes pedindo "consultar horário" se a busca já trouxe a hora.
   → Só create_task se a busca não trouxer NENHUMA data futura.
2) COMPROMISSO PESSOAL com data/hora dita pelo usuário: dentista, reunião, "arrancar um dente amanhã às 9".
3) TAREFA do dia a dia: "fazer as malas", "comprar pão" → create_task.
4) Fallback softTime 13h: SOMENTE compromisso pessoal em que o usuário deu DATA sem hora (amanhã/sexta). Nunca para "próximo jogo/corrida".

Quando o pedido depender de horário/adversário/programação pública, USE A BUSCA NA WEB. Não invente confrontos nem horários.

Responda APENAS com JSON válido (sem markdown), neste formato:
{
  "summary": "frase curta do que você entendeu no total",
  "items": [
    {
      "action": "create_task" | "complete_task" | "delete_task" | "set_task_due" | "create_event" | "reschedule_event" | "list_tasks" | "unknown",
      "title": "string curta e clara (UMA coisa só)",
      "notes": "detalhes opcionais ou string vazia",
      "datetime": "ISO-8601 com offset America/Sao_Paulo se houver data/hora de EVENTO, senão null",
      "dueDate": "ISO-8601 (data do PRAZO da tarefa) ou null",
      "durationMinutes": number ou null,
      "wantsReminder": boolean,
      "reminderMinutes": number ou null,
      "recurrence": "string ou null (ex.: WEEKLY:MO ou RRULE:FREQ=WEEKLY;BYDAY=MO)",
      "location": "local do evento ou null (ex.: circuito, estádio, Av. Paulista, Zoom)",
      "broadcastStartAt": "ISO-8601 do início da TRANSMISSÃO/pré-jogo/cobertura na TV quando for diferente do horário principal; senão null",
      "allDay": boolean (true se dia inteiro explícito tipo feriado),
      "timeExplicit": boolean (true SÓ se a pessoa falou hora de relógio OU se a BUSCA trouxe hora confiável),
      "softTime": boolean (true se create_event só com DATA dita pelo usuário, sem hora → app usa 13:00; NUNCA em evento público inventado),
      "reminderSeries": null ou {
        "dayKey": "YYYY-MM-DD do dia dos avisos",
        "fromHour": 18,
        "toHour": 23,
        "intervalMinutes": 60,
        "untilDone": true
      },
      "category": "compras|casa|trabalho|pessoal|saude|agenda|esporte|outro ou rótulo curto",
      "confidence": number entre 0 e 1
    }
  ]
}

Regras de quebra (obrigatórias):
- Se a mensagem listar várias coisas (vírgulas, "e", "também", números, quebras de linha), gere UM item por coisa.
- Misturas: "me lembra amanhã às 9 do dentista e compra pão" → create_event + create_task.
- SEM data e SEM horário e NÃO for evento público de busca → create_task (não invente compromisso).
- Pedido de EVENTO PÚBLICO ("próximo jogo", "próxima corrida", "assistir sorteio") → busca + create_event do PRÓXIMO futuro após {{NOW}}, com HH:MM real (timeExplicit true).
- NUNCA marque evento público cujo datetime seja anterior a {{NOW}}.
- SÓ data PESSOAL, SEM hora ("amanhã dentista", "sexta reunião") → create_event softTime true às 13:00, timeExplicit false.
- Data + hora (usuário ou busca) → create_event timeExplicit true, softTime false.
- Tarefas do dia a dia / afazer sem encaixe na agenda → create_task. Prazo ("até sexta") → dueDate; NÃO use create_event só por ter prazo.
- Compromisso com horário na agenda / consulta / partida COM hora da busca ou do usuário → create_event (datetime + timeExplicit true).
- Título do evento: curto e direto (ex.: "Vasco x Flamengo" ou "F1 GP da Bélgica"). Detalhe de sessão/etapa vai em notes.
- Lembretes REPETIDOS no mesmo compromisso ("me lembra a cada 1h das 18 às 23 até eu fazer"):
  · UM único create_task (NÃO vários eventos)
  · reminderSeries com fromHour, toHour, intervalMinutes, dayKey, untilDone true
  · title curto; notes pode explicar a série
- "prazo da tarefa X para sexta" → set_task_due.
- "já fiz X" / "risca X" → complete_task (cancela a série de lembretes).
- "apaga X" → delete_task.
- "adiar X para quinta às 15" / "remarcar dentista" → reschedule_event (timeExplicit true, softTime false).
- "evento o dia todo amanhã" / "feriado sexta" → create_event allDay true (não usa softTime 13h).
- Local: "reunião no escritório" → location; estádio/circuito da busca → location.
- "toda segunda às 9 standup" → create_event recurrence + timeExplicit true.
- "me avisa 1 hora antes" → reminderMinutes 60 (padrão 30).
- Se o evento for em menos de ~35 min, reminderMinutes 0 ou 1.
- Atalhos de lista → list_tasks.
- softTime NUNCA junto com timeExplicit true.
- Se datetime preenchido NÃO peça "verificar horário" em notes.
- Se a busca mostrar HH:MM em jogo/F1/show: OBRIGATÓRIO usar essa hora (timeExplicit true). softTime proibido.
- Se a busca NÃO achar horário mas achar dia FUTURO: softTime true nesse dia (último recurso).
- Se a busca NÃO achar data futura: create_task, não invente.
- wantsReminder true por padrão em create_event com datetime (exceto allDay sem pedido).
- category em pt-BR curto (esporte para jogos).
- Se não entender nada, action=unknown.
- agora (referência local Brasil): {{NOW_LOCAL}}
- agora (ISO): {{NOW}}
- language: pt-BR`;

function formatNowLocalPtBr(date: Date): string {
  const weekday = date.toLocaleDateString('pt-BR', {
    weekday: 'long',
    timeZone: 'America/Sao_Paulo',
  });
  const full = date.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'full',
    timeStyle: 'short',
  });
  return `${full} (${weekday}, America/Sao_Paulo)`;
}

export function buildIntentPrompt(rawInput: string): string {
  const now = new Date();
  return `${INTENT_SYSTEM_PROMPT.replace('{{NOW}}', now.toISOString()).replace(
    '{{NOW_LOCAL}}',
    formatNowLocalPtBr(now),
  )}\n\nPedido do usuário:\n"""${rawInput}"""`;
}

export function detectProvider(apiKey: string): AiProviderId {
  const key = apiKey.trim();
  if (!key) return 'unknown';
  if (key.startsWith('AIza')) return 'gemini';
  if (key.startsWith('sk-ant-')) return 'anthropic';
  if (key.startsWith('sk-')) return 'openai';
  return 'gemini';
}

export function providerLabel(id: AiProviderId): string {
  switch (id) {
    case 'gemini':
      return 'Google Gemini';
    case 'openai':
      return 'OpenAI';
    case 'anthropic':
      return 'Anthropic Claude';
    default:
      return 'Desconhecido';
  }
}

export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1].trim() : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error('Resposta da IA sem JSON.');
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

export function friendlyAiError(message: string): string {
  const lower = message.toLowerCase();
  if (
    lower.includes('quota') ||
    lower.includes('rate') ||
    lower.includes('resource_exhausted') ||
    lower.includes('429')
  ) {
    return (
      'Cota da API esgotada ou temporariamente indisponível. Espere ~1 min e tente de novo. ' +
      'No plano gratuito isso é comum; faturamento no provedor aumenta o limite.'
    );
  }
  if (
    lower.includes('no longer available') ||
    lower.includes('not found') ||
    lower.includes('is not found')
  ) {
    return (
      'O modelo escolhido não está disponível nessa conta. O app tenta outros automaticamente. ' +
      'Se persistir, gere uma chave nova ou troque de provedor em Ajustes.'
    );
  }
  if (
    lower.includes('api key') ||
    lower.includes('invalid') ||
    lower.includes('permission') ||
    lower.includes('unauthorized') ||
    lower.includes('401') ||
    lower.includes('403')
  ) {
    return 'Chave de API inválida ou sem permissão. Confira o que colou em Ajustes.';
  }
  return message.length > 160 ? `${message.slice(0, 160)}…` : message;
}

const ALLOWED = new Set([
  'create_task',
  'complete_task',
  'delete_task',
  'set_task_due',
  'create_event',
  'reschedule_event',
  'list_tasks',
  'unknown',
]);

function scrubNotesWhenDatetimeKnown(
  notes: string | undefined,
  hasDatetime: boolean,
): string | undefined {
  if (!notes?.trim()) return undefined;
  const trimmed = notes.trim();
  if (!hasDatetime) return trimmed;

  const askTime =
    /verificar\s+(o\s+)?hor[aá]rio|hor[aá]rio\s+exato\s+n[aã]o|confirmar\s+(o\s+)?hor[aá]rio|checar\s+(o\s+)?hor[aá]rio|n[aã]o\s+especificad/i;

  const kept = trimmed
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !askTime.test(s))
    .join(' ')
    .trim();

  return kept || undefined;
}

/** Converte atalhos do modelo em RRULE Google Calendar. */
export function toGoogleRecurrence(recurrence?: string): string[] | undefined {
  if (!recurrence?.trim()) return undefined;
  const raw = recurrence.trim().slice(0, 180);
  // Só caracteres seguros de RRULE (sem injeção de payload)
  if (!/^[A-Za-z0-9:;,=_-]+$/.test(raw.replace(/^RRULE:/i, ''))) {
    return undefined;
  }
  if (raw.toUpperCase().startsWith('RRULE:')) return [raw.toUpperCase()];
  if (raw.toUpperCase().startsWith('FREQ=')) return [`RRULE:${raw.toUpperCase()}`];

  const weekly = raw.match(/^WEEKLY:([A-Z]{2}(?:,[A-Z]{2})*)$/i);
  if (weekly) {
    return [`RRULE:FREQ=WEEKLY;BYDAY=${weekly[1].toUpperCase()}`];
  }
  const daily = /^DAILY$/i.test(raw);
  if (daily) return ['RRULE:FREQ=DAILY'];
  return [`RRULE:${raw}`];
}

/** Google Tasks só guarda a data; formata YYYY-MM-DDT00:00:00.000Z no fuso BR. */
export function toGoogleTaskDue(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso));
  const y = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  const d = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${y}-${m}-${d}T00:00:00.000Z`;
}

/** Data YYYY-MM-DD no fuso BR (eventos all-day). */
export function toDateOnlySaoPaulo(iso: string): string {
  return toGoogleTaskDue(iso).slice(0, 10);
}

export function formatDueDatePtBr(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Pedidos que dependem de programação pública na web
 * (jogo, GP, sorteio, etc.) — preferir busca Gemini.
 */
export function looksLikePublicLookupIntent(rawInput: string): boolean {
  const t = rawInput.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  if (
    /\b(proximo jogo|proxima partida|proxima corrida|proximo gp|assistir (o |a )?(jogo|partida|corrida|gp|classico)|ver (o |a )?(jogo|partida|corrida)|sorteio da copa|sorteio|grand prix|\bgp\b|formula\s*1|f1\b|oscar|ufc|nba|nfl|libertadores|brasileirao|champions|sudamericana)\b/.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /\b(vasco|flamengo|palmeiras|corinthians|sao paulo|fluminense|gremio|internacional|santos|botafogo|cruzeiro|atletico|barcelona|real madrid)\b/.test(
      t,
    ) &&
    /\b(jogo|partida|assistir|ver|proximo|proxima|acompanhar)\b/.test(t)
  ) {
    return true;
  }
  return false;
}

/** Evento público fraco: já passou, ou soft 13h preguiçoso quando pediu "próximo". */
export function publicLookupNeedsRetry(
  batch: ParsedBatch,
  rawInput: string,
  nowMs = Date.now(),
): boolean {
  if (!looksLikePublicLookupIntent(rawInput)) return false;
  const events = batch.items.filter((i) => i.action === 'create_event');
  if (events.length === 0) {
    // Só tarefa/unknown em pedido público → vale insistir com busca
    return batch.items.every(
      (i) => i.action === 'create_task' || i.action === 'unknown',
    );
  }
  for (const item of events) {
    if (!item.datetime) return true;
    const start = new Date(item.datetime).getTime();
    if (Number.isNaN(start) || start <= nowMs - 2 * 60_000) return true;
    if (item.softTime === true) return true;
    if (item.timeExplicit !== true) return true;
  }
  return false;
}

function normalizeItem(raw: Record<string, unknown>): IntentItem {
  const action = String(raw.action ?? 'unknown');
  const reminderRaw = raw.reminderMinutes;
  const reminderMinutes =
    typeof reminderRaw === 'number' && reminderRaw > 0
      ? Math.round(reminderRaw)
      : undefined;
  const hasDatetime = Boolean(raw.datetime);
  const allDay = Boolean(raw.allDay);
  const wantsReminder =
    raw.wantsReminder === undefined
      ? (action === 'create_event' || action === 'reschedule_event') &&
        hasDatetime &&
        !allDay
      : Boolean(raw.wantsReminder);
  const rawNotes = raw.notes ? String(raw.notes) : undefined;
  const recurrence = raw.recurrence ? String(raw.recurrence).trim() : undefined;
  const dueDate =
    raw.dueDate != null && String(raw.dueDate).trim()
      ? String(raw.dueDate).trim()
      : undefined;
  const location =
    raw.location != null && String(raw.location).trim()
      ? String(raw.location).trim()
      : undefined;
  const broadcastRaw =
    raw.broadcastStartAt != null && String(raw.broadcastStartAt).trim()
      ? String(raw.broadcastStartAt).trim()
      : undefined;
  let broadcastStartAt: string | undefined;
  if (broadcastRaw) {
    const t = new Date(broadcastRaw).getTime();
    if (!Number.isNaN(t)) broadcastStartAt = new Date(t).toISOString();
  }

  const timeExplicit = raw.timeExplicit === true;
  // softTime só quando a IA marcar explicitamente (não inferir só por timeExplicit false,
  // senão horário real da busca vira 13h no app).
  let softTime = raw.softTime === true && !timeExplicit;
  if (timeExplicit) softTime = false;

  let reminderSeries: IntentItem['reminderSeries'];
  const rs = raw.reminderSeries;
  if (rs && typeof rs === 'object') {
    const obj = rs as Record<string, unknown>;
    const fromHour = Number(obj.fromHour);
    const toHour = Number(obj.toHour);
    const intervalMinutes = Number(obj.intervalMinutes);
    if (
      Number.isFinite(fromHour) &&
      Number.isFinite(toHour) &&
      Number.isFinite(intervalMinutes)
    ) {
      reminderSeries = {
        dayKey:
          obj.dayKey != null && String(obj.dayKey).trim()
            ? String(obj.dayKey).trim().slice(0, 10)
            : undefined,
        fromHour: Math.min(23, Math.max(0, Math.round(fromHour))),
        toHour: Math.min(23, Math.max(0, Math.round(toHour))),
        intervalMinutes: Math.max(15, Math.round(intervalMinutes)),
        untilDone: obj.untilDone !== false,
      };
    }
  }

  const scrubbedNotes = scrubNotesWhenDatetimeKnown(rawNotes, hasDatetime);

  return {
    action: (ALLOWED.has(action) ? action : 'unknown') as IntentItem['action'],
    title: clampText(raw.title, LIMITS.title, 'Sem título'),
    notes: scrubbedNotes
      ? clampText(scrubbedNotes, LIMITS.notes) || undefined
      : undefined,
    datetime: raw.datetime ? String(raw.datetime).slice(0, 40) : undefined,
    dueDate: dueDate ? dueDate.slice(0, 40) : undefined,
    durationMinutes:
      typeof raw.durationMinutes === 'number' &&
      Number.isFinite(raw.durationMinutes)
        ? Math.min(24 * 60, Math.max(5, Math.round(raw.durationMinutes)))
        : undefined,
    wantsReminder,
    reminderMinutes:
      wantsReminder &&
      (action === 'create_event' || action === 'reschedule_event')
        ? Math.min(24 * 60, Math.max(0, reminderMinutes ?? 30))
        : reminderMinutes != null
          ? Math.min(24 * 60, Math.max(0, reminderMinutes))
          : undefined,
    recurrence: recurrence
      ? clampText(recurrence, 180) || undefined
      : undefined,
    location: location
      ? clampText(location, LIMITS.location) || undefined
      : undefined,
    broadcastStartAt,
    allDay: allDay || undefined,
    timeExplicit: timeExplicit || undefined,
    softTime: softTime || undefined,
    reminderSeries,
    category: raw.category
      ? clampText(String(raw.category), LIMITS.category) || undefined
      : undefined,
    confidence: typeof raw.confidence === 'number' ? raw.confidence : 0.5,
  };
}

export function toParsedBatch(
  parsed: Record<string, unknown>,
  rawInput: string,
): ParsedBatch {
  const summary = String(parsed.summary ?? 'Pedido interpretado.');
  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
  const items = rawItems
    .filter(
      (i): i is Record<string, unknown> =>
        Boolean(i) && typeof i === 'object',
    )
    .map(normalizeItem);
  return {
    summary,
    items:
      items.length > 0
        ? items
        : [
            {
              action: 'unknown',
              title: rawInput.slice(0, 80),
              confidence: 0,
            },
          ],
    rawInput,
  };
}
