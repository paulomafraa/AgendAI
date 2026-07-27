import type { TodoItem } from '../types';

const STOPWORDS = new Set([
  'a',
  'as',
  'o',
  'os',
  'um',
  'uma',
  'uns',
  'umas',
  'de',
  'da',
  'do',
  'das',
  'dos',
  'no',
  'na',
  'nos',
  'nas',
  'em',
  'ao',
  'aos',
  'pra',
  'para',
  'por',
  'com',
  'sem',
  'e',
  'ou',
  'que',
  'ja',
  'já',
  'fiz',
  'feito',
  'feita',
  'conclui',
  'concluir',
  'concluido',
  'concluida',
  'marcar',
  'marque',
  'marquei',
  'risca',
  'riscar',
  'risquei',
  'tarefa',
  'tarefas',
  'como',
  'referente',
  'sobre',
  'meu',
  'minha',
  'meus',
  'minhas',
]);

function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '');
}

/** Tokens úteis para matching (sem stopwords / ruído de conclusão). */
export function contentTokens(text: string): string[] {
  const raw = stripAccents(text.toLowerCase())
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t) && !STOPWORDS.has(stripAccents(t)));
  return raw;
}

/** Raiz curta para flexões (trocar / troquei / troca). */
function stemToken(token: string): string {
  const t = stripAccents(token.toLowerCase());
  if (t.length <= 3) return t;
  return t.slice(0, 4);
}

function editDistance1(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  if (i < a.length || j < b.length) edits += 1;
  return edits <= 1;
}

function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const sa = stemToken(a);
  const sb = stemToken(b);
  return sa === sb || editDistance1(sa, sb);
}

/**
 * Fração dos tokens da consulta que aparecem no título (0–1).
 * "já troquei as matérias" vs "Trocar matérias no sistema…" → alto.
 */
export function titleMatchScore(query: string, title: string): number {
  const q = contentTokens(query);
  const t = contentTokens(title);
  if (q.length === 0 || t.length === 0) {
    const ql = stripAccents(query.toLowerCase());
    const tl = stripAccents(title.toLowerCase());
    if (!ql || !tl) return 0;
    if (ql.includes(tl) || tl.includes(ql)) return 1;
    return 0;
  }
  let hit = 0;
  for (const qt of q) {
    if (t.some((tt) => tokensMatch(qt, tt))) hit += 1;
  }
  return hit / q.length;
}

const MIN_SCORE = 0.5;

/**
 * Encontra a melhor tarefa aberta para complete/delete/due.
 * Aceita paráfrases e fala curta ("já troquei as matérias").
 */
export function findMatchingTodo(
  queryTitle: string,
  todos: TodoItem[],
  opts?: { includeDone?: boolean },
): TodoItem | undefined {
  const pool = opts?.includeDone ? todos : todos.filter((t) => !t.done);
  if (pool.length === 0) return undefined;

  const needle = queryTitle.trim();
  if (!needle) return undefined;

  // Atalho: substring clássica ainda vale
  const lower = needle.toLowerCase();
  const exactish = pool.find(
    (t) =>
      t.title.toLowerCase().includes(lower) ||
      lower.includes(t.title.toLowerCase()),
  );
  if (exactish) return exactish;

  let best: TodoItem | undefined;
  let bestScore = 0;
  for (const todo of pool) {
    const score = titleMatchScore(needle, todo.title);
    if (score > bestScore) {
      bestScore = score;
      best = todo;
    }
  }

  if (best && bestScore >= MIN_SCORE) return best;

  // Uma única tarefa aberta + fala claramente de conclusão com algum overlap fraco
  if (pool.length === 1 && bestScore >= 0.34) {
    return pool[0];
  }

  return undefined;
}
