import "server-only";
import { and, eq, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { businessHoursBetween, daysUntil, deadlineStatus, DUE_SOON_DAYS, monthKey, previousMonthKey } from "./metrics";
import { postSlackMessage } from "./slack";
import { loadImpact } from "./impact";

type Severity = "critico" | "aviso" | "informacao";
type Module = "comunidades" | "pipeline" | "campanhas" | "receita" | "sistema" | "impacto" | "chat";

export interface AlertInput {
  module: Module;
  softwareId?: string | null;
  severity: Severity;
  title: string;
  detail?: string;
  dedupeKey: string;
}

/**
 * Cria um alerta, ou soma ao contador se já existe um igual ainda aberto (Centro de alertas, regra de repetição).
 * Críticos e avisos novos seguem para o canal Slack interno.
 */
export async function raiseAlert(a: AlertInput): Promise<{ id: number; created: boolean }> {
  const [open] = await db.select().from(schema.alerts)
    .where(and(eq(schema.alerts.dedupeKey, a.dedupeKey), ne(schema.alerts.status, "resolvido")));
  if (open) {
    await db.update(schema.alerts)
      .set({ count: open.count + 1, updatedAt: new Date(), detail: a.detail ?? open.detail })
      .where(eq(schema.alerts.id, open.id));
    return { id: open.id, created: false };
  }
  const [row] = await db.insert(schema.alerts).values({
    module: a.module, softwareId: a.softwareId ?? null, severity: a.severity,
    title: a.title, detail: a.detail ?? null, dedupeKey: a.dedupeKey,
  }).returning({ id: schema.alerts.id });
  if (a.severity !== "informacao") {
    const channel = process.env.SLACK_ALERTS_CHANNEL ?? "n5-alertas";
    const label = a.severity === "critico" ? "CRÍTICO" : "Aviso";
    await postSlackMessage(channel, `*${label}* · ${a.title}${a.detail ? `\n${a.detail}` : ""}\n${process.env.APP_URL ?? ""}/alertas`);
  }
  return { id: row.id, created: true };
}

const usdEur = () => Number(process.env.USD_EUR_RATE ?? "0.87");

/** Avalia as regras periódicas de todos os módulos. Corre a partir de /api/cron/alerts. */
export async function evaluateAlerts(now = new Date()): Promise<{ checked: number; raised: number }> {
  let raised = 0;
  const bump = async (a: AlertInput) => { const r = await raiseAlert(a); if (r.created) raised++; };
  const softwares = await db.select().from(schema.softwares);
  const name = (id: string | null) => softwares.find((s) => s.id === id)?.name ?? id ?? "";

  // --- Comunidades: feedback sem resposta há mais de 48 horas úteis
  const pending = await db.select().from(schema.feedback)
    .where(and(eq(schema.feedback.status, "recebido"), sql`${schema.feedback.firstResponseAt} is null`));
  for (const f of pending) {
    if (businessHoursBetween(f.createdAt, now) > 48) {
      await bump({ module: "comunidades", softwareId: f.softwareId, severity: "aviso",
        title: `Feedback sem resposta: ${f.title}`, detail: `${name(f.softwareId)} · aberto desde ${f.createdAt.toISOString().slice(0, 10)}`,
        dedupeKey: `fb-sem-resposta:${f.id}` });
    }
  }

  // --- Comunidades: 5 ou mais "funciona mal" na mesma funcionalidade numa semana
  const weekAgo = new Date(now.getTime() - 7 * 864e5);
  const bad = await db.select({
    softwareId: schema.feedback.softwareId, feature: schema.feedback.feature, n: sql<number>`count(*)::int`,
  }).from(schema.feedback)
    .where(and(eq(schema.feedback.type, "funciona_mal"), sql`${schema.feedback.createdAt} >= ${weekAgo.toISOString()}`))
    .groupBy(schema.feedback.softwareId, schema.feedback.feature);
  for (const b of bad) {
    if (b.n >= 5 && b.feature) {
      await bump({ module: "comunidades", softwareId: b.softwareId, severity: "aviso",
        title: `Funcionalidade com problemas: ${b.feature}`, detail: `${b.n} "funciona mal" nos últimos 7 dias (${name(b.softwareId)})`,
        dedupeKey: `fb-funcionalidade:${b.softwareId}:${b.feature}:${monthKey(now)}` });
    }
  }

  // --- Pipeline: item do sprint sem mudanças há 5 dias úteis
  const stuck = await db.select().from(schema.roadmapItems)
    .where(sql`${schema.roadmapItems.sprint} is not null and ${schema.roadmapItems.phase} not in ('sprint_backlog','paused','done','canceled')`);
  for (const i of stuck) {
    if (businessHoursBetween(i.updatedAt, now) > 5 * 9) {
      await bump({ module: "pipeline", softwareId: i.softwareId, severity: "informacao",
        title: `Item parado: ${i.code} ${i.title}`, detail: `Sem mudanças desde ${i.updatedAt.toISOString().slice(0, 10)}`,
        dedupeKey: `item-parado:${i.id}` });
    }
  }

  // --- Pipeline: PR de agente sem revisão há mais de 2 dias úteis
  const agentPrs = await db.select().from(schema.pullRequests)
    .where(and(eq(schema.pullRequests.isAgent, true), eq(schema.pullRequests.state, "open"), sql`${schema.pullRequests.reviewedAt} is null`));
  for (const pr of agentPrs) {
    if (businessHoursBetween(pr.createdAt, now) > 2 * 9) {
      await bump({ module: "pipeline", softwareId: pr.softwareId, severity: "aviso",
        title: `PR de agente sem revisão: ${pr.repo}#${pr.number}`, detail: pr.title, dedupeKey: `pr-agente:${pr.id}` });
    }
  }

  // --- Pipeline: custo do software mais de 25% acima do mês anterior
  const thisMonth = monthKey(now), lastMonth = previousMonthKey(thisMonth);
  const costs = await db.select({
    softwareId: schema.providerCosts.softwareId, month: schema.providerCosts.month, total: sql<number>`sum(${schema.providerCosts.costCents})::int`,
  }).from(schema.providerCosts).where(sql`${schema.providerCosts.month} in (${thisMonth}, ${lastMonth})`)
    .groupBy(schema.providerCosts.softwareId, schema.providerCosts.month);
  for (const sw of softwares) {
    const cur = costs.find((c) => c.softwareId === sw.id && c.month === thisMonth)?.total ?? 0;
    const prev = costs.find((c) => c.softwareId === sw.id && c.month === lastMonth)?.total ?? 0;
    if (prev > 0 && cur > prev * 1.25) {
      await bump({ module: "pipeline", softwareId: sw.id, severity: "aviso", title: `Custo a subir: ${sw.name}`,
        detail: `Custo deste mês ${(cur / 100).toFixed(2)} € contra ${(prev / 100).toFixed(2)} € no mês anterior`,
        dedupeKey: `custo-subir:${sw.id}:${thisMonth}` });
    }
  }

  // --- Campanhas: custo por registo acima do limite dois dias seguidos; fadiga
  const twoDaysAgo = new Date(now.getTime() - 2 * 864e5).toISOString().slice(0, 10);
  const daily = await db.select({
    softwareId: schema.campaignDaily.softwareId, date: schema.campaignDaily.date,
    spend: sql<number>`sum(${schema.campaignDaily.spendCents})::int`, leads: sql<number>`sum(${schema.campaignDaily.leads})::int`,
  }).from(schema.campaignDaily).where(sql`${schema.campaignDaily.date} >= ${twoDaysAgo}`)
    .groupBy(schema.campaignDaily.softwareId, schema.campaignDaily.date);
  for (const sw of softwares) {
    if (!sw.cplLimitCents) continue;
    const days = daily.filter((d) => d.softwareId === sw.id).sort((a, b) => a.date.localeCompare(b.date)).slice(-2);
    if (days.length === 2 && days.every((d) => d.leads === 0 ? d.spend > 0 : d.spend / d.leads > sw.cplLimitCents!)) {
      await bump({ module: "campanhas", softwareId: sw.id, severity: "aviso", title: `Custo por registo alto: ${sw.name}`,
        detail: `Acima de ${(sw.cplLimitCents / 100).toFixed(2)} € nos dias ${days.map((d) => d.date).join(" e ")}`,
        dedupeKey: `cpl:${sw.id}:${days[1].date}` });
    }
  }
  const tired = await db.select().from(schema.campaignDaily)
    .where(sql`${schema.campaignDaily.date} >= ${twoDaysAgo} and ${schema.campaignDaily.frequency} > 3`);
  for (const t of tired) {
    await bump({ module: "campanhas", softwareId: t.softwareId, severity: "aviso", title: `Fadiga: ${t.campaignName}`,
      detail: `Frequência ${t.frequency} em ${t.adsetName || "conjunto sem nome"} (${t.date})`,
      dedupeKey: `fadiga:${t.campaignId}:${t.adsetName}` });
  }

  // --- Campanhas: mais de 20% dos registos da semana sem campanha
  for (const sw of softwares) {
    const [r] = await db.select({
      total: sql<number>`count(*)::int`,
      semCampanha: sql<number>`count(*) filter (where ${schema.persons.attribution}->>'utm_campaign' is null and ${schema.persons.attribution}->>'fbclid' is null)::int`,
    }).from(schema.persons).where(and(eq(schema.persons.softwareId, sw.id), sql`${schema.persons.signedUpAt} >= ${weekAgo.toISOString()}`));
    if (r.total >= 10 && r.semCampanha / r.total > 0.2) {
      await bump({ module: "campanhas", softwareId: sw.id, severity: "aviso", title: `Atribuição em falta: ${sw.name}`,
        detail: `${r.semCampanha} de ${r.total} registos da semana sem campanha`, dedupeKey: `atribuicao:${sw.id}:${monthKey(now)}` });
    }
  }

  // --- Receita: trial termina em 3 dias sem ativação
  const inThreeDays = new Date(now.getTime() + 3 * 864e5);
  const trials = await db.select({ sub: schema.subscriptions, org: schema.organizations })
    .from(schema.subscriptions).innerJoin(schema.organizations, eq(schema.organizations.id, schema.subscriptions.organizationId))
    .where(and(eq(schema.subscriptions.status, "trialing"), sql`${schema.subscriptions.trialEnd} <= ${inThreeDays.toISOString()}`));
  for (const t of trials) {
    const [act] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.productEvents)
      .where(and(eq(schema.productEvents.organizationId, t.org.id), eq(schema.productEvents.name, "account.activated")));
    if (act.n === 0) {
      await bump({ module: "receita", softwareId: t.sub.softwareId, severity: "aviso", title: `Trial sem ativação: ${t.org.name}`,
        detail: `Termina a ${t.sub.trialEnd?.toISOString().slice(0, 10)}`, dedupeKey: `trial-sem-ativacao:${t.sub.id}` });
    }
  }

  // --- Receita: margem negativa numa conta no mês corrente
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const orgCosts = await db.select({
    orgId: schema.usageRecords.organizationId, softwareId: schema.usageRecords.softwareId,
    costUsd: sql<number>`sum(${schema.usageRecords.costUsd})::float`,
  }).from(schema.usageRecords).where(sql`${schema.usageRecords.occurredAt} >= ${monthStart.toISOString()}`)
    .groupBy(schema.usageRecords.organizationId, schema.usageRecords.softwareId);
  const subs = await db.select().from(schema.subscriptions).where(sql`${schema.subscriptions.status} in ('active','past_due')`);
  for (const c of orgCosts) {
    const mrr = subs.filter((s) => s.organizationId === c.orgId && s.softwareId === c.softwareId).reduce((a, s) => a + s.mrrCents, 0);
    const costCents = Math.round(c.costUsd * usdEur() * 100);
    if (mrr > 0 && costCents > mrr) {
      await bump({ module: "receita", softwareId: c.softwareId, severity: "aviso", title: `Margem negativa: ${c.orgId}`,
        detail: `Custo ${(costCents / 100).toFixed(2)} € acima da mensalidade ${(mrr / 100).toFixed(2)} €`,
        dedupeKey: `margem-negativa:${c.orgId}:${c.softwareId}:${thisMonth}` });
    }
  }

  // --- Receita: MRR do software a cair face ao mês anterior
  const mrrRows = await db.select({
    softwareId: schema.mrrMonthly.softwareId, month: schema.mrrMonthly.month, total: sql<number>`sum(${schema.mrrMonthly.mrrCents})::int`,
  }).from(schema.mrrMonthly).where(sql`${schema.mrrMonthly.month} in (${thisMonth}, ${lastMonth})`)
    .groupBy(schema.mrrMonthly.softwareId, schema.mrrMonthly.month);
  for (const sw of softwares) {
    const cur = mrrRows.find((r) => r.softwareId === sw.id && r.month === thisMonth)?.total;
    const prev = mrrRows.find((r) => r.softwareId === sw.id && r.month === lastMonth)?.total;
    if (cur !== undefined && prev !== undefined && cur < prev) {
      await bump({ module: "receita", softwareId: sw.id, severity: "aviso", title: `MRR a cair: ${sw.name}`,
        detail: `${(cur / 100).toFixed(2)} € contra ${(prev / 100).toFixed(2)} € no mês anterior`, dedupeKey: `mrr-cair:${sw.id}:${thisMonth}` });
    }
  }

  // --- Pipeline: prazos ultrapassados, a vencer hoje e a chegar
  const withDue = await db.select().from(schema.roadmapItems).where(sql`${schema.roadmapItems.dueDate} is not null and ${schema.roadmapItems.phase} not in ('done','canceled')`);
  for (const i of withDue) {
    const st = deadlineStatus(i.dueDate, i.phase, now);
    const d = daysUntil(i.dueDate!, now);
    if (st === "atrasado") {
      await bump({ module: "pipeline", softwareId: i.softwareId, severity: "aviso", title: `Prazo ultrapassado: ${i.code} ${i.title}`,
        detail: `${-d} dia(s) depois do prazo de ${i.dueDate}, ainda em ${i.phase}`, dedupeKey: `prazo-atrasado:${i.id}:${i.dueDate}` });
    } else if (st === "hoje") {
      await bump({ module: "pipeline", softwareId: i.softwareId, severity: "aviso", title: `Prazo hoje: ${i.code} ${i.title}`,
        detail: `Ainda em ${i.phase}`, dedupeKey: `prazo-hoje:${i.id}:${i.dueDate}` });
    } else if (st === "a_chegar") {
      await bump({ module: "pipeline", softwareId: i.softwareId, severity: "informacao", title: `Prazo a chegar: ${i.code} ${i.title}`,
        detail: `Faltam ${d} dia(s) (prazo ${i.dueDate}, aviso a ${DUE_SOON_DAYS} dias); fase atual: ${i.phase}`, dedupeKey: `prazo-a-chegar:${i.id}:${i.dueDate}` });
    }
  }

  // --- Impacto: conta pagante cujo tempo poupado vale menos do que a mensalidade (risco de cancelar)
  const last30 = { from: new Date(now.getTime() - 30 * 864e5), to: now, prevFrom: new Date(now.getTime() - 60 * 864e5), prevTo: new Date(now.getTime() - 30 * 864e5), key: "30d" as const };
  const impact = await loadImpact(softwares.map((s) => s.id), last30);
  for (const a of impact.accounts) {
    if (a.costCents > 0 && a.roiTime !== null && a.roiTime < 1) {
      await bump({ module: "impacto", softwareId: a.softwareId, severity: "aviso", title: `Retorno abaixo da mensalidade: ${a.orgName}`,
        detail: `Tempo poupado nos últimos 30 dias vale ${(a.timeValueCents / 100).toFixed(2)} € para ${(a.costCents / 100).toFixed(2)} € pagos. Rever a utilização com o cliente.`,
        dedupeKey: `impacto-baixo:${a.orgId}:${a.softwareId}:${thisMonth}` });
    }
  }

  // --- Sistema: webhooks com erro nas últimas 24 horas
  const dayAgo = new Date(now.getTime() - 864e5);
  const failed = await db.select({ source: schema.webhookInbox.source, n: sql<number>`count(*)::int` }).from(schema.webhookInbox)
    .where(sql`${schema.webhookInbox.error} is not null and ${schema.webhookInbox.receivedAt} >= ${dayAgo.toISOString()}`)
    .groupBy(schema.webhookInbox.source);
  for (const f of failed) {
    await bump({ module: "sistema", severity: "aviso", title: `Webhooks com erro: ${f.source}`,
      detail: `${f.n} nas últimas 24 horas`, dedupeKey: `webhook-erro:${f.source}:${now.toISOString().slice(0, 10)}` });
  }

  return { checked: softwares.length, raised };
}
