// Cálculos puros das métricas do sistema de controlo. Sem acesso à base de dados,
// para poderem ser testados e reutilizados pelos ecrãs, pela API e pelos alertas.

export type MrrKey = string; // `${organizationId}|${softwareId}`
export type MrrMap = Map<MrrKey, number>; // cêntimos sem IVA

export interface MrrMovements {
  startCents: number;
  newCents: number;
  expansionCents: number;
  contractionCents: number;
  churnCents: number;
  endCents: number;
  newAccounts: number;
  churnedAccounts: number;
  startAccounts: number;
}

/** Decompõe a variação de MRR entre dois meses (regras do Módulo 4). */
export function mrrMovements(prev: MrrMap, curr: MrrMap): MrrMovements {
  const m: MrrMovements = {
    startCents: 0, newCents: 0, expansionCents: 0, contractionCents: 0, churnCents: 0, endCents: 0,
    newAccounts: 0, churnedAccounts: 0, startAccounts: 0,
  };
  for (const v of prev.values()) { m.startCents += v; if (v > 0) m.startAccounts++; }
  for (const v of curr.values()) m.endCents += v;
  const keys = new Set([...prev.keys(), ...curr.keys()]);
  for (const k of keys) {
    const a = prev.get(k) ?? 0;
    const b = curr.get(k) ?? 0;
    if (a === 0 && b > 0) { m.newCents += b; m.newAccounts++; }
    else if (a > 0 && b === 0) { m.churnCents += a; m.churnedAccounts++; }
    else if (b > a) m.expansionCents += b - a;
    else if (b < a) m.contractionCents += a - b;
  }
  return m;
}

/** Churn de contas no mês: contas perdidas ÷ contas no início do mês. */
export function churnRate(prev: MrrMap, curr: MrrMap): number {
  const start = [...prev.values()].filter((v) => v > 0).length;
  if (start === 0) return 0;
  const lost = [...prev.entries()].filter(([k, v]) => v > 0 && (curr.get(k) ?? 0) === 0).length;
  return lost / start;
}

/** NRR: receita atual das contas que existiam no mês base ÷ receita delas no mês base. */
export function nrr(base: MrrMap, curr: MrrMap): number | null {
  let baseSum = 0, nowSum = 0;
  for (const [k, v] of base) {
    if (v <= 0) continue;
    baseSum += v;
    nowSum += curr.get(k) ?? 0;
  }
  return baseSum > 0 ? nowSum / baseSum : null;
}

/** ACV = MRR × 12 + consumo extra dos últimos 12 meses (anualizado se a conta tem menos de 12 meses). */
export function acvCents(mrrCents: number, extraLast12Cents: number, monthsActive: number): number {
  const months = Math.max(1, Math.min(12, monthsActive));
  return mrrCents * 12 + Math.round(extraLast12Cents * (12 / months));
}

export function arpaCents(totalMrrCents: number, payingAccounts: number): number {
  return payingAccounts > 0 ? Math.round(totalMrrCents / payingAccounts) : 0;
}

/** LTV = ARPA × margem bruta ÷ churn mensal. Sem churn devolve null (não há estimativa honesta). */
export function ltvCents(arpa: number, grossMargin: number, monthlyChurn: number): number | null {
  if (monthlyChurn <= 0) return null;
  return Math.round((arpa * grossMargin) / monthlyChurn);
}

export function cacCents(spendCents: number, newPayingCustomers: number): number | null {
  return newPayingCustomers > 0 ? Math.round(spendCents / newPayingCustomers) : null;
}

/** Payback em meses = CAC ÷ margem bruta mensal média por conta. */
export function paybackMonths(cac: number | null, monthlyGrossMarginPerAccountCents: number): number | null {
  if (cac === null || monthlyGrossMarginPerAccountCents <= 0) return null;
  return cac / monthlyGrossMarginPerAccountCents;
}

/** Pontuação do backlog: alcance × impacto × confiança ÷ esforço. */
export function riceScore(reach: number, impact: number, confidencePct: number, effort: number): number {
  if (effort <= 0) return 0;
  return Math.round(((reach * impact * (confidencePct / 100)) / effort) * 10) / 10;
}

export interface Heartbeat { personId: string; at: Date }

/**
 * Tempo ativo por pessoa a partir dos sinais `session.heartbeat` (um a cada 60 s com a app em primeiro plano).
 * Cada sinal vale até 60 s; intervalos maiores que 30 min fecham a sessão.
 */
export function activeSeconds(beats: Heartbeat[], gapMinutes = 30): Map<string, { seconds: number; sessions: number }> {
  const byPerson = new Map<string, Date[]>();
  for (const b of beats) {
    const list = byPerson.get(b.personId) ?? [];
    list.push(b.at);
    byPerson.set(b.personId, list);
  }
  const out = new Map<string, { seconds: number; sessions: number }>();
  for (const [person, times] of byPerson) {
    times.sort((a, b) => a.getTime() - b.getTime());
    let seconds = 0, sessions = 0;
    for (let i = 0; i < times.length; i++) {
      const gap = i === 0 ? Infinity : (times[i].getTime() - times[i - 1].getTime()) / 1000;
      if (gap > gapMinutes * 60) sessions++;
      seconds += Math.min(60, gap === Infinity ? 60 : gap);
    }
    out.set(person, { seconds, sessions });
  }
  return out;
}

/** Saúde da conta: verde, amarelo ou vermelho (regra 7 do Módulo 4). */
export function accountHealth(input: {
  usageChangePct: number | null; // variação de uso nas últimas 2 semanas face às 2 anteriores
  daysSinceLastLogin: number | null;
  failedPayments: number;
  negativeFeedback: number;
}): "verde" | "amarelo" | "vermelho" {
  if (input.failedPayments > 0) return "vermelho";
  if (input.daysSinceLastLogin !== null && input.daysSinceLastLogin >= 10) return "vermelho";
  if (input.usageChangePct !== null && input.usageChangePct <= -50) return "vermelho";
  if (input.negativeFeedback >= 2) return "amarelo";
  if (input.usageChangePct !== null && input.usageChangePct <= -25) return "amarelo";
  if (input.daysSinceLastLogin !== null && input.daysSinceLastLogin >= 5) return "amarelo";
  return "verde";
}

/** Horas úteis entre duas datas (segunda a sexta, 09:00–18:00, hora de Lisboa aproximada a UTC+0/+1). */
export function businessHoursBetween(from: Date, to: Date): number {
  if (to <= from) return 0;
  let hours = 0;
  const cursor = new Date(from);
  cursor.setMinutes(0, 0, 0);
  while (cursor < to) {
    const day = cursor.getUTCDay();
    const h = cursor.getUTCHours();
    if (day >= 1 && day <= 5 && h >= 9 && h < 18) hours++;
    cursor.setUTCHours(cursor.getUTCHours() + 1);
  }
  return hours;
}

export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function previousMonthKey(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return monthKey(d);
}

// ---------------- Módulo Impacto ----------------
// Mede o retorno que cada software dá ao utilizador: tempo poupado, leads atendidas a tempo e negócio que daí vem.
// Regra de honestidade: separar sempre o que é MEDIDO (eventos dos softwares) do que é ESTIMADO (comparações).

export type TaskActor = "ai" | "assisted" | "human";
export interface TaskEvent { task: string; by: TaskActor; humanSeconds?: number | null }
export interface TaskRef {
  key: string; label: string; manualMinutes: number; remainingMinutes: number; validated: boolean;
  /** true quando o tempo à mão foi medido automaticamente nas execuções feitas pela pessoa */
  measured?: boolean; samples?: number;
}

/**
 * Minutos poupados numa execução de uma tarefa.
 * IA ou assistido: tempo de referência à mão − tempo humano que ainda ficou (o enviado pelo software, ou o de referência).
 * Feita à mão no software: 0 (o software não poupou tempo nessa execução).
 */
export function minutesSaved(ev: TaskEvent, ref: TaskRef | undefined): number {
  if (!ref || ev.by === "human") return 0;
  const remaining = ev.humanSeconds != null && ev.humanSeconds >= 0 ? ev.humanSeconds / 60 : ref.remainingMinutes;
  return Math.max(0, ref.manualMinutes - remaining);
}

export interface TaskRow {
  key: string; label: string; known: boolean; validated: boolean; measured: boolean; samples: number;
  count: number; ai: number; assisted: number; human: number; minutesSaved: number; manualMinutes: number; remainingMinutes: number;
}

export function summarizeTasks(events: TaskEvent[], catalog: TaskRef[]): TaskRow[] {
  const byKey = new Map<string, TaskRow>();
  const refs = new Map(catalog.map((c) => [c.key, c]));
  for (const ev of events) {
    const ref = refs.get(ev.task);
    let row = byKey.get(ev.task);
    if (!row) {
      row = { key: ev.task, label: ref?.label ?? ev.task, known: !!ref, validated: ref?.validated ?? false, measured: ref?.measured ?? false, samples: ref?.samples ?? 0, count: 0, ai: 0, assisted: 0, human: 0,
        minutesSaved: 0, manualMinutes: ref?.manualMinutes ?? 0, remainingMinutes: ref?.remainingMinutes ?? 0 };
      byKey.set(ev.task, row);
    }
    row.count++;
    row[ev.by]++;
    row.minutesSaved += minutesSaved(ev, ref);
  }
  return [...byKey.values()].sort((a, b) => b.minutesSaved - a.minutesSaved);
}

/**
 * Tempo à mão medido automaticamente: mediana do tempo que as pessoas gastam quando fazem a tarefa sem a IA
 * (execuções com by = "human" e human_seconds). Só com amostra suficiente; senão null e usa-se o catálogo.
 */
export function measuredManualMinutes(humanSeconds: number[], minSample: number): number | null {
  const valid = humanSeconds.filter((x) => x > 0 && x < 8 * 3600);
  if (valid.length < minSample) return null;
  return median(valid)! / 60;
}

/** Valor da hora de uma conta a partir do onboarding: faturação média mensal ÷ horas de trabalho por mês. */
export function hourValueFromProfile(avgMonthlyRevenueCents: number | null, weeklyHours: number | null, defaultWeeklyHours: number): number | null {
  if (!avgMonthlyRevenueCents || avgMonthlyRevenueCents <= 0) return null;
  const hours = (weeklyHours && weeklyHours > 0 ? weeklyHours : defaultWeeklyHours) * 52 / 12;
  return hours > 0 ? Math.round(avgMonthlyRevenueCents / hours) : null;
}

/** Valor do tempo poupado, em cêntimos. */
export function timeValueCents(minutes: number, hourValueCents: number): number {
  return Math.round((minutes / 60) * hourValueCents);
}

export interface LeadRecord {
  lead: string;
  receivedAt: Date;
  afterHours: boolean; // fora do horário do utilizador (o software decide e envia em lead.received)
  firstResponseSeconds: number | null;
  respondedBy: "ai" | "human" | null;
  visit: boolean;
  visitByAi: boolean;
  deal: boolean;
  commissionCents: number;
}

export const RESPONSE_BUCKETS = [
  { key: "1m", label: "Até 1 min", max: 60 },
  { key: "5m", label: "1 a 5 min", max: 300 },
  { key: "30m", label: "5 a 30 min", max: 1800 },
  { key: "1h", label: "30 a 60 min", max: 3600 },
  { key: "24h", label: "1 a 24 h", max: 86400 },
  { key: "mais", label: "Mais de 24 h", max: Infinity },
] as const;

export function responseBucket(seconds: number | null): string {
  if (seconds == null) return "sem";
  return RESPONSE_BUCKETS.find((b) => seconds <= b.max)!.key;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const rate = (num: number, den: number) => (den > 0 ? num / den : null);

export interface LeadSummary {
  total: number; answered: number; byAi: number;
  medianSeconds: number | null; medianAiSeconds: number | null; medianHumanSeconds: number | null;
  fastShare: number | null;
  afterHours: number; afterHoursByAi: number; afterHoursByAiVisits: number; afterHoursByAiDeals: number; afterHoursByAiCommissionCents: number;
  visits: number; visitsByAi: number; deals: number; dealsFirstByAi: number; commissionFirstByAiCents: number; commissionCents: number;
  buckets: { key: string; label: string; leads: number; visits: number; visitRate: number | null }[];
  fast: { n: number; visitRate: number | null; dealRate: number | null };
  slow: { n: number; visitRate: number | null; dealRate: number | null };
  /** Diferença medida de conversão entre leads respondidas depressa e devagar; null sem amostra suficiente. */
  upliftVisit: number | null; upliftDeal: number | null;
  /** Estimativas: visitas e negócios que se teriam perdido sem resposta imediata fora de horas. */
  protectedVisits: number | null; protectedDeals: number | null; protectedCommissionCents: number | null;
}

/**
 * Resume as leads de um período.
 * Rápido = primeira resposta até `fastMinutes`; lento = mais de 60 min (o que acontece fora de horas sem IA).
 * A estimativa de negócio protegido só aparece com pelo menos `minSample` leads em cada grupo.
 */
export function leadSummary(leads: LeadRecord[], fastMinutes = 5, minSample = 30): LeadSummary {
  const answered = leads.filter((l) => l.firstResponseSeconds != null);
  const ai = answered.filter((l) => l.respondedBy === "ai");
  const human = answered.filter((l) => l.respondedBy === "human");
  const fastS = fastMinutes * 60;
  const fast = answered.filter((l) => l.firstResponseSeconds! <= fastS);
  const slow = answered.filter((l) => l.firstResponseSeconds! > 3600);
  const ahAi = leads.filter((l) => l.afterHours && l.respondedBy === "ai" && l.firstResponseSeconds! <= fastS);
  const deals = leads.filter((l) => l.deal);
  const vr = (g: LeadRecord[]) => rate(g.filter((l) => l.visit).length, g.length);
  const dr = (g: LeadRecord[]) => rate(g.filter((l) => l.deal).length, g.length);
  const enough = fast.length >= minSample && slow.length >= minSample;
  const upliftVisit = enough ? Math.max(0, vr(fast)! - vr(slow)!) : null;
  const upliftDeal = enough ? Math.max(0, dr(fast)! - dr(slow)!) : null;
  const avgCommission = deals.length ? deals.reduce((a, l) => a + l.commissionCents, 0) / deals.length : 0;
  const protectedDeals = upliftDeal != null ? ahAi.length * upliftDeal : null;
  const buckets = [...RESPONSE_BUCKETS.map((b) => ({ key: b.key, label: b.label })), { key: "sem", label: "Sem resposta" }].map((b) => {
    const g = leads.filter((l) => responseBucket(l.firstResponseSeconds) === b.key);
    return { ...b, leads: g.length, visits: g.filter((l) => l.visit).length, visitRate: vr(g) };
  });
  return {
    total: leads.length, answered: answered.length, byAi: ai.length,
    medianSeconds: median(answered.map((l) => l.firstResponseSeconds!)),
    medianAiSeconds: median(ai.map((l) => l.firstResponseSeconds!)),
    medianHumanSeconds: median(human.map((l) => l.firstResponseSeconds!)),
    fastShare: rate(fast.length, leads.length),
    afterHours: leads.filter((l) => l.afterHours).length,
    afterHoursByAi: ahAi.length,
    afterHoursByAiVisits: ahAi.filter((l) => l.visit).length,
    afterHoursByAiDeals: ahAi.filter((l) => l.deal).length,
    afterHoursByAiCommissionCents: ahAi.reduce((a, l) => a + (l.deal ? l.commissionCents : 0), 0),
    visits: leads.filter((l) => l.visit).length,
    visitsByAi: leads.filter((l) => l.visitByAi).length,
    deals: deals.length,
    dealsFirstByAi: deals.filter((l) => l.respondedBy === "ai").length,
    commissionFirstByAiCents: deals.filter((l) => l.respondedBy === "ai").reduce((a, l) => a + l.commissionCents, 0),
    commissionCents: deals.reduce((a, l) => a + l.commissionCents, 0),
    buckets,
    fast: { n: fast.length, visitRate: vr(fast), dealRate: dr(fast) },
    slow: { n: slow.length, visitRate: vr(slow), dealRate: dr(slow) },
    upliftVisit, upliftDeal,
    protectedVisits: upliftVisit != null ? ahAi.length * upliftVisit : null,
    protectedDeals,
    protectedCommissionCents: protectedDeals != null ? Math.round(protectedDeals * avgCommission) : null,
  };
}

/** Retorno por cada euro pago: valor gerado ÷ custo. null se não houve custo no período. */
export function returnMultiple(valueCents: number, costCents: number): number | null {
  return costCents > 0 ? valueCents / costCents : null;
}

// ---------------- Pipeline: prazos ----------------
export const DUE_SOON_DAYS = 3;
export type DeadlineStatus = "atrasado" | "hoje" | "a_chegar" | "ok" | "sem_prazo" | "concluido";

/** Dias entre hoje e o prazo, em dias de calendário de Lisboa (negativo = atrasado). */
export function daysUntil(dueDate: string, now = new Date()): number {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(now); // AAAA-MM-DD
  return Math.round((Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 864e5);
}

/** Estado do prazo de um item do roadmap. Itens em Done ou Canceled estão concluídos. */
export function deadlineStatus(dueDate: string | null, phase: string, now = new Date(), soonDays = DUE_SOON_DAYS): DeadlineStatus {
  if (phase === "done" || phase === "canceled") return "concluido";
  if (!dueDate) return "sem_prazo";
  const d = daysUntil(dueDate, now);
  if (d < 0) return "atrasado";
  if (d === 0) return "hoje";
  if (d <= soonDays) return "a_chegar";
  return "ok";
}

// ---------- Pipeline: ordenação das tarefas ----------
export const PRIORITY_ORDER = ["urgente", "alta", "normal", "baixa"] as const;
export type Priority = (typeof PRIORITY_ORDER)[number];

/** Ordena por prioridade, depois por prazo (sem prazo no fim) e por fim pela pontuação RICE (maior primeiro). */
export function compareTasks(
  a: { priority: Priority; dueDate: string | null; score: number },
  b: { priority: Priority; dueDate: string | null; score: number },
): number {
  const p = PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority);
  if (p !== 0) return p;
  if (a.dueDate !== b.dueDate) {
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  }
  return b.score - a.score;
}
