import "server-only";
import { cache } from "react";
import { and, desc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { CurrentUser } from "./auth";
import type { Range } from "./filters";
import { cacCents, mrrMovements, monthKey, previousMonthKey, riceScore, type MrrMap } from "./metrics";

export const usdEurRate = () => Number(process.env.USD_EUR_RATE ?? "0.87");

// Os softwares mudam pouco e quase todas as páginas os pedem: uma leitura por pedido.
const allSoftwares = cache(() => db.select().from(schema.softwares).orderBy(schema.softwares.createdAt));

export async function softwaresFor(user: CurrentUser) {
  const all = await allSoftwares();
  return user.softwareIds === "all" ? all : all.filter((s) => (user.softwareIds as string[]).includes(s.id));
}

const ACTIVE = ["active", "past_due"] as const;

// ---------------- Painel geral ----------------
export async function overview(range: Range) {
  const thisMonth = monthKey(new Date()), lastMonth = previousMonthKey(thisMonth);

  const spendRows = (from: Date, to: Date) => db.select({ sw: schema.campaignDaily.softwareId, spend: sql<number>`sum(${schema.campaignDaily.spendCents})::int` })
    .from(schema.campaignDaily)
    .where(and(gte(schema.campaignDaily.date, from.toISOString().slice(0, 10)), lt(schema.campaignDaily.date, to.toISOString().slice(0, 10))))
    .groupBy(schema.campaignDaily.softwareId);
  const since30 = new Date(Date.now() - 30 * 864e5);

  // Leituras independentes em paralelo: o tempo da página passa a ser o da mais lenta, não a soma.
  const [sws, subs, mrrPrev, spendNow, spendPrev, firstPaid, costs, fb, rel, al] = await Promise.all([
    allSoftwares(),
    db.select().from(schema.subscriptions),
    db.select({ sw: schema.mrrMonthly.softwareId, total: sql<number>`sum(${schema.mrrMonthly.mrrCents})::int` })
      .from(schema.mrrMonthly).where(eq(schema.mrrMonthly.month, lastMonth)).groupBy(schema.mrrMonthly.softwareId),
    spendRows(range.from, new Date(range.to.getTime() + 864e5)),
    spendRows(range.prevFrom, range.prevTo),
    // Novos clientes pagantes = primeira fatura paga dentro do período
    db.select({ sw: schema.invoices.softwareId, org: schema.invoices.organizationId, first: sql<Date>`min(${schema.invoices.issuedAt})` })
      .from(schema.invoices).where(eq(schema.invoices.status, "paid")).groupBy(schema.invoices.softwareId, schema.invoices.organizationId),
    db.select({ sw: schema.usageRecords.softwareId, usd: sql<number>`sum(${schema.usageRecords.costUsd})::float` })
      .from(schema.usageRecords).where(gte(schema.usageRecords.occurredAt, since30)).groupBy(schema.usageRecords.softwareId),
    db.select({ sw: schema.feedback.softwareId, type: schema.feedback.type, severity: schema.feedback.severity, n: sql<number>`count(*)::int` })
      .from(schema.feedback).where(sql`${schema.feedback.status} not in ('lancado','recusado','duplicado')`)
      .groupBy(schema.feedback.softwareId, schema.feedback.type, schema.feedback.severity),
    db.select().from(schema.releases).orderBy(desc(schema.releases.createdAt)),
    db.select({ sw: schema.alerts.softwareId, sev: schema.alerts.severity, n: sql<number>`count(*)::int` })
      .from(schema.alerts).where(ne(schema.alerts.status, "resolvido")).groupBy(schema.alerts.softwareId, schema.alerts.severity),
  ]);
  const newPaying = (sw: string, from: Date, to: Date) => firstPaid.filter((f) => f.sw === sw && new Date(f.first) >= from && new Date(f.first) < to).length;

  const rows = sws.map((sw) => {
    const mine = subs.filter((s) => s.softwareId === sw.id);
    const mrr = mine.filter((s) => (ACTIVE as readonly string[]).includes(s.status)).reduce((a, s) => a + s.mrrCents, 0);
    const paying = new Set(mine.filter((s) => (ACTIVE as readonly string[]).includes(s.status)).map((s) => s.organizationId)).size;
    const trials = mine.filter((s) => s.status === "trialing").length;
    const spend = spendNow.find((r) => r.sw === sw.id)?.spend ?? 0;
    const newP = newPaying(sw.id, range.from, new Date(range.to.getTime() + 1));
    const costCents = Math.round((costs.find((c) => c.sw === sw.id)?.usd ?? 0) * usdEurRate() * 100);
    const myFb = fb.filter((f) => f.sw === sw.id);
    const next = rel.find((r) => r.softwareId === sw.id && !r.publishedAt) ?? rel.find((r) => r.softwareId === sw.id);
    return {
      sw, mrr, mrrPrev: mrrPrev.find((m) => m.sw === sw.id)?.total ?? null, paying, trials, spend,
      spendPrev: spendPrev.find((r) => r.sw === sw.id)?.spend ?? 0, newPaying: newP,
      newPayingPrev: newPaying(sw.id, range.prevFrom, range.prevTo),
      cac: cacCents(spend, newP), margin: mrr > 0 ? (mrr - costCents) / mrr : null, cost30: costCents,
      feedbackOpen: myFb.reduce((a, f) => a + f.n, 0),
      criticalBugs: myFb.filter((f) => f.type === "bug" && f.severity === "critico").reduce((a, f) => a + f.n, 0),
      nextRelease: next ? { version: next.version, published: !!next.publishedAt } : null,
      alerts: {
        critico: al.find((a) => a.sw === sw.id && a.sev === "critico")?.n ?? 0,
        aviso: al.find((a) => a.sw === sw.id && a.sev === "aviso")?.n ?? 0,
      },
    };
  });
  const totals = {
    mrr: rows.reduce((a, r) => a + r.mrr, 0),
    mrrPrev: rows.every((r) => r.mrrPrev === null) ? null : rows.reduce((a, r) => a + (r.mrrPrev ?? 0), 0),
    paying: rows.reduce((a, r) => a + r.paying, 0),
    trials: rows.reduce((a, r) => a + r.trials, 0),
    spend: rows.reduce((a, r) => a + r.spend, 0),
    spendPrev: rows.reduce((a, r) => a + r.spendPrev, 0),
    newPaying: rows.reduce((a, r) => a + r.newPaying, 0),
    cost30: rows.reduce((a, r) => a + r.cost30, 0),
    criticalAlerts: al.filter((a) => a.sev === "critico").reduce((x, a) => x + a.n, 0),
  };
  return { rows, totals: { ...totals, arr: totals.mrr * 12, cac: cacCents(totals.spend, totals.newPaying), margin: totals.mrr > 0 ? (totals.mrr - totals.cost30) / totals.mrr : null } };
}

// ---------------- Comunidades ----------------
export async function communityStats(softwareIds: string[], range: Range) {
  if (!softwareIds.length) return null;
  const members = await db.select({ origin: schema.persons.origin, n: sql<number>`count(*)::int` })
    .from(schema.persons).where(inArray(schema.persons.softwareId, softwareIds)).groupBy(schema.persons.origin);
  const fbs = await db.select().from(schema.feedback)
    .where(and(inArray(schema.feedback.softwareId, softwareIds), gte(schema.feedback.createdAt, range.from)));
  const responded = fbs.filter((f) => f.firstResponseAt);
  const avgResponseH = responded.length
    ? responded.reduce((a, f) => a + (f.firstResponseAt!.getTime() - f.createdAt.getTime()) / 36e5, 0) / responded.length : null;
  const closed = fbs.filter((f) => ["lancado", "recusado", "duplicado"].includes(f.status)).length;
  const byType = { sugestao: 0, bug: 0, funciona_bem: 0, funciona_mal: 0 } as Record<string, number>;
  for (const f of fbs) byType[f.type]++;
  const positives = byType.funciona_bem, negatives = byType.funciona_mal + byType.bug;
  return {
    members: Object.fromEntries(members.map((m) => [m.origin, m.n])) as Record<string, number>,
    feedbackCount: fbs.length, byType, avgResponseH,
    closeRate: fbs.length ? closed / fbs.length : null,
    sentiment: positives + negatives > 0 ? (positives - negatives) / (positives + negatives) : null,
  };
}

export async function listFeedback(softwareIds: string[], f: { status?: string; type?: string; q?: string }) {
  if (!softwareIds.length) return [];
  const conds = [inArray(schema.feedback.softwareId, softwareIds)];
  if (f.status === "abertos") conds.push(sql`${schema.feedback.status} not in ('lancado','recusado','duplicado')`);
  else if (f.status) conds.push(eq(schema.feedback.status, f.status as typeof schema.feedback.$inferSelect.status));
  if (f.type) conds.push(eq(schema.feedback.type, f.type as typeof schema.feedback.$inferSelect.type));
  if (f.q) conds.push(sql`(${schema.feedback.title} ilike ${"%" + f.q + "%"} or ${schema.feedback.text} ilike ${"%" + f.q + "%"})`);
  return db.select({ f: schema.feedback, owner: schema.users.name })
    .from(schema.feedback).leftJoin(schema.users, eq(schema.users.id, schema.feedback.ownerUserId))
    .where(and(...conds)).orderBy(desc(schema.feedback.votes), desc(schema.feedback.createdAt)).limit(300);
}

// ---------------- Pipeline ----------------
export async function roadmap(softwareIds: string[]) {
  if (!softwareIds.length) return [];
  const items = await db.select({ i: schema.roadmapItems, owner: schema.users.name })
    .from(schema.roadmapItems).leftJoin(schema.users, eq(schema.users.id, schema.roadmapItems.ownerUserId))
    .where(inArray(schema.roadmapItems.softwareId, softwareIds));
  const votes = await db.select({ item: schema.feedback.roadmapItemId, v: sql<number>`sum(${schema.feedback.votes})::int` })
    .from(schema.feedback).where(sql`${schema.feedback.roadmapItemId} is not null`).groupBy(schema.feedback.roadmapItemId);
  return items.map(({ i, owner }) => ({
    ...i, owner, score: riceScore(i.reach, i.impact, i.confidence, i.effort),
    communityVotes: votes.find((v) => v.item === i.id)?.v ?? 0,
  })).sort((a, b) => b.score - a.score);
}

export async function delivery(softwareIds: string[], range: Range) {
  if (!softwareIds.length) return null;
  const deps = await db.select().from(schema.deployments)
    .where(and(inArray(schema.deployments.softwareId, softwareIds), gte(schema.deployments.createdAt, range.from)))
    .orderBy(schema.deployments.createdAt);
  const prod = deps.filter((d) => d.environment.startsWith("prod") && d.status !== "pending");
  const failures = prod.filter((d) => d.status !== "success");
  const weeks = Math.max(1, (range.to.getTime() - range.from.getTime()) / (7 * 864e5));
  // Tempo de recuperação: de uma falha até ao próximo deploy de produção com sucesso
  const recoveries: number[] = [];
  for (const f of failures) {
    const next = prod.find((d) => d.status === "success" && d.createdAt > f.createdAt);
    if (next) recoveries.push((next.createdAt.getTime() - f.createdAt.getTime()) / 36e5);
  }
  const prs = await db.select().from(schema.pullRequests)
    .where(and(inArray(schema.pullRequests.softwareId, softwareIds), gte(schema.pullRequests.createdAt, range.from)));
  const merged = prs.filter((p) => p.mergedAt);
  const leadH = merged.length ? merged.reduce((a, p) => a + (p.mergedAt!.getTime() - (p.firstCommitAt ?? p.createdAt).getTime()) / 36e5, 0) / merged.length : null;
  const reviewed = prs.filter((p) => p.reviewedAt);
  const agentPrs = prs.filter((p) => p.isAgent);
  return {
    deploysPerWeek: prod.filter((d) => d.status === "success").length / weeks,
    leadTimeHours: leadH,
    failureRate: prod.length ? failures.length / prod.length : null,
    recoveryHours: recoveries.length ? recoveries.reduce((a, b) => a + b, 0) / recoveries.length : null,
    deployments: deps.slice(-20).reverse(),
    prs: { total: prs.length, agent: agentPrs.length, agentMerged: agentPrs.filter((p) => p.mergedAt).length,
      reviewHours: reviewed.length ? reviewed.reduce((a, p) => a + (p.reviewedAt!.getTime() - p.createdAt.getTime()) / 36e5, 0) / reviewed.length : null,
      openAgent: agentPrs.filter((p) => p.state === "open") },
  };
}

export async function softwareCosts(softwareIds: string[]) {
  if (!softwareIds.length) return { byProvider: [], accounts: 0, months: [] as string[] };
  const thisMonth = monthKey(new Date());
  const months = [previousMonthKey(previousMonthKey(thisMonth)), previousMonthKey(thisMonth), thisMonth];
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const [provider, usage, [acc]] = await Promise.all([
    db.select().from(schema.providerCosts)
      .where(and(inArray(schema.providerCosts.softwareId, softwareIds), inArray(schema.providerCosts.month, months))),
    db.select({ provider: schema.usageRecords.provider, usd: sql<number>`sum(${schema.usageRecords.costUsd})::float` })
      .from(schema.usageRecords).where(and(inArray(schema.usageRecords.softwareId, softwareIds), gte(schema.usageRecords.occurredAt, monthStart)))
      .groupBy(schema.usageRecords.provider),
    db.select({ n: sql<number>`count(distinct ${schema.subscriptions.organizationId})::int` })
      .from(schema.subscriptions).where(and(inArray(schema.subscriptions.softwareId, softwareIds), inArray(schema.subscriptions.status, ["active", "past_due"]))),
  ]);
  const providers = [...new Set([...provider.map((p) => p.provider), ...usage.map((u) => u.provider)])].sort();
  const byProvider = providers.map((p) => ({
    provider: p,
    months: months.map((m) => provider.filter((r) => r.provider === p && r.month === m).reduce((a, r) => a + r.costCents, 0)),
    registoMes: Math.round((usage.find((u) => u.provider === p)?.usd ?? 0) * usdEurRate() * 100),
  }));
  return { byProvider, accounts: acc.n, months };
}

// ---------------- Campanhas e funil ----------------
export async function campaigns(softwareIds: string[], range: Range) {
  if (!softwareIds.length) return { rows: [], funnel: null };
  const from = range.from.toISOString().slice(0, 10), to = new Date(range.to.getTime() + 864e5).toISOString().slice(0, 10);
  const [rows, people, paid] = await Promise.all([db.select({
    sw: schema.campaignDaily.softwareId, campaignId: schema.campaignDaily.campaignId, name: schema.campaignDaily.campaignName,
    spend: sql<number>`sum(${schema.campaignDaily.spendCents})::int`, impressions: sql<number>`sum(${schema.campaignDaily.impressions})::int`,
    clicks: sql<number>`sum(${schema.campaignDaily.clicks})::int`, leads: sql<number>`sum(${schema.campaignDaily.leads})::int`,
    freq: sql<number>`max(${schema.campaignDaily.frequency})::float`,
  }).from(schema.campaignDaily)
    .where(and(inArray(schema.campaignDaily.softwareId, softwareIds), gte(schema.campaignDaily.date, from), lt(schema.campaignDaily.date, to)))
    .groupBy(schema.campaignDaily.softwareId, schema.campaignDaily.campaignId, schema.campaignDaily.campaignName)
    .orderBy(desc(sql`sum(${schema.campaignDaily.spendCents})`)),
  // Funil: registos → ativação → pagante (pessoas registadas no período)
  db.select().from(schema.persons)
    .where(and(inArray(schema.persons.softwareId, softwareIds), gte(schema.persons.signedUpAt, range.from))),
  db.select({ org: schema.invoices.organizationId }).from(schema.invoices)
    .where(and(eq(schema.invoices.status, "paid"), inArray(schema.invoices.softwareId, softwareIds))),
  ]);
  const paidOrgs = new Set(paid.map((r) => r.org));
  const payingByCampaign = new Map<string, number>();
  const signupsByCampaign = new Map<string, number>();
  for (const p of people) {
    const c = p.attribution?.last_campaign ?? p.attribution?.utm_campaign ?? "";
    signupsByCampaign.set(c, (signupsByCampaign.get(c) ?? 0) + 1);
    if (p.organizationId && paidOrgs.has(p.organizationId)) payingByCampaign.set(c, (payingByCampaign.get(c) ?? 0) + 1);
  }
  const totals = rows.reduce((a, r) => ({ spend: a.spend + r.spend, impressions: a.impressions + r.impressions, clicks: a.clicks + r.clicks, leads: a.leads + r.leads }),
    { spend: 0, impressions: 0, clicks: 0, leads: 0 });
  const paying = people.filter((p) => p.organizationId && paidOrgs.has(p.organizationId)).length;
  const funnel = {
    impressions: totals.impressions, clicks: totals.clicks, signups: people.length,
    activated: people.filter((p) => p.activatedAt).length, paying,
    spend: totals.spend, cac: cacCents(totals.spend, paying),
    unattributed: people.filter((p) => !p.attribution?.utm_campaign && !p.attribution?.fbclid).length,
  };
  return {
    rows: rows.map((r) => ({
      ...r, cpm: r.impressions ? (r.spend / r.impressions) * 1000 : null, ctr: r.impressions ? r.clicks / r.impressions : null,
      cpc: r.clicks ? r.spend / r.clicks : null, cpl: r.leads ? r.spend / r.leads : null,
      signups: signupsByCampaign.get(r.name) ?? 0, paying: payingByCampaign.get(r.name) ?? 0,
      cac: cacCents(r.spend, payingByCampaign.get(r.name) ?? 0),
    })),
    funnel,
  };
}

// ---------------- Utilização e receita ----------------
export async function revenue(softwareIds: string[]) {
  if (!softwareIds.length) return null;
  const thisMonth = monthKey(new Date());
  const months: string[] = [];
  let m = thisMonth;
  for (let i = 0; i < 12; i++) { months.unshift(m); m = previousMonthKey(m); }
  const rows = await db.select().from(schema.mrrMonthly)
    .where(and(inArray(schema.mrrMonthly.softwareId, softwareIds), inArray(schema.mrrMonthly.month, months)));
  const mapFor = (month: string): MrrMap => new Map(rows.filter((r) => r.month === month).map((r) => [`${r.organizationId}|${r.softwareId}`, r.mrrCents]));
  const series = months.map((mm, i) => {
    const curr = mapFor(mm);
    const prev = i > 0 ? mapFor(months[i - 1]) : new Map();
    return { month: mm, ...mrrMovements(prev, curr) };
  }).filter((s) => s.endCents > 0 || s.startCents > 0);
  return { series, thisMonth };
}

export async function accounts(softwareIds: string[]) {
  if (!softwareIds.length) return [];
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const [subs, usage, lastSeen, failed] = await Promise.all([
    db.select({ s: schema.subscriptions, o: schema.organizations })
      .from(schema.subscriptions).innerJoin(schema.organizations, eq(schema.organizations.id, schema.subscriptions.organizationId))
      .where(inArray(schema.subscriptions.softwareId, softwareIds)).orderBy(desc(schema.subscriptions.mrrCents)),
    db.select({ org: schema.usageRecords.organizationId, sw: schema.usageRecords.softwareId, usd: sql<number>`sum(${schema.usageRecords.costUsd})::float` })
      .from(schema.usageRecords).where(and(inArray(schema.usageRecords.softwareId, softwareIds), gte(schema.usageRecords.occurredAt, monthStart)))
      .groupBy(schema.usageRecords.organizationId, schema.usageRecords.softwareId),
    db.select({ org: schema.productEvents.organizationId, last: sql<Date>`max(${schema.productEvents.occurredAt})`, people: sql<number>`count(distinct ${schema.productEvents.personId})::int` })
      .from(schema.productEvents).where(and(inArray(schema.productEvents.softwareId, softwareIds), gte(schema.productEvents.occurredAt, new Date(Date.now() - 30 * 864e5))))
      .groupBy(schema.productEvents.organizationId),
    db.select({ org: schema.invoices.organizationId, n: sql<number>`count(*)::int` }).from(schema.invoices)
      .where(eq(schema.invoices.status, "failed")).groupBy(schema.invoices.organizationId),
  ]);
  return subs.map(({ s, o }) => {
    const costCents = Math.round((usage.find((u) => u.org === o.id && u.sw === s.softwareId)?.usd ?? 0) * usdEurRate() * 100);
    const seen = lastSeen.find((l) => l.org === o.id);
    const days = seen ? Math.floor((Date.now() - new Date(seen.last).getTime()) / 864e5) : null;
    const health = (failed.find((f) => f.org === o.id)?.n ?? 0) > 0 || (days !== null && days >= 10) ? "vermelho" : days !== null && days >= 5 ? "amarelo" : seen ? "verde" : "amarelo";
    return { sub: s, org: o, costCents, marginCents: s.mrrCents - costCents, activePeople: seen?.people ?? 0, daysSinceSeen: days, health };
  });
}

export async function usageStats(softwareIds: string[], range: Range) {
  if (!softwareIds.length) return null;
  const [[act], features, [time], [orgCount]] = await Promise.all([db.select({
    dau: sql<number>`count(distinct ${schema.productEvents.personId}) filter (where ${schema.productEvents.occurredAt} >= now() - interval '1 day')::int`,
    wau: sql<number>`count(distinct ${schema.productEvents.personId}) filter (where ${schema.productEvents.occurredAt} >= now() - interval '7 days')::int`,
    mau: sql<number>`count(distinct ${schema.productEvents.personId}) filter (where ${schema.productEvents.occurredAt} >= now() - interval '30 days')::int`,
  }).from(schema.productEvents).where(and(inArray(schema.productEvents.softwareId, softwareIds), gte(schema.productEvents.occurredAt, new Date(Date.now() - 30 * 864e5)))),
  db.select({
    feature: schema.productEvents.feature, uses: sql<number>`count(*)::int`, orgs: sql<number>`count(distinct ${schema.productEvents.organizationId})::int`,
  }).from(schema.productEvents)
    .where(and(inArray(schema.productEvents.softwareId, softwareIds), gte(schema.productEvents.occurredAt, range.from), sql`${schema.productEvents.feature} is not null`))
    .groupBy(schema.productEvents.feature).orderBy(desc(sql`count(distinct ${schema.productEvents.organizationId})`)),
  // Tempo ativo: cada sinal de 60 s vale um minuto
  db.select({
    minutes: sql<number>`count(*)::int`, people: sql<number>`count(distinct ${schema.productEvents.personId})::int`,
    days: sql<number>`count(distinct (${schema.productEvents.personId}, date(${schema.productEvents.occurredAt})))::int`,
  }).from(schema.productEvents).where(and(inArray(schema.productEvents.softwareId, softwareIds), eq(schema.productEvents.name, "session.heartbeat"), gte(schema.productEvents.occurredAt, range.from))),
  db.select({ n: sql<number>`count(distinct ${schema.subscriptions.organizationId})::int` }).from(schema.subscriptions)
    .where(and(inArray(schema.subscriptions.softwareId, softwareIds), inArray(schema.subscriptions.status, ["active", "past_due", "trialing"]))),
  ]);
  return { ...act, features, minutesPerPersonDay: time.days ? time.minutes / time.days : null, activeOrgs: orgCount.n };
}

export async function trials(softwareIds: string[]) {
  if (!softwareIds.length) return { active: [], conversion: null };
  const all = await db.select({ s: schema.subscriptions, o: schema.organizations }).from(schema.subscriptions)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.subscriptions.organizationId))
    .where(inArray(schema.subscriptions.softwareId, softwareIds));
  const active = all.filter((r) => r.s.status === "trialing").sort((a, b) => (a.s.trialEnd?.getTime() ?? 0) - (b.s.trialEnd?.getTime() ?? 0));
  const ended = all.filter((r) => r.s.trialEnd && r.s.trialEnd < new Date());
  const converted = ended.filter((r) => ["active", "past_due"].includes(r.s.status));
  return { active, conversion: ended.length ? converted.length / ended.length : null };
}

// ---------------- Orçamentos ABO ----------------
/** Campanhas ligadas às regras ABO, com as decisões da última análise e as mudanças anteriores. */
export async function aboOverview(softwareIds: string[]) {
  if (!softwareIds.length) return [];
  const campaigns = await db.select().from(schema.metaAboCampaigns)
    .where(inArray(schema.metaAboCampaigns.softwareId, softwareIds)).orderBy(schema.metaAboCampaigns.createdAt);
  const out = [];
  // Uma leitura por campanha, todas ao mesmo tempo (antes: uma a seguir à outra)
  const recentByCampaign = await Promise.all(campaigns.map((c) => db.select().from(schema.metaBudgetDecisions)
    .where(eq(schema.metaBudgetDecisions.campaignId, c.campaignId))
    .orderBy(desc(schema.metaBudgetDecisions.createdAt), schema.metaBudgetDecisions.id).limit(120)));
  for (const [i, c] of campaigns.entries()) {
    const recent = recentByCampaign[i];
    const lastRun = recent[0]?.runId;
    out.push({
      ...c,
      last: recent.filter((d) => d.runId === lastRun).sort((a, b) => a.id - b.id),
      history: recent.filter((d) => d.runId !== lastRun && d.action !== "manter").slice(0, 30),
    });
  }
  return out;
}

// ---------------- Monitorização de campanhas ----------------
/** Última leitura da Meta, por qualquer via (ao abrir as campanhas, no botão ou de 6 em 6 horas). */
export async function lastMetaSync(): Promise<Date | null> {
  const [r] = await db.select({ at: sql<string | null>`max(${schema.metaCampaignTotals.updatedAt})` }).from(schema.metaCampaignTotals);
  return r?.at ? new Date(r.at) : null;
}

/** Campanhas com números (da sincronização da Meta), a mais recente primeiro. */
export async function monitoredCampaigns(softwareIds: string[]) {
  if (!softwareIds.length) return [];
  return db.select({
    campaignId: schema.campaignDaily.campaignId, name: schema.campaignDaily.campaignName, softwareId: schema.campaignDaily.softwareId,
    first: sql<string>`min(${schema.campaignDaily.date})::text`, last: sql<string>`max(${schema.campaignDaily.date})::text`,
    spend: sql<number>`sum(${schema.campaignDaily.spendCents})::int`,
  }).from(schema.campaignDaily)
    .where(inArray(schema.campaignDaily.softwareId, softwareIds))
    .groupBy(schema.campaignDaily.campaignId, schema.campaignDaily.campaignName, schema.campaignDaily.softwareId)
    .orderBy(desc(sql`max(${schema.campaignDaily.date})`), desc(sql`sum(${schema.campaignDaily.spendCents})`));
}

/** Uma campanha desde o início: por anúncio, por dia e o orçamento diário (se estiver nas regras ABO). */
export async function campaignMonitor(campaignId: string, softwareIds: string[]) {
  if (!softwareIds.length) return null;
  const where = and(eq(schema.campaignDaily.campaignId, campaignId), inArray(schema.campaignDaily.softwareId, softwareIds));
  const sums = {
    spendCents: sql<number>`sum(${schema.campaignDaily.spendCents})::int`, impressions: sql<number>`sum(${schema.campaignDaily.impressions})::int`,
    clicks: sql<number>`sum(${schema.campaignDaily.clicks})::int`, leads: sql<number>`sum(${schema.campaignDaily.leads})::int`,
    landingViews: sql<number>`sum(${schema.campaignDaily.landingViews})::int`, purchases: sql<number>`sum(${schema.campaignDaily.purchases})::int`,
    checkouts: sql<number>`sum(${schema.campaignDaily.checkouts})::int`,
  };
  const ads = await db.select({
    adName: schema.campaignDaily.adName, adsetName: sql<string>`max(${schema.campaignDaily.adsetName})`, adId: sql<string | null>`max(${schema.campaignDaily.adId})`, sw: sql<string>`max(${schema.campaignDaily.softwareId})`, ...sums,
    maxFrequency: sql<number | null>`max(${schema.campaignDaily.frequency})::float`,
    lastSpend: sql<string | null>`max(case when ${schema.campaignDaily.spendCents} > 0 then ${schema.campaignDaily.date} end)::text`,
  }).from(schema.campaignDaily).where(where).groupBy(schema.campaignDaily.adName).orderBy(desc(sql`sum(${schema.campaignDaily.spendCents})`));
  if (!ads.length) return null;
  const sw = ads[0].sw;
  const [days, [abo], adInfo, [campaignTotals], stripeByAd] = await Promise.all([
    db.select({ date: sql<string>`${schema.campaignDaily.date}::text`, ...sums })
      .from(schema.campaignDaily).where(where).groupBy(schema.campaignDaily.date).orderBy(schema.campaignDaily.date),
    db.select().from(schema.metaAboCampaigns).where(eq(schema.metaAboCampaigns.campaignId, campaignId)),
    // Estado e formato de todos os anúncios da campanha, também os que ainda não gastaram
    db.select().from(schema.metaAds).where(and(eq(schema.metaAds.campaignId, campaignId), inArray(schema.metaAds.softwareId, softwareIds))),
    db.select().from(schema.metaCampaignTotals).where(eq(schema.metaCampaignTotals.campaignId, campaignId)),
    // Compras na Stripe desde o primeiro dia da campanha, pelo anúncio da inscrição de cada pessoa (null: sem inscrição ligada)
    db.select({ adRef: schema.signupAttributions.adRef, n: sql<number>`count(*)::int` })
      .from(schema.stripePurchases)
      .leftJoin(schema.signupAttributions, and(eq(schema.signupAttributions.emailHash, schema.stripePurchases.emailHash), eq(schema.signupAttributions.softwareId, schema.stripePurchases.softwareId)))
      .where(and(eq(schema.stripePurchases.softwareId, sw), sql`${schema.stripePurchases.paidAt} >= (select min(${schema.campaignDaily.date}) from ${schema.campaignDaily} where ${schema.campaignDaily.campaignId} = ${campaignId})`))
      .groupBy(schema.signupAttributions.adRef),
  ]);
  const totals = ads.reduce((a, r) => ({
    spendCents: a.spendCents + r.spendCents, impressions: a.impressions + r.impressions, clicks: a.clicks + r.clicks,
    leads: a.leads + r.leads, landingViews: a.landingViews + r.landingViews, purchases: a.purchases + r.purchases, checkouts: a.checkouts + r.checkouts,
  }), { spendCents: 0, impressions: 0, clicks: 0, leads: 0, landingViews: 0, purchases: 0, checkouts: 0 });
  return {
    ads, days, totals, adInfo, reach: campaignTotals?.reach ?? null, frequency: campaignTotals?.frequency ? Number(campaignTotals.frequency) : null,
    dailyBudgetCents: abo?.dailyBudgetCents ?? null, first: days[0]?.date ?? null, last: days[days.length - 1]?.date ?? null,
    softwareId: sw ?? null,
    stripeByAd: new Map(stripeByAd.filter((r) => r.adRef).map((r) => [r.adRef!, r.n])),
    stripeTotal: stripeByAd.reduce((s, r) => s + r.n, 0),
  };
}
