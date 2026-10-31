// Leitura da Meta ao abrir as páginas de campanhas: só os últimos dias, para a página não esperar pelos 28 dias,
// que continuam a ser recalculados de 6 em 6 horas e no botão. Funções puras, testadas em tests/metaLive.test.ts.

/** Dias lidos a cada abertura: hoje e ontem, os que mudam ao longo do dia. */
export const LIVE_DAYS = 2;
/** Duas aberturas seguidas (ou o mesmo ecrã pedido duas vezes) não voltam a perguntar à Meta. */
export const LIVE_MIN_SECONDS = 30;
/** A página não espera mais do que isto pela Meta; se demorar, mostra a última leitura.
 *  Fica abaixo dos 10 segundos que a Netlify dá a cada página. */
export const LIVE_TIMEOUT_MS = 5000;

/** Se está na hora de ler a Meta outra vez. */
export function syncDue(last: Date | null, now: Date, minSeconds = LIVE_MIN_SECONDS): boolean {
  return !last || now.getTime() - last.getTime() >= minSeconds * 1000;
}

/** Espera pela promessa até `ms`; depois disso segue sem ela e devolve null. */
export async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<null>((resolve) => { t = setTimeout(() => resolve(null), ms); });
  try {
    return await Promise.race([p, limite]);
  } finally {
    clearTimeout(t);
  }
}

/** Linhas com a mesma chave ficam só com a última, como acontecia ao gravá-las uma a uma
 *  (numa gravação em lote, a base recusa duas linhas com a mesma chave). */
export function lastByKey<T>(rows: T[], key: (r: T) => string): T[] {
  const m = new Map<string, T>();
  for (const r of rows) m.set(key(r), r);
  return [...m.values()];
}

/** Partes de no máximo `size` linhas, para cada gravação ficar abaixo do limite de parâmetros do Postgres. */
export function chunks<T>(rows: T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
