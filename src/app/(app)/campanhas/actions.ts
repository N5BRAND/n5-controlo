"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { allowedSoftware, requireUser } from "@/lib/auth";
import { importCampaignCsv, syncMetaInsights } from "@/lib/meta";
import { getT } from "@/lib/i18n/server";
import { audit } from "@/lib/audit";

export async function importCsv(_prev: { message?: string; error?: string } | undefined, form: FormData) {
  const user = await requireUser("campanhas");
  const t = await getT();
  const file = form.get("file");
  const softwareId = String(form.get("softwareId"));
  if (!(file instanceof File) || file.size === 0) return { error: t("Escolhe um ficheiro CSV.") };
  if (file.size > 5_000_000) return { error: t("O ficheiro tem mais de 5 MB. Exporta menos dias de cada vez.") };
  const res = await importCampaignCsv(softwareId, await file.text());
  await audit(`user:${user.sub}`, "campaigns.csv_import", "campaign_daily", softwareId, null, { rows: res.rows, errors: res.errors.length });
  revalidatePath("/campanhas");
  if (res.rows === 0) return { error: res.errors.slice(0, 3).join(" ") || t("Nenhuma linha importada.") };
  const done = t("{n} linhas importadas.", { n: res.rows });
  return { message: res.errors.length ? `${done} ${t("{n} linhas ignoradas: {erros}", { n: res.errors.length, erros: res.errors.slice(0, 2).join(" ") })}` : done };
}

export async function syncNow() {
  const user = await requireUser("campanhas");
  const r = await syncMetaInsights();
  await audit(`user:${user.sub}`, "campaigns.meta_sync", "campaign_daily", null, null, r);
  revalidatePath("/campanhas");
}

const AboInput = z.object({
  softwareId: z.string().min(1, "Escolhe o software."),
  campaignId: z.string().trim().regex(/^\d{5,30}$/, "O ID da campanha tem só algarismos (está no Gestor de Anúncios)."),
  name: z.string().trim().min(1, "Dá um nome à campanha.").max(120),
  dailyBudget: z.coerce.number().positive("O orçamento do dia tem de ser maior que zero.").max(1000),
  aboSince: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Indica o dia em que a campanha passou a ABO."),
});

/** Liga (ou atualiza) uma campanha às regras de orçamento ABO. */
export async function saveAboCampaign(_prev: { message?: string; error?: string } | undefined, form: FormData) {
  const user = await requireUser("campanhas");
  const parsed = AboInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const p = parsed.data;
  if (!allowedSoftware(user, p.softwareId)) return { error: "Sem acesso a este software." };
  const [sw] = await db.select().from(schema.softwares).where(eq(schema.softwares.id, p.softwareId));
  if (!sw?.metaAdAccountId) return { error: "Este software ainda não tem conta de anúncios (Definições › Softwares)." };
  const values = {
    softwareId: p.softwareId, accountId: sw.metaAdAccountId.startsWith("act_") ? sw.metaAdAccountId : `act_${sw.metaAdAccountId}`,
    name: p.name, dailyBudgetCents: Math.round(p.dailyBudget * 100), aboSince: p.aboSince,
  };
  const [before] = await db.select().from(schema.metaAboCampaigns).where(eq(schema.metaAboCampaigns.campaignId, p.campaignId));
  await db.insert(schema.metaAboCampaigns).values({ campaignId: p.campaignId, ...values })
    .onConflictDoUpdate({ target: schema.metaAboCampaigns.campaignId, set: values });
  await audit(`user:${user.sub}`, "campaigns.abo_save", "meta_abo_campaigns", p.campaignId, before ?? null, values);
  revalidatePath("/campanhas");
  return { message: before ? "Campanha atualizada." : "Campanha ligada às regras ABO. A primeira análise é às 08:00 ou às 20:00." };
}

/** Liga ou desliga as regras numa campanha (desligadas, não mexem em nada). */
export async function toggleAboCampaign(form: FormData) {
  const user = await requireUser("campanhas");
  const campaignId = String(form.get("campaignId"));
  const [c] = await db.select().from(schema.metaAboCampaigns).where(eq(schema.metaAboCampaigns.campaignId, campaignId));
  if (!c || !allowedSoftware(user, c.softwareId)) return;
  await db.update(schema.metaAboCampaigns).set({ auto: !c.auto }).where(eq(schema.metaAboCampaigns.campaignId, campaignId));
  await audit(`user:${user.sub}`, c.auto ? "campaigns.abo_off" : "campaigns.abo_on", "meta_abo_campaigns", campaignId, { auto: c.auto }, { auto: !c.auto });
  revalidatePath("/campanhas");
}
