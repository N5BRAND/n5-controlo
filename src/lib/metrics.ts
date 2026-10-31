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

/** Estado do prazo de um item do roadmap. Itens em produção estão concluídos. */
export function deadlineStatus(dueDate: string | null, phase: string, now = new Date(), soonDays = DUE_SOON_DAYS): DeadlineStatus {
  if (phase === "producao") return "concluido";
  if (!dueDate) return "sem_prazo";
  const d = daysUntil(dueDate, now);
  if (d < 0) return "atrasado";
  if (d === 0) return "hoje";
  if (d <= soonDays) return "a_chegar";
  return "ok";
}

// ---------------- Monitorização de campanhas ----------------
// Convenção dos nomes dos anúncios: «CLA · N3 · TEMA · /pasta/». O nível de consciência é o N1 a N5;
// a landing page é o endereço no fim (sem endereço, a página principal).

export function awarenessLevel(adName: string): number | null {
  const m = /·\s*N([1-5])\s*·/.exec(adName ?? "");
  return m ? Number(m[1]) : null;
}

export function landingPageOf(adName: string): string {
  const m = /(\/[a-z0-9-]*\/?)\s*$/.exec(adName ?? "");
  const path = m ? m[1] : "/";
  return path.endsWith("/") ? path : `${path}/`;
}

export interface FunnelStep { label: string; n: number }
export interface FunnelRow extends FunnelStep { share: number; fromPrevious: number | null; worst: boolean }

/** Cada passo com a parte do primeiro (para a barra) e do anterior; a maior perda fica marcada. */
export function funnelRows(steps: FunnelStep[]): FunnelRow[] {
  const first = steps[0]?.n ?? 0;
  const rates = steps.map((s, i) => (i === 0 || !steps[i - 1].n ? null : s.n / steps[i - 1].n));
  const valid = rates.filter((r): r is number => r !== null);
  const worst = valid.length ? Math.min(...valid) : null;
  return steps.map((s, i) => ({ ...s, share: first ? s.n / first : 0, fromPrevious: rates[i], worst: worst !== null && rates[i] === worst }));
}

export interface AdTotals { spendCents: number; impressions: number; clicks: number; leads: number; landingViews: number; purchases: number }

/** Soma linhas por uma chave (nível, página, ...), com o número de anúncios distintos. */
export function groupAds<T extends AdTotals & { adName: string }>(rows: T[], key: (r: T) => string): (AdTotals & { key: string; ads: number })[] {
  const map = new Map<string, AdTotals & { key: string; names: Set<string> }>();
  for (const r of rows) {
    const k = key(r);
    const g = map.get(k) ?? { key: k, spendCents: 0, impressions: 0, clicks: 0, leads: 0, landingViews: 0, purchases: 0, names: new Set<string>() };
    g.spendCents += r.spendCents; g.impressions += r.impressions; g.clicks += r.clicks;
    g.leads += r.leads; g.landingViews += r.landingViews; g.purchases += r.purchases; g.names.add(r.adName);
    map.set(k, g);
  }
  return [...map.values()].map(({ names, ...g }) => ({ ...g, ads: names.size }));
}

// ---------------- Monitorização: o site (PostHog) ----------------
const n0 = (v: unknown) => Number(v) || 0;

/** Secções das páginas da Clara (a principal, as landing pages e os testes), pela ordem em que aparecem: cada página
 *  tem só algumas, sempre por esta ordem. «agentes» e «cresce» saíram da página principal a 31/10 e ficam para os
 *  números de antes. E os campos e passos do formulário. */
export const SITE_SECTIONS: [string, string][] = [["inicio", "Topo"], ["video", "Vídeo"], ["promessas", "Promessas"], ["dia", "Um dia com a Clara"], ["agentes", "Os nove agentes"], ["copiloto", "CRM"], ["como", "Exemplos"], ["cenas", "Exemplos"], ["diagnostico", "Diagnóstico"], ["teste", "Teste"], ["saber", "Perguntas"], ["planos", "Planos"], ["mais-info", "Mais informação"], ["cresce", "A carteira vai contigo"], ["passos", "Três passos"], ["lista", "Reserva"], ["mais", "Ver tudo o que a Clara faz"]];
export const FORM_FIELDS: Record<string, string> = { nome: "Nome", email: "Email", telefone: "Telefone", agencia: "Agência", plano: "Plano", indicado_por: "Quem falou da Clara", consentimento: "Autorização de contacto" };
/** Desde 31/10 a inscrição é um ecrã com os dados e outro com o resumo da pré-reserva; «prioridades» só aparece com as
 *  pré-reservas esgotadas (lista de espera). Antes perguntava uma coisa de cada vez, a começar no nome. */
export const FORM_STEPS: [string, string][] = [["dados", "Formulário"], ["enviada", "Inscrição enviada"], ["prioridades", "Prioridades"], ["pre-reserva", "Ecrã da pré-reserva"], ["pagamento", "Abriram o pagamento"], ["paga", "Pagaram"]];
const OLD_STEPS: Record<string, string> = { nome: "dados" };
const PAYMENT_STEPS = new Set(["pagamento", "paga"]);
export const sectionName = (id: string) => SITE_SECTIONS.find(([s]) => s === id)?.[1] ?? id;

/** Ordem das secções de uma página: as conhecidas pela ordem do site, e as outras no fim, pela posição média. */
export function sectionOrder(rows: { seccao: string; posicao?: number | null }[]): [string, string][] {
  const seen = new Set(rows.map((r) => r.seccao));
  const known = SITE_SECTIONS.filter(([id]) => seen.has(id));
  const others = rows.filter((r) => !SITE_SECTIONS.some(([id]) => id === r.seccao))
    .sort((a, b) => (n0(a.posicao) || 99) - (n0(b.posicao) || 99)).map((r): [string, string] => [r.seccao, r.seccao]);
  return [...known, ...others];
}

export interface StepRow { step: string; name: string; reached: number; shareOfStart: number | null; left: number | null; shareLeft: number | null; form: boolean }

/** Passos da inscrição: quantos chegaram, a parte das que começaram e quantos saíram ali. `form` é o que vem antes do pagamento. */
export function stepFunnel(rows: { passo: string; chegaram: number }[]): StepRow[] {
  const by = new Map<string, number>();
  for (const r of rows) { const id = OLD_STEPS[r.passo] ?? r.passo; by.set(id, (by.get(id) ?? 0) + n0(r.chegaram)); }
  const steps = FORM_STEPS.filter(([id]) => id !== "prioridades" || (by.get(id) ?? 0) > 0);
  const start = by.get("dados") ?? 0;
  return steps.map(([id, name], i) => {
    const reached = by.get(id) ?? 0;
    const next = i + 1 < steps.length ? by.get(steps[i + 1][0]) ?? 0 : null;
    const left = next === null ? null : Math.max(0, reached - next);
    return { step: id, name, reached, shareOfStart: start ? reached / start : null, left, shareLeft: reached && left !== null ? left / reached : null, form: !PAYMENT_STEPS.has(id) };
  });
}

export type ConclusionState = "ok" | "aviso" | "mau" | "espera";
export interface Conclusion { topic: string; state: ConclusionState; text: string; action: string }

/** Conclusões sobre a página e os cliques, com o que mudar na comunicação (as mesmas regras do painel da campanha). */
export function siteConclusions(input: {
  metaClicksByDay: { date: string; clicks: number }[];
  funnel: { fonte: string; aberturas: number; qualificadas: number; iniciadas: number; enviadas: number; pagamentos: number; pagas: number }[];
  /** visitas da Meta por dia em todo o site: os cliques da campanha levam a várias páginas */
  days: { dia: string; aberturas_meta: number }[];
  sections: { seccao: string; alcance: number }[];
  errors: { campo: string; vezes: number }[];
  times: { seccao: string; saidas: number; tempo_medio: number }[];
  visit: { visitas: number; tempo_medio: number; tempo_mediano: number } | null;
  steps: StepRow[];
}): Conclusion[] {
  const MIN = 30;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const secs = (v: number) => { const s = Math.round(v); return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`; };
  const t = input.funnel.find((r) => r.fonte === "Todas");
  const visits = n0(t?.aberturas), stay = n0(t?.qualificadas), start = n0(t?.iniciadas), sent = n0(t?.enviadas), pay = n0(t?.pagamentos), paid = n0(t?.pagas);
  const reach = new Map(input.sections.map((r) => [r.seccao, n0(r.alcance)]));
  const out: Conclusion[] = [];

  if (visits < MIN) {
    out.push({ topic: "Página", state: "espera", text: `Há ${visits} visitas medidas na página. As conclusões sobre a página aparecem a partir de ${MIN}.`, action: "Deixar a campanha correr com a página publicada." });
  } else {
    const t6 = stay / visits;
    out.push({ topic: "Primeira impressão", state: t6 >= 0.6 ? "ok" : t6 >= 0.4 ? "aviso" : "mau", text: `${pct(t6)} das visitas ficam pelo menos 6 segundos; ${pct(1 - t6)} saem antes.`,
      action: t6 >= 0.6 ? "O topo confirma o que o anúncio promete: manter o título e o primeiro ecrã." : "O topo não confirma o anúncio: repetir no título a promessa dos anúncios que trazem mais gente e mostrar a Clara logo no primeiro ecrã." });
    // Pelas secções desta página, por ordem. Quem chegou a uma secção mais abaixo também passou pelas de cima
    const order = sectionOrder(input.sections);
    const reached = order.map(([id]) => reach.get(id) ?? 0);
    for (let i = reached.length - 2; i >= 0; i--) reached[i] = Math.max(reached[i], reached[i + 1]);
    let worst: { at: string; next: string; loss: number } | null = null;
    for (let i = 1; i < order.length; i++) {
      const before = reached[i - 1], after = reached[i];
      if (before > 0 && (!worst || (before - after) / before > worst.loss)) worst = { at: order[i - 1][1], next: order[i][1], loss: (before - after) / before };
    }
    if (worst) out.push({ topic: "Onde param", state: worst.loss >= 0.35 ? "aviso" : "ok", text: `A maior perda é em «${worst.at}»: ${pct(worst.loss)} de quem lá chega não passa para «${worst.next}».`,
      action: worst.loss >= 0.35 ? `Encurtar «${worst.at}» ou mudar a mensagem dessa parte, e pôr antes dela um botão para a reserva.` : "Nenhuma secção trava muita gente: a ordem da página funciona." });
    if (stay >= MIN) {
      const ti = start / stay, list = reach.get("lista") ?? 0;
      out.push({ topic: "Interesse", state: ti >= 0.12 ? "ok" : ti >= 0.05 ? "aviso" : "mau", text: `${pct(ti)} de quem fica começa a inscrição; ${pct(list)} das visitas chegam ao formulário.`,
        action: ti >= 0.12 ? "A oferta convence: manter." : list < 0.3 ? "Pouca gente chega ao formulário, no fim da página: pôr um botão para a reserva no topo e a meio." : "Chegam ao formulário mas não começam: deixar mais claro o que ganham ao reservar e encurtar o formulário." });
    }
  }
  if (start >= 10) {
    const te = sent / start, top = input.errors[0];
    const field = top ? FORM_FIELDS[top.campo] ?? top.campo : null;
    out.push({ topic: "Formulário", state: te >= 0.75 ? "ok" : te >= 0.5 ? "aviso" : "mau", text: `${pct(te)} de quem começa a inscrição envia-a.${field ? ` O campo que mais falha é «${field}» (${n0(top!.vezes)} vezes).` : ""}`,
      action: te >= 0.75 ? "O formulário não trava ninguém." : `O formulário trava gente: tirar os campos que não fazem falta para a primeira chamada${field ? ` e explicar melhor «${field}».` : "."}` });
  }
  if (pay >= 5) {
    const tp = paid / pay;
    out.push({ topic: "Pagamento", state: tp >= 0.5 ? "ok" : tp >= 0.3 ? "aviso" : "mau", text: `${pct(tp)} de quem abre o pagamento paga a pré-reserva.`,
      action: tp >= 0.5 ? "O pagamento corre bem." : "Muitos abrem o pagamento e não pagam: repetir na página de pagamento o que estão a pagar e o que acontece a seguir." });
  }
  const v = input.visit;
  if (v && n0(v.visitas) >= MIN) {
    const med = n0(v.tempo_mediano);
    out.push({ topic: "Tempo na página", state: med >= 45 ? "ok" : med >= 20 ? "aviso" : "mau", text: `Metade das visitas fica menos de ${secs(med)} com a página à vista; a média é ${secs(n0(v.tempo_medio))}.`,
      action: med >= 45 ? "Há tempo para ler: o que falta está mais abaixo (interesse, formulário)." : "Pouca gente lê além do topo: o primeiro ecrã tem de dizer logo o que a Clara faz, para quem é e levar ao botão da reserva." });
    const total = input.times.reduce((s, r) => s + n0(r.saidas), 0);
    const top = [...input.times].sort((a, b) => n0(b.saidas) - n0(a.saidas))[0];
    if (top && total > 0) {
      const name = sectionName(top.seccao), share = n0(top.saidas) / total;
      out.push({ topic: "Onde saem", state: top.seccao === "lista" ? "ok" : share >= 0.4 ? "mau" : "aviso", text: `A secção onde mais gente sai da página é «${name}»: ${pct(share)} das saídas, com ${secs(n0(top.tempo_medio))} à vista em média.`,
        action: top.seccao === "lista" ? "Saem no fim, depois de ver tudo: o que conta é o formulário e o pagamento." : top.seccao === "inicio" ? "Saem logo no topo: o anúncio e o primeiro ecrã não estão a dizer a mesma coisa." : `Rever «${name}»: é aí que a página perde mais gente. Encurtar ou trocar a mensagem dessa parte.` });
    }
  }
  // Os passos antes do pagamento (o pagamento tem a sua conclusão)
  const form = input.steps.filter((p) => p.form && p.reached >= 5 && p.shareLeft !== null);
  if ((input.steps[0]?.reached ?? 0) >= 10 && form.length) {
    const worst = [...form].sort((a, b) => (b.shareLeft ?? 0) - (a.shareLeft ?? 0))[0];
    const sl = worst.shareLeft ?? 0;
    const fix: Record<string, string> = {
      dados: "O formulário trava gente: tirar o que não faz falta para a primeira chamada e explicar porque se pede cada campo.",
      enviada: "Enviam a inscrição e não chegam ao ecrã seguinte: confirmar que o ecrã da pré-reserva aparece depois de enviar.",
      "pre-reserva": "Veem o resumo da pré-reserva e não abrem o pagamento: deixar mais claro o que pagam agora e o que recebem.",
    };
    out.push({ topic: "Inscrição", state: sl >= 0.3 ? "mau" : sl >= 0.15 ? "aviso" : "ok", text: `O passo onde mais gente desiste é «${worst.name}»: ${pct(sl)} de quem lá chega não continua (${worst.left} de ${worst.reached}).`,
      action: sl >= 0.15 ? fix[worst.step] ?? `Simplificar o passo «${worst.name}»: explicar porque se pede, ou torná-lo opcional.` : "A inscrição não trava ninguém." });
  }
  // Cliques da Meta contra visitas da Meta, só nos dias medidos inteiros (a partir do segundo)
  const first = input.days[0]?.dia ?? null;
  const measured = new Map(input.days.filter((r) => first && r.dia > first).map((r) => [r.dia, n0(r.aberturas_meta)]));
  const clicks = input.metaClicksByDay.filter((r) => measured.has(r.date.slice(0, 10))).reduce((s, r) => s + n0(r.clicks), 0);
  const arrived = [...measured.values()].reduce((s, x) => s + x, 0);
  if (clicks >= MIN) {
    const r = arrived / clicks;
    out.push({ topic: "Cliques da Meta", state: r >= 0.6 ? "ok" : r >= 0.35 ? "aviso" : "mau", text: `Nos dias medidos inteiros, ${clicks} cliques deram ${arrived} visitas medidas no site (${pct(r)}).`,
      action: r >= 0.6 ? "Os cliques são de pessoas que chegam à página." : "Muitos cliques não chegam a visita: acidentais, de robôs ou de quem não respondeu ao aviso de cookies. Ver na tabela os anúncios com CTR alto e poucas leads e tirar o Audience Network dos posicionamentos." });
  } else {
    out.push({ topic: "Cliques da Meta", state: "espera", text: `Há ${clicks} cliques da Meta em dias inteiros medidos no site. A comparação com as visitas aparece a partir de ${MIN}.`, action: "Esperar pelo primeiro dia inteiro com a página publicada." });
  }
  const weight: Record<ConclusionState, number> = { mau: 0, aviso: 1, espera: 2, ok: 3 };
  return out.sort((a, b) => weight[a.state] - weight[b.state]);
}

/** Referência de um anúncio para juntar o utm_content da inscrição ao nome do anúncio na Meta:
 *  «CLA · N3 · LISTA-FSBO · /angariacao/» e «cla_n3_lista-fsbo» dão os dois «cla_n3_lista_fsbo». */
export type AdCreativeLinks = {
  url_tags?: string;
  object_story_spec?: { link_data?: { link?: string }; video_data?: { call_to_action?: { value?: { link?: string } } } };
  asset_feed_spec?: { link_urls?: { website_url?: string; url_tags?: string }[] };
};

/** O utm_content da ligação de um anúncio (parâmetros de URL, ligação do criativo ou do conjunto de recursos), ou null. */
export function utmContentOf(creative: AdCreativeLinks | null | undefined): string | null {
  if (!creative) return null;
  const candidates = [
    creative.url_tags,
    creative.object_story_spec?.link_data?.link,
    creative.object_story_spec?.video_data?.call_to_action?.value?.link,
    ...(creative.asset_feed_spec?.link_urls ?? []).flatMap((l) => [l.url_tags, l.website_url]),
  ];
  for (const c of candidates) {
    if (!c) continue;
    const query = c.includes("?") ? c.slice(c.indexOf("?") + 1) : c;
    const value = new URLSearchParams(query.split("#")[0]).get("utm_content");
    if (value && !value.includes("{{")) return value;
  }
  return null;
}

export function adRef(value: string | null | undefined): string {
  const parts = String(value ?? "").split("·").map((p) => p.trim()).filter((p) => p && !p.startsWith("/"));
  return parts.join("_").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
