import { fmtDate, LABELS } from "@/lib/format";
import { daysUntil, type Priority } from "@/lib/metrics";
import { makeT, type TFn } from "@/lib/i18n";

const PT = makeT("pt");

export type Phase = keyof typeof LABELS.phase;

/** Tarefa do roadmap como os quadros e as listas a mostram (só valores simples, passam para componentes de cliente). */
export interface TaskRow {
  id: number; code: string; title: string; description: string | null; phase: Phase; priority: Priority;
  dueDate: string | null; ownerUserId: string | null; owner: string | null; softwareId: string; software: string;
  agent: boolean; comments: number; score: number;
}

const PRIORITY_COLOR: Record<Priority, string> = { urgente: "text-bad", alta: "text-warn", normal: "text-accent", baixa: "text-muted" };

export function Avatar({ name, t = PT }: { name: string | null; t?: TFn }) {
  if (!name) return <span className="inline-flex size-6 items-center justify-center rounded-full border border-dashed border-line text-xs text-muted" title={t("Sem responsável")}>–</span>;
  const initials = name.replace(/\(.*?\)/g, " ").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  return <span className="inline-flex size-6 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent" title={name}>{initials}</span>;
}

export function CommentCount({ n, t = PT }: { n: number; t?: TFn }) {
  if (!n) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted" title={t(n === 1 ? "{n} comentário" : "{n} comentários", { n })}>
      <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" strokeLinejoin="round" /></svg>
      {n}<span className="sr-only"> {t("comentários")}</span>
    </span>
  );
}

export const CHIP_TONE = { bad: "text-bad border-bad/40", warn: "text-warn border-warn/40", accent: "text-accent border-accent/40", muted: "text-muted border-line" } as const;
export const CHIP = "inline-flex items-center gap-1 rounded-md border bg-white px-1.5 py-0.5 text-xs font-medium whitespace-nowrap";

/** Vencimento em texto curto ("há 3 dias", "hoje", "amanhã", "em 4 dias", ou a data). */
export function dueLabel(due: string, t: TFn = PT): string {
  const d = daysUntil(due);
  if (d < 0) return t(-d === 1 ? "há {n} dia" : "há {n} dias", { n: -d });
  if (d === 0) return t("hoje");
  if (d === 1) return t("amanhã");
  if (d <= 7) return t("em {n} dias", { n: d });
  return fmtDate(due);
}

export function PriorityChip({ priority, t = PT }: { priority: Priority; t?: TFn }) {
  const tone = priority === "urgente" ? "bad" : priority === "alta" ? "warn" : priority === "normal" ? "accent" : "muted";
  return (
    <span className={`${CHIP} ${CHIP_TONE[tone]}`} title={t("Prioridade {name}", { name: t(LABELS.priority[priority]).toLowerCase() })}>
      <svg viewBox="0 0 16 16" className="size-3.5" fill="currentColor" aria-hidden="true"><path d="M3 1.5a.75.75 0 0 1 .75.75v.4c1.2-.5 2.3-.4 3.4 0 1.2.45 2.2.5 3.6-.1a.5.5 0 0 1 .7.45v6a.5.5 0 0 1-.3.46c-1.6.7-2.9.6-4.2.1-1-.4-1.9-.5-3.2 0v4.5a.75.75 0 0 1-1.5 0v-12A.75.75 0 0 1 3 1.5Z" /></svg>
      {t(LABELS.priority[priority])}
    </span>
  );
}
