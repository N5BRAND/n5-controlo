import "server-only";
import { eq, getTableColumns, isNotNull, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { db, schema } from "@/db";
import { adRef, utmContentOf, type AdCreativeLinks } from "@/lib/metrics";
import { chunks, lastByKey, LIVE_DAYS, LIVE_TIMEOUT_MS, syncDue, withTimeout } from "@/lib/metaLive";
import { lastMetaSync } from "@/lib/queries";

// Leitura do Meta Insights ao nível do anúncio, por dia, para os últimos 28 dias
// (a Meta ainda corrige esses dados), mais o estado de cada anúncio e os totais de cada campanha desde o início.
// Precisa de META_ACCESS_TOKEN com ads_read.
// As linhas gravam-se em lote: as funções da Netlify estão longe da base, e uma gravação por linha levava 20 segundos.

/** Na gravação em lote, as colunas a atualizar quando a linha já existe ficam com o valor novo («excluded»). */
function excluded(table: PgTable, keys: string[]): Record<string, SQL> {
  const cols = getTableColumns(table) as Record<string, { name: string }>;
  return Object.fromEntries(keys.map((k) => [k, sql.raw(`excluded."${cols[k].name}"`)]));
}

interface InsightRow {
  campaign_id: string; campaign_name: string; adset_id?: string; adset_name?: string; ad_id?: string; ad_name?: string; date_start: string;
  spend?: string; impressions?: string; clicks?: string; frequency?: string;
  actions?: { action_type: string; value: string }[];
}

const LEAD_ACTIONS = new Set(["lead", "offsite_conversion.fb_pixel_lead", "onsite_conversion.lead_grouped", "complete_registration", "offsite_conversion.fb_pixel_complete_registration"]);
// Visitas à página e compras: a Meta repete o mesmo evento com nomes diferentes, por isso conta-se o primeiro que aparecer.
const firstAction = (actions: InsightRow["actions"], types: string[]) => {
  for (const t of types) {
    const a = (actions ?? []).find((x) => x.action_type === t);
    if (a) return Math.round(Number(a.value) || 0);
  }
  return 0;
};

export async function syncMetaInsights(days = 28): Promise<{ software: string; rows: number; error?: string }[]> {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) return [{ software: "-", rows: 0, error: "META_ACCESS_TOKEN não configurado" }];
  const version = process.env.META_API_VERSION ?? "v23.0";
  const sws = await db.select().from(schema.softwares).where(isNotNull(schema.softwares.metaAdAccountId));
  const out = [];
  const until = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  for (const sw of sws) {
    try {
      const account = sw.metaAdAccountId!.startsWith("act_") ? sw.metaAdAccountId! : `act_${sw.metaAdAccountId}`;
      const params = new URLSearchParams({
        level: "ad", time_increment: "1", limit: "500",
        fields: "campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,frequency,actions",
        time_range: JSON.stringify({ since, until }), access_token: token,
      });
      const insights = async () => {
        let url: string | null = `https://graph.facebook.com/${version}/${account}/insights?${params}`;
        let rows = 0;
        while (url) {
          const res: Response = await fetch(url, { cache: "no-store" });
          const json = (await res.json()) as { data?: InsightRow[]; paging?: { next?: string }; error?: { message: string } };
          if (json.error) throw new Error(json.error.message);
          const values = (json.data ?? []).map((r) => ({
            softwareId: sw.id, accountId: account, campaignId: r.campaign_id, campaignName: r.campaign_name,
            adsetName: r.adset_name ?? "", adName: r.ad_name ?? "", adsetId: r.adset_id ?? null, adId: r.ad_id ?? null, date: r.date_start,
            spendCents: Math.round(Number(r.spend ?? 0) * 100), impressions: Number(r.impressions ?? 0),
            clicks: Number(r.clicks ?? 0), frequency: r.frequency ?? null,
            leads: (r.actions ?? []).filter((a) => LEAD_ACTIONS.has(a.action_type)).reduce((s, a) => s + Number(a.value), 0),
            landingViews: firstAction(r.actions, ["landing_page_view"]),
            purchases: firstAction(r.actions, ["offsite_conversion.fb_pixel_purchase", "purchase"]),
            checkouts: firstAction(r.actions, ["offsite_conversion.fb_pixel_initiate_checkout", "initiate_checkout"]),
          }));
          const unique = lastByKey(values, (v) => [v.campaignId, v.adsetName, v.adName, v.date].join("\u0000"));
          for (const part of chunks(unique)) {
            await db.insert(schema.campaignDaily).values(part).onConflictDoUpdate({
              target: [schema.campaignDaily.campaignId, schema.campaignDaily.adsetName, schema.campaignDaily.adName, schema.campaignDaily.date],
              set: excluded(schema.campaignDaily, Object.keys(part[0])),
            });
          }
          rows += values.length;
          url = json.paging?.next ?? null;
        }
        return rows;
      };
      const [rows] = await Promise.all([insights(), syncAdsAndTotals(sw.id, account, token, version)]);
      out.push({ software: sw.id, rows });
    } catch (err) {
      out.push({ software: sw.id, rows: 0, error: String(err) });
    }
  }
  return out;
}

async function metaGetAll<T>(url: string): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = url;
  for (let i = 0; next && i < 20; i++) {
    const res: Response = await fetch(next, { cache: "no-store" });
    const json = (await res.json()) as { data?: T[]; paging?: { next?: string }; error?: { message: string } };
    if (json.error) throw new Error(json.error.message);
    out.push(...(json.data ?? []));
    next = json.paging?.next ?? null;
  }
  return out;
}

/** Estado e formato de cada anúncio, e os totais de cada campanha desde o início (alcance e frequência). */
async function syncAdsAndTotals(softwareId: string, account: string, token: string, version: string) {
  const base = `https://graph.facebook.com/${version}/${account}`;
  const ads = await metaGetAll<{ id: string; name?: string; campaign_id?: string; effective_status?: string; adset?: { name?: string }; creative?: { object_type?: string } & AdCreativeLinks }>(
    `${base}/ads?${new URLSearchParams({ fields: "id,name,campaign_id,effective_status,adset{name},creative{object_type,url_tags,object_story_spec,asset_feed_spec}", limit: "200", access_token: token })}`);
  const adRows = lastByKey(ads.filter((a) => a.id && a.campaign_id).map((a) => {
    const name = a.name ?? a.id;
    return {
      adId: a.id, softwareId, campaignId: a.campaign_id!, name, adsetName: a.adset?.name ?? null, status: a.effective_status ?? null,
      format: (a.creative?.object_type ?? "").toUpperCase() === "VIDEO" || /V[IÍ]DEO/i.test(name) ? "video" : "imagem",
      adRef: adRef(utmContentOf(a.creative) ?? name) || null, updatedAt: new Date(),
    };
  }), (r) => r.adId);
  for (const part of chunks(adRows)) {
    await db.insert(schema.metaAds).values(part).onConflictDoUpdate({
      target: schema.metaAds.adId, set: excluded(schema.metaAds, Object.keys(part[0]).filter((k) => k !== "adId")),
    });
  }
  const totals = await metaGetAll<{ campaign_id: string; spend?: string; impressions?: string; reach?: string; frequency?: string; date_start?: string; date_stop?: string }>(
    `${base}/insights?${new URLSearchParams({ level: "campaign", date_preset: "maximum", fields: "campaign_id,spend,impressions,reach,frequency", limit: "200", access_token: token })}`);
  const totalRows = lastByKey(totals.map((t) => ({
    campaignId: t.campaign_id, softwareId, since: t.date_start ?? null, until: t.date_stop ?? null, spendCents: Math.round(Number(t.spend ?? 0) * 100),
    impressions: Number(t.impressions ?? 0), reach: Number(t.reach ?? 0), frequency: t.frequency ?? null, updatedAt: new Date(),
  })), (r) => r.campaignId);
  for (const part of chunks(totalRows)) {
    await db.insert(schema.metaCampaignTotals).values(part).onConflictDoUpdate({
      target: schema.metaCampaignTotals.campaignId, set: excluded(schema.metaCampaignTotals, Object.keys(part[0]).filter((k) => k !== "campaignId")),
    });
  }
}

/** Ao abrir as páginas de campanhas: lê da Meta os últimos dias se a última leitura tiver mais de 30 segundos.
 *  A página não espera mais de 5 segundos; se a Meta demorar ou falhar, mostra a última leitura e diz porquê. */
export async function syncMetaLive(now = new Date()): Promise<{ readAt: Date | null; error?: string }> {
  const last = await lastMetaSync();
  if (!syncDue(last, now)) return { readAt: last };
  try {
    const r = await withTimeout(syncMetaInsights(LIVE_DAYS), LIVE_TIMEOUT_MS);
    if (!r) return { readAt: last, error: "A Meta demorou a responder" };
    const error = r.find((x) => x.error)?.error;
    return error ? { readAt: last, error } : { readAt: (await lastMetaSync()) ?? now };
  } catch (err) {
    return { readAt: last, error: String(err instanceof Error ? err.message : err) };
  }
}

/** Importação de CSV exportado do Gestor de Anúncios (alternativa à API). */
export async function importCampaignCsv(softwareId: string, csv: string): Promise<{ rows: number; errors: string[] }> {
  const lines = csv.replace(/\r/g, "").split("\n").filter((l) => l.trim());
  if (lines.length < 2) return { rows: 0, errors: ["O ficheiro não tem linhas de dados."] };
  const sep = lines[0].includes(";") ? ";" : ",";
  const split = (l: string) => {
    const out: string[] = []; let cur = "", q = false;
    for (const ch of l) {
      if (ch === '"') q = !q;
      else if (ch === sep && !q) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const header = split(lines[0]).map((h) => h.toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.some((n) => h.includes(n)));
  const idx = {
    date: col("dia", "day", "data", "date"), campaign: col("nome da campanha", "campaign name", "campanha"),
    adset: col("conjunto", "ad set"), ad: col("nome do anúncio", "ad name", "anúncio"),
    spend: col("valor gasto", "amount spent", "gasto", "spend"), impressions: col("impress"), clicks: col("cliques", "clicks"),
    leads: col("leads", "resultados", "results", "registos"), frequency: col("frequência", "frequency"),
  };
  const errors: string[] = [];
  if (idx.date < 0 || idx.campaign < 0 || idx.spend < 0) return { rows: 0, errors: ["Faltam colunas obrigatórias: Dia, Nome da campanha e Valor gasto."] };
  const num = (s: string | undefined) => Number((s ?? "0").replace(/\s|€/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".")) || 0;
  let rows = 0;
  const [sw] = await db.select().from(schema.softwares).where(eq(schema.softwares.id, softwareId));
  for (const [i, l] of lines.slice(1).entries()) {
    const c = split(l);
    const date = c[idx.date];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) { errors.push(`Linha ${i + 2}: data inválida (${date}); usa AAAA-MM-DD.`); continue; }
    const campaignName = c[idx.campaign] ?? "";
    const values = {
      softwareId, accountId: sw?.metaAdAccountId ?? null, campaignId: `csv:${campaignName}`, campaignName,
      adsetName: idx.adset >= 0 ? c[idx.adset] ?? "" : "", adName: idx.ad >= 0 ? c[idx.ad] ?? "" : "", date,
      spendCents: Math.round(num(c[idx.spend]) * 100), impressions: Math.round(num(c[idx.impressions])),
      clicks: Math.round(num(c[idx.clicks])), leads: Math.round(num(c[idx.leads])),
      frequency: idx.frequency >= 0 ? String(num(c[idx.frequency])) : null,
    };
    await db.insert(schema.campaignDaily).values(values).onConflictDoUpdate({
      target: [schema.campaignDaily.campaignId, schema.campaignDaily.adsetName, schema.campaignDaily.adName, schema.campaignDaily.date],
      set: values,
    });
    rows++;
  }
  return { rows, errors };
}
