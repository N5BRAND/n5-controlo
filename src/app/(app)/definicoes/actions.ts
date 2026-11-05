"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { generateKey, hashKey, SCOPES } from "@/lib/apikeys";
import { audit } from "@/lib/audit";
import { getT } from "@/lib/i18n/server";

const list = (v: FormDataEntryValue | null) => String(v ?? "").split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
const cents = (v: FormDataEntryValue | null) => { const s = String(v ?? "").trim(); if (!s) return null; const n = Math.round(Number(s.replace(",", ".")) * 100); return Number.isFinite(n) ? n : null; };

export async function saveSoftware(_prev: { error?: string; ok?: string } | undefined, form: FormData) {
  const user = await requireUser("definicoes");
  const t = await getT();
  const id = String(form.get("id") ?? "").trim();
  const values = {
    name: String(form.get("name") ?? "").trim(),
    code: String(form.get("code") ?? "").trim().toUpperCase(),
    status: String(form.get("status") ?? "em_construcao") as "beta",
    metaAdAccountId: String(form.get("metaAdAccountId") ?? "").trim() || null,
    metaPixelId: String(form.get("metaPixelId") ?? "").trim() || null,
    githubRepos: list(form.get("githubRepos")),
    slackPrefix: String(form.get("slackPrefix") ?? "").trim() || null,
    activationDefinition: String(form.get("activationDefinition") ?? "").trim() || null,
    keyEvents: list(form.get("keyEvents")),
    cplLimitCents: cents(form.get("cplLimit")),
    costPerAccountLimitCents: cents(form.get("costLimit")),
  };
  if (!/^sw_[a-z0-9_]+$/.test(id)) return { error: t("O identificador tem de começar por sw_ e usar só minúsculas, números e _ (ex.: sw_clara).") };
  if (!values.name || !/^[A-Z]{2,5}$/.test(values.code)) return { error: t("Indica o nome e um código de 2 a 5 letras (ex.: CLA).") };
  await db.insert(schema.softwares).values({ id, ...values }).onConflictDoUpdate({ target: schema.softwares.id, set: values });
  await audit(`user:${user.sub}`, "software.saved", "software", id, null, values);
  revalidatePath("/definicoes");
  return { ok: t("{nome} guardado.", { nome: values.name }) };
}

export async function saveUser(_prev: { error?: string; ok?: string } | undefined, form: FormData) {
  const actor = await requireUser("definicoes");
  const t = await getT();
  if (actor.role !== "socio" && actor.role !== "direcao_operacoes") return { error: t("Só sócios e direção de operações gerem utilizadores.") };
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const name = String(form.get("name") ?? "").trim();
  const role = String(form.get("role") ?? "colaborador") as "colaborador";
  const password = String(form.get("password") ?? "");
  const softwares = form.getAll("softwares").map(String);
  if (!email || !name) return { error: t("Indica nome e e-mail.") };
  const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  let userId: string;
  if (existing) {
    await db.update(schema.users).set({ name, role, ...(password ? { passwordHash: await bcrypt.hash(password, 12) } : {}) }).where(eq(schema.users.id, existing.id));
    userId = existing.id;
  } else {
    if (password.length < 12) return { error: t("A palavra-passe inicial tem de ter pelo menos 12 caracteres.") };
    const [u] = await db.insert(schema.users).values({ email, name, role, passwordHash: await bcrypt.hash(password, 12) }).returning();
    userId = u.id;
  }
  await db.delete(schema.userSoftwares).where(eq(schema.userSoftwares.userId, userId));
  if (role === "colaborador" && softwares.length) await db.insert(schema.userSoftwares).values(softwares.map((s) => ({ userId, softwareId: s })));
  await audit(`user:${actor.sub}`, existing ? "user.updated" : "user.created", "user", userId, null, { email, role, softwares });
  revalidatePath("/definicoes");
  return { ok: existing ? t("{nome} atualizado.", { nome: name }) : t("{nome} criado. Envia-lhe a palavra-passe por um canal seguro.", { nome: name }) };
}

export async function toggleUser(form: FormData) {
  const actor = await requireUser("definicoes");
  if (actor.role !== "socio" && actor.role !== "direcao_operacoes") return;
  const id = String(form.get("id"));
  if (id === actor.sub) return;
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, id));
  if (!u) return;
  await db.update(schema.users).set({ active: !u.active }).where(eq(schema.users.id, id));
  await audit(`user:${actor.sub}`, u.active ? "user.disabled" : "user.enabled", "user", id);
  revalidatePath("/definicoes");
}

export async function createApiKey(_prev: { error?: string; key?: string } | undefined, form: FormData) {
  const user = await requireUser("definicoes");
  const t = await getT();
  const name = String(form.get("name") ?? "").trim();
  const scopes = form.getAll("scopes").map(String).filter((s) => (SCOPES as readonly string[]).includes(s));
  const softwareId = String(form.get("softwareId") ?? "") || null;
  const months = Math.min(12, Math.max(1, Number(form.get("months") ?? 12)));
  if (!name || !scopes.length) return { error: t("Indica um nome e pelo menos uma permissão.") };
  const { key, prefix } = generateKey();
  const expiresAt = new Date(Date.now() + months * 30 * 864e5);
  await db.insert(schema.apiKeys).values({ name, prefix, hash: hashKey(key), scopes, softwareId, expiresAt });
  await audit(`user:${user.sub}`, "apikey.created", "api_key", prefix, null, { name, scopes, softwareId, expiresAt });
  revalidatePath("/definicoes");
  return { key };
}

export async function revokeApiKey(form: FormData) {
  const user = await requireUser("definicoes");
  const id = String(form.get("id"));
  await db.update(schema.apiKeys).set({ revokedAt: new Date() }).where(eq(schema.apiKeys.id, id));
  await audit(`user:${user.sub}`, "apikey.revoked", "api_key", id);
  revalidatePath("/definicoes");
}
