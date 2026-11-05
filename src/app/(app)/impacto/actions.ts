"use server";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { allowedSoftware, requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getT } from "@/lib/i18n/server";

type Result = { error?: string; ok?: string } | undefined;
const num = (v: FormDataEntryValue | null) => Number(String(v ?? "").replace(",", "."));

export async function saveSettings(_prev: Result, form: FormData): Promise<Result> {
  const user = await requireUser("impacto");
  const t = await getT();
  const softwareId = String(form.get("softwareId") ?? "");
  if (!allowedSoftware(user, softwareId)) return { error: t("Sem acesso a este software.") };
  const hour = num(form.get("hourValue")), weekly = num(form.get("defaultWeeklyHours")), fast = num(form.get("fastResponseMinutes")), sample = num(form.get("minSample"));
  if (!(hour > 0 && hour < 1000)) return { error: t("Valor da hora entre 0 e 1 000 €.") };
  if (!(weekly >= 1 && weekly <= 100)) return { error: t("Horas por semana entre 1 e 100.") };
  if (!(fast >= 1 && fast <= 120)) return { error: t("Resposta rápida entre 1 e 120 minutos.") };
  if (!(sample >= 10 && sample <= 1000)) return { error: t("Amostra mínima entre 10 e 1 000 leads.") };
  const values = { hourValueCents: Math.round(hour * 100), defaultWeeklyHours: Math.round(weekly), fastResponseMinutes: Math.round(fast), minSample: Math.round(sample), updatedAt: new Date() };
  const [before] = await db.select().from(schema.impactSettings).where(eq(schema.impactSettings.softwareId, softwareId));
  await db.insert(schema.impactSettings).values({ softwareId, ...values }).onConflictDoUpdate({ target: schema.impactSettings.softwareId, set: values });
  await audit(`user:${user.sub}`, "impact.settings_updated", "impact_settings", softwareId, before ?? null, values);
  revalidatePath("/impacto");
  return { ok: t("Pressupostos guardados.") };
}

export async function saveTask(_prev: Result, form: FormData): Promise<Result> {
  const user = await requireUser("impacto");
  const t = await getT();
  const id = Number(form.get("id") ?? 0);
  const softwareId = String(form.get("softwareId") ?? "");
  if (!allowedSoftware(user, softwareId)) return { error: t("Sem acesso a este software.") };
  const key = String(form.get("key") ?? "").trim();
  const label = String(form.get("label") ?? "").trim();
  const manual = num(form.get("manualMinutes")), remaining = num(form.get("remainingMinutes"));
  if (!/^[a-z0-9_.]{3,60}$/.test(key)) return { error: t("Código da tarefa: letras minúsculas, números, ponto e _ (ex.: lead.first_reply).") };
  if (!label) return { error: t("Indica o nome da tarefa.") };
  if (!(manual > 0 && manual <= 600)) return { error: t("Tempo à mão entre 0 e 600 minutos.") };
  if (!(remaining >= 0 && remaining <= manual)) return { error: t("O tempo que fica para a pessoa não pode passar o tempo à mão.") };
  const values = {
    softwareId, key, label, manualMinutes: manual.toFixed(2), remainingMinutes: remaining.toFixed(2),
    basis: String(form.get("basis") ?? "").trim() || null, validated: form.get("validated") === "on", active: form.get("active") !== "off", updatedAt: new Date(),
  };
  if (id) {
    const [before] = await db.select().from(schema.impactTasks).where(eq(schema.impactTasks.id, id));
    await db.update(schema.impactTasks).set(values).where(eq(schema.impactTasks.id, id));
    await audit(`user:${user.sub}`, "impact.task_updated", "impact_task", id, before ?? null, values);
  } else {
    const [dup] = await db.select().from(schema.impactTasks).where(and(eq(schema.impactTasks.softwareId, softwareId), eq(schema.impactTasks.key, key)));
    if (dup) return { error: t("Já existe a tarefa {key} neste software.", { key }) };
    const [row] = await db.insert(schema.impactTasks).values(values).returning({ id: schema.impactTasks.id });
    await audit(`user:${user.sub}`, "impact.task_created", "impact_task", row.id, null, values);
  }
  revalidatePath("/impacto");
  return { ok: t('Tarefa "{label}" guardada.', { label }) };
}
