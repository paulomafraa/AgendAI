/**
 * Série de avisos no MESMO item (não cria 50 compromissos).
 * Ex.: a cada 60 min das 18h às 23h, até marcar como feito.
 */
export type ReminderSeries = {
  /** Dia YYYY-MM-DD (America/Sao_Paulo) */
  dayKey: string;
  /** Hora início inclusiva 0–23 */
  fromHour: number;
  /** Hora fim inclusiva 0–23 */
  toHour: number;
  /** Intervalo em minutos (ex.: 60) */
  intervalMinutes: number;
  /** Continua até a pessoa marcar feito */
  untilDone: boolean;
};

export type IntentReminderSeries = {
  dayKey?: string;
  fromHour: number;
  toHour: number;
  intervalMinutes: number;
  untilDone?: boolean;
};
