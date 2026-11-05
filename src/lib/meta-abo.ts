import "server-only";
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { raiseAlert } from "./alerts";
import {
  applyDecisions, buildStructure, canManage, decideBudgets, eurText, metaGetAll, MetaError, notice,
  type AboDecision, type AdNumbers, type MetaAd, type MetaAdset, type Moment,
} from "./abo";

// Orçamentos ABO (regras em ./abo.ts). Corre às 08:00 e às 20:00 a partir de /api/cron/meta-budget, depois de uma
// sincronização curta da Meta. Lê os conjuntos e os anúncios em direto com META_ACCESS_TOKEN (ads_read) e só muda
// orçamentos com META_ADS_TOKEN_GESTAO (ads_management); sem ele, as decisões ficam só propostas. Cada decisão fica em
// meta_budget_decisions com o motivo.

const lisbonToday = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(now); // AAAA-MM-DD
const CHANGES = new Set(["subir", "descer", "pausar"]);

export async function runAbo(moment: Moment, now = new Date()): Promise<{ campaign: string; decisions: number; error?: string }[]> {
  const readToken = process.env.META_ACCESS_TOKEN;
  if (!readToken) return [{ campaign: "-", decisions: 0, error: "META_ACCESS_TOKEN não configurado" }];
  const manageToken = process.env.META_ADS_TOKEN_GESTAO;
  const version = process.env.META_API_VERSION ?? "v23.0";
  const campaigns = await db.select().from(schema.metaAboCampaigns).where(eq(schema.metaAboCampaigns.auto, true));
  if (!campaigns.length) return [];
  const today = lisbonToday(now);
  const manage = manageToken ? await canManage(fetch, manageToken, version) : { ok: false, code: "sem_token_gestao" };
  const out = [];

  for (const c of campaigns) {
    const runId = crypto.randomUUID();
    try {
      const d = schema.campaignDaily;
      const rows = await db.select({
        adId: d.adId,
        spendCents: sql<number>`sum(${d.spendCents})::int`, clicks: sql<number>`sum(${d.clicks})::int`,
        landingViews: sql<number>`sum(${d.landingViews})::int`, leads: sql<number>`sum(${d.leads})::int`,
        purchases: sql<number>`sum(${d.purchases})::int`,
        spendTodayCents: sql<number>`coalesce(sum(${d.spendCents}) filter (where ${d.date} = ${today}), 0)::int`,
        landingViewsToday: sql<number>`coalesce(sum(${d.landingViews}) filter (where ${d.date} = ${today}), 0)::int`,
      }).from(d)
        .where(and(eq(d.campaignId, c.campaignId), gte(d.date, c.aboSince), isNotNull(d.adId)))
        .groupBy(d.adId);
      const numbers = new Map<string, AdNumbers>(rows.map(({ adId, ...n }) => [adId!, n]));
      // Os criativos que as regras já tiraram não voltam pela fila
      const removed = new Set((await db.selectDistinct({ name: schema.metaBudgetDecisions.adName }).from(schema.metaBudgetDecisions)
        .where(and(eq(schema.metaBudgetDecisions.campaignId, c.campaignId), eq(schema.metaBudgetDecisions.action, "pausar"),
          eq(schema.metaBudgetDecisions.applied, true)))).map((r) => r.name ?? ""));
      const adsets = await metaGetAll<MetaAdset>(fetch, `${c.campaignId}/adsets`, { fields: "id,name,status,daily_budget", limit: "100" }, readToken, version);
      const ads = await metaGetAll<MetaAd>(fetch, `${c.campaignId}/ads`, { fields: "id,name,status,effective_status,adset_id,creative{id}", limit: "200" }, readToken, version);
      const structure = buildStructure(adsets, ads, removed);

      let decisions: AboDecision[];
      if (structure.cbo || !structure.adsets.length) {
        decisions = [notice(structure.cbo
          ? "A campanha tem orçamento da campanha (CBO): as regras ABO não mexem nela."
          : "Não há conjuntos ativos com orçamento diário.")];
      } else {
        decisions = decideBudgets({ moment, adsets: structure.adsets, numbers, queue: structure.queue, dailyBudgetCents: c.dailyBudgetCents }).decisions;
        const changes = decisions.filter((x) => CHANGES.has(x.action));
        if (manage.ok) await applyDecisions(fetch, c.accountId, changes, manageToken!, version);
        else for (const x of changes) { x.applied = false; x.errorCode = manage.code; }
      }

      await db.insert(schema.metaBudgetDecisions).values(decisions.map((x) => ({
        runId, moment, campaignId: c.campaignId, adsetId: x.adsetId, adsetName: x.adsetName, adName: x.adName,
        action: x.action, fromCents: x.fromCents, toCents: x.toCents, metric: x.metric, costCents: x.costCents,
        reason: x.reason, incoming: x.incoming?.name ?? null, applied: x.applied === true, errorCode: x.errorCode ?? null,
      })));

      const failed = decisions.filter((x) => CHANGES.has(x.action) && !x.applied && x.errorCode !== "sem_token_gestao");
      if (failed.length) {
        await raiseAlert({ module: "campanhas", softwareId: c.softwareId, severity: "aviso",
          title: `Orçamentos ABO por aplicar: ${c.name}`,
          detail: failed.map((x) => `${x.adName ?? x.adsetName}: ${x.action} (${x.errorCode})`).join("; "),
          dedupeKey: `meta-abo:falha:${c.campaignId}:${today}` });
      }
      for (const x of decisions.filter((y) => y.action === "pausar" && y.applied)) {
        await raiseAlert({ module: "campanhas", softwareId: c.softwareId, severity: "informacao",
          title: x.incoming ? `Criativo trocado: ${x.adName} → ${x.incoming.name}` : `Conjunto parado: ${x.adsetName}`,
          detail: x.reason, dedupeKey: `meta-abo:troca:${c.campaignId}:${x.adsetId}:${today}` });
      }
      out.push({ campaign: c.campaignId, decisions: decisions.length });
    } catch (err) {
      const code = err instanceof MetaError ? err.code : "erro";
      await raiseAlert({ module: "campanhas", softwareId: c.softwareId, severity: "aviso", title: `Orçamentos ABO sem análise: ${c.name}`,
        detail: `A análise de ${moment === "manha" ? "manhã" : "noite"} falhou (${code}). Total do dia: ${eurText(c.dailyBudgetCents)}.`,
        dedupeKey: `meta-abo:erro:${c.campaignId}:${today}` });
      out.push({ campaign: c.campaignId, decisions: 0, error: code });
    }
  }
  if (manageToken && !manage.ok) {
    await raiseAlert({ module: "campanhas", severity: "aviso", title: "Token de gestão da Meta sem ads_management",
      detail: `As decisões ficam só propostas (${manage.code}).`, dedupeKey: `meta-abo:token:${today}` });
  }
  return out;
}
