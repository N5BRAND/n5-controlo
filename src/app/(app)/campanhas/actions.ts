"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
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
