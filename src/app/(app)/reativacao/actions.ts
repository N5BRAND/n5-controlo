"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { allowedSoftware, requireUser } from "@/lib/auth";
import { queueMessage, runEngagement } from "@/lib/engagement";
import { audit } from "@/lib/audit";
import { getT } from "@/lib/i18n/server";

type Result = { error?: string; ok?: string } | undefined;
const TYPES = ["lembrete", "dica", "novidade", "oferta", "feedback", "fim_trial", "reativacao"] as const;

export async function saveTemplate(_prev: Result, form: FormData): Promise<Result> {
  const user = await requireUser("reativacao");
  const t = await getT();
  const id = Number(form.get("id") ?? 0);
  const ctaUrl = String(form.get("ctaUrl") ?? "").trim() || null;
  const values = {
    name: String(form.get("name") ?? "").trim(),
    softwareId: String(form.get("softwareId") ?? "") || null,
    type: String(form.get("type")) as (typeof TYPES)[number],
    channel: String(form.get("channel")) as "inapp" | "email",
    subject: String(form.get("subject") ?? "").trim(),
    body: String(form.get("body") ?? "").trim(),
    ctaLabel: String(form.get("ctaLabel") ?? "").trim() || null,
    ctaUrl,
  };
  if (!values.name || !values.subject || !values.body) return { error: t("Preenche nome, assunto ou título, e texto.") };
  if (!TYPES.includes(values.type)) return { error: t("Tipo inválido.") };
  if (ctaUrl && !/^https:\/\//.test(ctaUrl)) return { error: t("O link do botão tem de começar por https://") };
  if (values.softwareId && !allowedSoftware(user, values.softwareId)) return { error: t("Sem acesso a este software.") };
  if (id) await db.update(schema.messageTemplates).set(values).where(eq(schema.messageTemplates.id, id));
  else await db.insert(schema.messageTemplates).values(values);
  await audit(`user:${user.sub}`, id ? "template.updated" : "template.created", "message_template", id || null, null, values);
  revalidatePath("/reativacao");
  return { ok: t('Modelo "{name}" guardado.', { name: values.name }) };
}

export async function saveRule(_prev: Result, form: FormData): Promise<Result> {
  const user = await requireUser("reativacao");
  const t = await getT();
  const id = Number(form.get("id") ?? 0);
  const values = {
    name: String(form.get("name") ?? "").trim(),
    softwareId: String(form.get("softwareId") ?? "") || null,
    inactiveDays: Number(form.get("inactiveDays")),
    audience: String(form.get("audience") ?? "todos") as "todos",
    templateId: Number(form.get("templateId")),
    active: form.get("active") === "on",
  };
  if (!values.name || !Number.isInteger(values.inactiveDays) || values.inactiveDays < 1) return { error: t("Indica um nome e um número de dias (1 ou mais).") };
  if (!values.templateId) return { error: t("Escolhe o modelo da comunicação.") };
  if (id) await db.update(schema.engagementRules).set(values).where(eq(schema.engagementRules.id, id));
  else await db.insert(schema.engagementRules).values(values);
  await audit(`user:${user.sub}`, id ? "rule.updated" : "rule.created", "engagement_rule", id || null, null, values);
  revalidatePath("/reativacao");
  return { ok: t('Regra "{name}" guardada.', { name: values.name }) };
}

export async function toggleRule(form: FormData) {
  const user = await requireUser("reativacao");
  const id = Number(form.get("id"));
  const [r] = await db.select().from(schema.engagementRules).where(eq(schema.engagementRules.id, id));
  if (!r) return;
  await db.update(schema.engagementRules).set({ active: !r.active }).where(eq(schema.engagementRules.id, id));
  await audit(`user:${user.sub}`, r.active ? "rule.paused" : "rule.activated", "engagement_rule", id);
  revalidatePath("/reativacao");
}

export async function sendManual(_prev: Result, form: FormData): Promise<Result> {
  const user = await requireUser("reativacao");
  const t = await getT();
  const [p] = await db.select().from(schema.persons).where(eq(schema.persons.id, String(form.get("personId"))));
  const [tm] = await db.select().from(schema.messageTemplates).where(eq(schema.messageTemplates.id, Number(form.get("templateId"))));
  if (!p || !tm) return { error: t("Escolhe a pessoa e o modelo.") };
  if (!p.softwareId || !allowedSoftware(user, p.softwareId)) return { error: t("Sem acesso a este software.") };
  if (tm.softwareId && tm.softwareId !== p.softwareId) return { error: t("Esse modelo é de outro software.") };
  // Envio manual respeita o opt-out mas não os limites de frequência (decisão de uma pessoa da equipa)
  const r = await queueMessage(p, tm, { actor: `user:${user.sub}`, ignoreCaps: true });
  revalidatePath("/reativacao");
  if (r.status === "bloqueada" || r.status === "falhou") return { error: t("Não enviado: {reason}.", { reason: r.reason ? t(r.reason) : "" }) };
  return { ok: r.status === "pendente" ? t("Fica para enviar: {reason}.", { reason: r.reason ? t(r.reason) : "" }) : t("Comunicação enviada.") };
}

export async function runNow() {
  const user = await requireUser("reativacao");
  const r = await runEngagement();
  await audit(`user:${user.sub}`, "engagement.run", "engagement_rule", null, null, r);
  revalidatePath("/reativacao");
}
