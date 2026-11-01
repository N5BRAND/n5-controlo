// Seletor global de software e período (Painel geral e navegação, regras comuns)
export type PeriodKey = "7d" | "30d" | "90d" | "mes" | "mes_anterior" | "personalizado";

export const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "mes", label: "Mês atual" },
  { key: "mes_anterior", label: "Mês anterior" },
  { key: "7d", label: "Últimos 7 dias" },
  { key: "30d", label: "Últimos 30 dias" },
  { key: "90d", label: "Últimos 90 dias" },
  { key: "personalizado", label: "Personalizado" },
];

export interface Range { from: Date; to: Date; prevFrom: Date; prevTo: Date; key: PeriodKey }

/** Datas do período personalizado, como vêm no URL (?de=2026-10-29&ate=2026-11-01), com o «até» incluído. */
export interface CustomDays { de?: string; ate?: string }

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const parseDay = (s: string | undefined) => {
  if (!s || !DAY.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : d;
};
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export function resolveRange(key: string | undefined, now = new Date(), custom: CustomDays = {}): Range {
  let k = (PERIODS.some((p) => p.key === key) ? key : "mes") as PeriodKey;
  let a = parseDay(custom.de), b = parseDay(custom.ate);
  // sem as duas datas válidas, o personalizado volta ao mês atual
  if (k === "personalizado" && (!a || !b)) k = "mes";
  const startOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 1));
  let from: Date, to: Date;
  if (k === "personalizado") {
    if (a! > b!) [a, b] = [b, a];
    // o último dia conta inteiro, como o «agora» dos outros períodos
    from = a!; to = new Date(b!.getTime() + 864e5 - 1);
  }
  else if (k === "mes") { from = startOfMonth(now.getUTCFullYear(), now.getUTCMonth()); to = now; }
  else if (k === "mes_anterior") { from = startOfMonth(now.getUTCFullYear(), now.getUTCMonth() - 1); to = startOfMonth(now.getUTCFullYear(), now.getUTCMonth()); }
  else { const days = Number(k.replace("d", "")); to = now; from = new Date(now.getTime() - days * 864e5); }
  const span = to.getTime() - from.getTime();
  return { from, to, prevFrom: new Date(from.getTime() - span), prevTo: from, key: k };
}

/** Primeiro e último dia do período (o último incluído), para consultas por dia. */
export const rangeDays = (r: Range) => ({ de: isoDay(r.from), ate: isoDay(new Date(r.to.getTime() - 1)) });

export interface Filters { software: string | null; range: Range }

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export function readFilters(sp: Record<string, string | string[] | undefined>): Filters {
  const sw = typeof sp.sw === "string" && sp.sw !== "todos" ? sp.sw : null;
  return { software: sw, range: resolveRange(str(sp.periodo), new Date(), { de: str(sp.de), ate: str(sp.ate) }) };
}

/** Parâmetros que acompanham a navegação entre vistas: software e período (com as datas do personalizado). */
export const KEEP_PARAMS = ["sw", "periodo", "de", "ate"] as const;
