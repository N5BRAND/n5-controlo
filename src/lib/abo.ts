// Orçamentos ABO das campanhas da Meta. Regra do Pedro (31/10/2026): até 1000 € por mês, orçamento em cada conjunto de
// anúncios, um criativo por conjunto; acima disso, CBO. Duas análises por dia:
//   manhã (08:00): com o dia anterior completo, troca o criativo que falha pelo seguinte da fila, passa 20% do orçamento
//                  do pior para o melhor e repõe o total do dia da campanha, com 3 a 10 € por conjunto;
//   noite (20:00): só corta (meio dia de dados engana) e troca os anúncios reprovados pela Meta.
// Funções puras: decidem sem tocar em nada; a aplicação na Meta recebe o fetch por parâmetro. Valores em cêntimos,
// como na Marketing API. Testes em tests/abo.test.ts.

export type Moment = "manha" | "noite";
export type AboMetric = "compras" | "leads" | "visitas" | "cliques";
export type AboAction = "manter" | "subir" | "descer" | "pausar" | "aviso";

export const ABO_RULES = {
  minCents: 300, maxCents: 1000, entryCents: 500, step: 0.2,
  evaluateFromCents: 800, pauseFromCents: 1500, timesAverage: 2, nightSpendCents: 400, monthlyCboEur: 1000,
};
export type AboRules = typeof ABO_RULES;

export interface AdNumbers {
  spendCents: number; clicks: number; landingViews: number; leads: number; purchases: number;
  spendTodayCents: number; landingViewsToday: number;
}
export interface AboAd {
  id: string; name: string; level: number | null; creativeId: string | null; adsetId: string;
  status: string; effectiveStatus: string;
}
export interface AboAdset { id: string; name: string; budgetCents: number; ads: AboAd[] }
export interface QueuedAd { name: string; level: number | null; creativeId: string }
export interface AboDecision {
  adsetId: string | null; adsetName: string | null; adId: string | null; adName: string | null;
  action: AboAction; fromCents: number | null; toCents: number | null; metric: AboMetric | null;
  costCents: number | null; reason: string; incoming: QueuedAd | null;
  applied?: boolean; errorCode?: string | null;
}

// Dados como vêm da Marketing API
export interface MetaAdset { id: string; name?: string; status?: string; daily_budget?: string }
export interface MetaAd { id: string; name?: string; status?: string; effective_status?: string; adset_id?: string; creative?: { id?: string } }

const ID = /^[0-9]{5,30}$/;
const METRIC_LABEL: Record<AboMetric, [string, string]> = {
  compras: ["pré-reserva paga", "pré-reservas pagas"], leads: ["inscrição", "inscrições"],
  visitas: ["visita", "visitas"], cliques: ["clique", "cliques"],
};
const ZERO: AdNumbers = { spendCents: 0, clicks: 0, landingViews: 0, leads: 0, purchases: 0, spendTodayCents: 0, landingViewsToday: 0 };
const metricKey: Record<AboMetric, keyof AdNumbers> = { compras: "purchases", leads: "leads", visitas: "landingViews", cliques: "clicks" };

export const eurText = (cents: number) => (Math.round(cents) / 100).toFixed(2).replace(".", ",") + " €";
const halfEuroDown = (cents: number) => Math.floor(Math.max(0, cents) / 50) * 50;

/** O nível de consciência vem do nome do anúncio («CLA · N3 · VOZ»). */
export const levelFromName = (name: string | null | undefined) => {
  const m = /·\s*N([1-5])\s*·/.exec(String(name ?? ""));
  return m ? Number(m[1]) : null;
};

/** O passo mais avançado com dados que cheguem para comparar: pré-reservas pagas, inscrições, visitas e, por fim, cliques. */
export function pickMetric(t: AdNumbers): AboMetric {
  if (t.purchases >= 3) return "compras";
  if (t.leads >= 5) return "leads";
  if (t.landingViews >= 5) return "visitas";
  return "cliques";
}

export const costPer = (n: AdNumbers, m: AboMetric) => (n[metricKey[m]] > 0 ? n.spendCents / n[metricKey[m]] : Infinity);

/** Do melhor para o pior: custo por resultado mais baixo primeiro; sem resultados, quem gastou menos fica à frente. */
export function compareByCost(a: AdNumbers, b: AdNumbers, m: AboMetric) {
  const ca = costPer(a, m);
  const cb = costPer(b, m);
  if (ca === cb) return a.spendCents - b.spendCents;
  return ca < cb ? -1 : 1;
}

const costText = (n: AdNumbers, m: AboMetric) =>
  n[metricKey[m]] > 0 ? `${eurText(n.spendCents / n[metricKey[m]])} por ${METRIC_LABEL[m][0]}` : `sem ${METRIC_LABEL[m][1]}`;

/**
 * Os conjuntos ativos com orçamento diário (ABO) e os anúncios de cada um. A fila são os anúncios pausados cujo criativo
 * (pelo nome) não está ativo em nenhum conjunto nem foi tirado pelas regras, um por nome, por nível.
 */
export function buildStructure(adsetsMeta: MetaAdset[], adsMeta: MetaAd[], removed: Set<string> = new Set()) {
  const ads: AboAd[] = adsMeta.filter((a) => ID.test(String(a.id ?? ""))).map((a) => ({
    id: String(a.id), name: String(a.name || a.id), level: levelFromName(a.name), adsetId: String(a.adset_id ?? ""),
    creativeId: ID.test(String(a.creative?.id ?? "")) ? String(a.creative!.id) : null,
    status: String(a.status ?? ""), effectiveStatus: String(a.effective_status ?? ""),
  }));
  const adsets: AboAdset[] = adsetsMeta
    .filter((s) => ID.test(String(s.id ?? "")) && s.status === "ACTIVE" && Number(s.daily_budget) > 0)
    .map((s) => ({ id: String(s.id), name: String(s.name || s.id), budgetCents: Math.round(Number(s.daily_budget)), ads: ads.filter((a) => a.adsetId === String(s.id)) }));
  const active = new Set(adsets.flatMap((s) => s.ads.filter((a) => a.status === "ACTIVE").map((a) => a.name)));
  const seen = new Set<string>();
  const queue: QueuedAd[] = ads
    .filter((a) => a.status === "PAUSED" && a.creativeId && !active.has(a.name) && !removed.has(a.name))
    .sort((a, b) => (a.level ?? 9) - (b.level ?? 9) || a.name.localeCompare(b.name))
    .filter((a) => !seen.has(a.name) && !!seen.add(a.name))
    .map((a) => ({ name: a.name, level: a.level, creativeId: a.creativeId! }));
  const cbo = adsetsMeta.some((s) => s.status === "ACTIVE" && !(Number(s.daily_budget) > 0));
  return { adsets, queue, cbo };
}

interface Slot {
  adset: AboAdset; activeAds: AboAd[]; ad: AboAd; n: AdNumbers;
  from: number; to: number; action: AboAction; reason: string; incoming: QueuedAd | null;
}

/**
 * Decide sem tocar em nada. numbers: números de cada anúncio (pelo id) desde que a campanha passou a ABO.
 * Devolve uma decisão por conjunto e, se for caso disso, um aviso.
 */
export function decideBudgets(input: {
  moment: Moment; adsets: AboAdset[]; numbers: Map<string, AdNumbers>; queue?: QueuedAd[];
  dailyBudgetCents: number; rules?: AboRules;
}): { decisions: AboDecision[]; metric: AboMetric } {
  const R = input.rules ?? ABO_RULES;
  const slots: Slot[] = [];
  for (const adset of input.adsets) {
    const activeAds = adset.ads.filter((a) => a.status === "ACTIVE");
    if (!activeAds.length) continue;
    const n = { ...ZERO };
    for (const a of activeAds) {
      const x = input.numbers.get(a.id);
      if (x) for (const k of Object.keys(ZERO) as (keyof AdNumbers)[]) n[k] += x[k] || 0;
    }
    slots.push({ adset, activeAds, ad: activeAds[0], n, from: adset.budgetCents, to: adset.budgetCents, action: "manter", reason: "", incoming: null });
  }
  const total = { ...ZERO };
  for (const s of slots) for (const k of Object.keys(ZERO) as (keyof AdNumbers)[]) total[k] += s.n[k];
  const metric = pickMetric(total);
  const avgPerView = total.landingViews > 0 ? total.spendCents / total.landingViews : null;
  const free = [...(input.queue ?? [])];
  const takeFromQueue = (level: number | null) => {
    if (!free.length) return null;
    const i = free.findIndex((f) => f.level === level);
    return free.splice(i < 0 ? 0 : i, 1)[0];
  };

  // 1. Trocas: o anúncio reprovado pela Meta (manhã e noite) e, de manhã, o que gastou muito sem inscrições e com visitas
  //    caras. Entra o seguinte da fila do mesmo nível (ou o primeiro), com o orçamento de entrada.
  for (const s of slots) {
    const rejected = s.activeAds.some((a) => a.effectiveStatus === "DISAPPROVED");
    const perView = s.n.landingViews > 0 ? s.n.spendCents / s.n.landingViews : Infinity;
    const failed = input.moment === "manha" && s.n.spendCents >= R.pauseFromCents && s.n.leads === 0 && s.n.purchases === 0
      && avgPerView !== null && perView >= R.timesAverage * avgPerView;
    if (!rejected && !failed) continue;
    s.action = "pausar";
    s.incoming = takeFromQueue(s.ad.level);
    s.to = s.incoming ? R.entryCents : 0;
    const why = rejected ? "A Meta reprovou o anúncio."
      : s.n.landingViews === 0 ? `Gastou ${eurText(s.n.spendCents)} sem inscrições nem visitas.`
        : `Gastou ${eurText(s.n.spendCents)} sem inscrições e cada visita custa ${eurText(perView)} (${(perView / avgPerView!).toFixed(1).replace(".", ",")}× a média).`;
    s.reason = why + (s.incoming ? ` Entra «${s.incoming.name}» com ${eurText(R.entryCents)}.` : " A fila está vazia: o conjunto pára.");
  }

  if (input.moment === "manha") {
    // 2. 20% do orçamento passa do pior para o melhor, entre os que já gastaram o suficiente para se avaliar.
    const rated = slots.filter((s) => s.action === "manter" && s.n.spendCents >= R.evaluateFromCents)
      .sort((a, b) => compareByCost(a.n, b.n, metric));
    if (rated.length >= 2) {
      const best = rated[0];
      const worst = rated[rated.length - 1];
      const t = halfEuroDown(Math.min(R.step * best.to, R.step * worst.to, worst.to - R.minCents, R.maxCents - best.to));
      if (compareByCost(best.n, worst.n, metric) < 0 && t >= 50) {
        best.to += t;
        worst.to -= t;
        best.action = "subir";
        worst.action = "descer";
        best.reason = `O melhor custo (${costText(best.n, metric)}): ganha ${eurText(t)} do pior.`;
        worst.reason = `O pior custo (${costText(worst.n, metric)}): passa ${eurText(t)} ao melhor.`;
      }
    }
    // 3. O total do dia volta ao orçamento da campanha, com 3 a 10 € por conjunto. O que sobra sai de quem tem mais
    //    (nunca do criativo que acabou de entrar); o que falta vai para os melhores.
    const alive = slots.filter((s) => s.to > 0);
    const order = [...alive].sort((a, b) => {
      const ra = a.n.spendCents >= R.evaluateFromCents && !a.incoming;
      const rb = b.n.spendCents >= R.evaluateFromCents && !b.incoming;
      if (ra !== rb) return ra ? -1 : 1;
      return ra ? compareByCost(a.n, b.n, metric) : a.to - b.to;
    });
    for (const s of alive) s.to = Math.min(R.maxCents, Math.max(R.minCents, s.to));
    let sum = alive.reduce((v, s) => v + s.to, 0);
    while (sum > input.dailyBudgetCents) {
      const s = alive.filter((x) => !x.incoming && x.to > R.minCents).sort((a, b) => b.to - a.to)[0];
      if (!s) break;
      const t = Math.min(50, sum - input.dailyBudgetCents, s.to - R.minCents);
      s.to -= t;
      sum -= t;
    }
    while (sum < input.dailyBudgetCents) {
      const s = order.find((x) => x.to < R.maxCents);
      if (!s) break;
      const t = Math.min(50, input.dailyBudgetCents - sum, R.maxCents - s.to);
      s.to += t;
      sum += t;
    }
    for (const s of alive) {
      if (s.action === "manter" && s.to !== s.from) {
        s.action = s.to > s.from ? "subir" : "descer";
        s.reason = `Acerta o total do dia para ${eurText(input.dailyBudgetCents)}.`;
      } else if ((s.action === "subir" || s.action === "descer") && s.to === s.from) {
        s.action = "manter";
        s.reason += " Fica igual depois de acertar o total do dia.";
      }
    }
  } else {
    // Noite: só corta quem gastou hoje sem trazer visitas.
    for (const s of slots) {
      if (s.action !== "manter" || s.n.spendTodayCents < R.nightSpendCents || s.n.landingViewsToday > 0) continue;
      const to = Math.max(R.minCents, s.to - Math.max(50, halfEuroDown(R.step * s.to)));
      if (to < s.to) {
        s.to = to;
        s.action = "descer";
        s.reason = `Hoje gastou ${eurText(s.n.spendTodayCents)} sem visitas: desce até à análise da manhã.`;
      }
    }
  }

  for (const s of slots) {
    if (s.action !== "manter" || s.reason) continue;
    s.reason = s.n.spendCents < R.evaluateFromCents
      ? `Ainda só gastou ${eurText(s.n.spendCents)} (avalia-se a partir de ${eurText(R.evaluateFromCents)}).`
      : `Fica como está (${costText(s.n, metric)}).`;
  }
  const decisions: AboDecision[] = slots.map((s) => {
    const c = costPer(s.n, metric);
    return {
      adsetId: s.adset.id, adsetName: s.adset.name, adId: s.ad.id, adName: s.ad.name, action: s.action,
      fromCents: s.from, toCents: s.to, metric, costCents: Number.isFinite(c) ? Math.round(c) : null,
      reason: s.reason, incoming: s.incoming,
    };
  });
  if ((input.dailyBudgetCents * 30.4) / 100 > R.monthlyCboEur) {
    decisions.push(notice(`O orçamento passa de ${R.monthlyCboEur} € por mês: pela regra, a campanha passa a CBO.`, metric));
  }
  return { decisions, metric };
}

export const notice = (reason: string, metric: AboMetric | null = null): AboDecision => ({
  adsetId: null, adsetName: null, adId: null, adName: null, action: "aviso", fromCents: null, toCents: null,
  metric, costCents: null, reason, incoming: null,
});

// ---------- Marketing API ----------

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;
const GRAPH = "https://graph.facebook.com/";

/** Código curto do erro da Marketing API, sem a mensagem (que pode trazer dados da conta). */
export function metaErrorCode(error: { code?: number } | null | undefined, status: number) {
  const c = Number(error?.code);
  if (c === 190 || status === 401) return "meta_token_invalido";
  if (c === 10 || (c >= 200 && c < 300) || status === 403) return "meta_sem_permissao";
  if ([4, 17, 32, 613, 80000, 80004].includes(c)) return "meta_limite";
  if (c === 100) return "meta_pedido_invalido";
  return "meta_erro";
}

export class MetaError extends Error {
  constructor(public code: string) { super(`Marketing API: ${code}`); }
}

async function metaJson(res: Response) {
  const json = (await res.json().catch(() => null)) as { error?: { code?: number }; data?: unknown[]; paging?: { next?: string } } | null;
  if (!res.ok || !json || json.error) throw new MetaError(metaErrorCode(json?.error, res.status));
  return json;
}

/** Leitura com o token no cabeçalho (nunca no endereço), página a página. */
export async function metaGetAll<T>(fetchFn: FetchFn, path: string, params: Record<string, string>, token: string, version = "v23.0") {
  const out: T[] = [];
  let url: string | null = `${GRAPH}${version}/${path}?${new URLSearchParams(params)}`;
  for (let i = 0; url && i < 50; i++) {
    let res: Response;
    try { res = await fetchFn(url, { headers: { authorization: `Bearer ${token}` } }); } catch { throw new MetaError("meta_rede"); }
    const json = await metaJson(res);
    out.push(...((json.data ?? []) as T[]));
    const next: string | undefined = json.paging?.next;
    url = next && next.startsWith(GRAPH) ? next : null;
  }
  return out;
}

export async function metaPost(fetchFn: FetchFn, path: string, fields: Record<string, string>, token: string, version = "v23.0") {
  let res: Response;
  try {
    res = await fetchFn(`${GRAPH}${version}/${path}`, {
      method: "POST", body: new URLSearchParams(fields),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/x-www-form-urlencoded" },
    });
  } catch { throw new MetaError("meta_rede"); }
  return metaJson(res);
}

/** O token de gestão só se usa se tiver ads_management. */
export async function canManage(fetchFn: FetchFn, token: string, version = "v23.0"): Promise<{ ok: boolean; code?: string }> {
  try {
    const perms = await metaGetAll<{ permission: string; status: string }>(fetchFn, "me/permissions", {}, token, version);
    return perms.some((p) => p.permission === "ads_management" && p.status === "granted") ? { ok: true } : { ok: false, code: "gestao_sem_permissao" };
  } catch (err) {
    return { ok: false, code: err instanceof MetaError ? err.code : "meta_erro" };
  }
}

/** Pausas e trocas primeiro, depois as descidas e só no fim as subidas: o total do dia nunca passa o da campanha a meio. */
export async function applyDecisions(fetchFn: FetchFn, account: string, decisions: AboDecision[], token: string, version = "v23.0") {
  const rank: Partial<Record<AboAction, number>> = { pausar: 0, descer: 1, subir: 2 };
  for (const d of [...decisions].filter((x) => rank[x.action] !== undefined).sort((a, b) => rank[a.action]! - rank[b.action]!)) {
    try {
      if (d.action === "pausar") {
        await metaPost(fetchFn, d.adId!, { status: "PAUSED" }, token, version);
        if (d.incoming) {
          await metaPost(fetchFn, `${account}/ads`, {
            name: d.incoming.name, adset_id: d.adsetId!, creative: JSON.stringify({ creative_id: d.incoming.creativeId }), status: "ACTIVE",
          }, token, version);
          await metaPost(fetchFn, d.adsetId!, { daily_budget: String(d.toCents) }, token, version);
        } else {
          await metaPost(fetchFn, d.adsetId!, { status: "PAUSED" }, token, version);
        }
      } else {
        await metaPost(fetchFn, d.adsetId!, { daily_budget: String(d.toCents) }, token, version);
      }
      d.applied = true;
      d.errorCode = null;
    } catch (err) {
      d.applied = false;
      d.errorCode = err instanceof MetaError ? err.code : "meta_erro";
    }
  }
}
