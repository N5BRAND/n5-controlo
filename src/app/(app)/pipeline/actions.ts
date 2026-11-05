"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { allowedSoftware, requireUser } from "@/lib/auth";
import { nextRoadmapCode, phaseGuard, syncFeedbackWithItem } from "@/lib/core";
import { audit } from "@/lib/audit";
import { PHASES } from "@/lib/phases";
import { postSlackMessage } from "@/lib/slack";
import { getT } from "@/lib/i18n/server";

type Phase = typeof schema.roadmapItems.$inferSelect.phase;

type Priority = typeof schema.roadmapItems.$inferSelect.priority;

const PRIORITIES: Priority[] = ["urgente", "alta", "normal", "baixa"];
const priority = (v: FormDataEntryValue | null, fallback: Priority = "normal"): Priority => (PRIORITIES.includes(v as Priority) ? (v as Priority) : fallback);

function dueDate(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function int(v: FormDataEntryValue | null, fallback: number) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }

export async function createItem(form: FormData) {
  const user = await requireUser("pipeline");
  const softwareId = String(form.get("softwareId"));
  if (!allowedSoftware(user, softwareId)) throw new Error("Sem acesso a este software.");
  const code = await nextRoadmapCode(softwareId);
  const [row] = await db.insert(schema.roadmapItems).values({
    code, softwareId, title: String(form.get("title") ?? "").trim(), description: String(form.get("description") ?? "") || null,
    origin: (String(form.get("origin") ?? "equipa")) as "equipa", impact: int(form.get("impact"), 1), reach: int(form.get("reach"), 0),
    confidence: int(form.get("confidence"), 50), effort: Math.max(1, int(form.get("effort"), 1)),
    dueDate: dueDate(form.get("dueDate")),
    priority: priority(form.get("priority")),
    ownerUserId: String(form.get("owner") ?? "") || null,
  }).returning();
  await audit(`user:${user.sub}`, "roadmap.created", "roadmap_item", row.id, null, row);
  redirect(`/pipeline/${row.id}`);
}

export async function updateItem(id: number, _prev: { error?: string; ok?: boolean } | undefined, form: FormData): Promise<{ error?: string; ok?: boolean }> {
  const user = await requireUser("pipeline");
  const [before] = await db.select().from(schema.roadmapItems).where(eq(schema.roadmapItems.id, id));
  if (!before || !allowedSoftware(user, before.softwareId)) return { error: (await getT())("Sem acesso a este item.") };
  const next = {
    title: String(form.get("title") ?? before.title).trim(),
    description: String(form.get("description") ?? "") || null,
    impact: int(form.get("impact"), before.impact), reach: int(form.get("reach"), before.reach),
    confidence: int(form.get("confidence"), before.confidence), effort: Math.max(1, int(form.get("effort"), before.effort)),
    ownerUserId: String(form.get("owner") ?? "") || null,
    agent: form.get("agent") === "on",
    acceptanceCriteria: String(form.get("acceptanceCriteria") ?? "") || null,
    productEvents: String(form.get("productEvents") ?? "").split(/[,\n]/).map((s) => s.trim()).filter(Boolean),
    sprint: String(form.get("sprint") ?? "") || null,
    version: String(form.get("version") ?? "") || null,
    dueDate: dueDate(form.get("dueDate")),
    priority: priority(form.get("priority"), before.priority),
  };
  const phase = String(form.get("phase") ?? before.phase) as Phase;
  if (phase !== before.phase) {
    const err = phaseGuard(next, phase);
    if (err) return { error: err };
  }
  await db.update(schema.roadmapItems).set({ ...next, phase, updatedAt: new Date(), ...(phase !== before.phase ? { phaseChangedAt: new Date() } : {}) })
    .where(eq(schema.roadmapItems.id, id));
  // Histórico: só os campos que mudaram, com o valor antes e depois
  const afterValues: Record<string, unknown> = { ...next, phase };
  const changedBefore: Record<string, unknown> = {};
  const changedAfter: Record<string, unknown> = {};
  for (const k of Object.keys(afterValues)) {
    const b = (before as Record<string, unknown>)[k];
    const a = afterValues[k];
    if (JSON.stringify(b ?? null) !== JSON.stringify(a ?? null)) { changedBefore[k] = b ?? null; changedAfter[k] = a ?? null; }
  }
  if (Object.keys(changedAfter).length) await audit(`user:${user.sub}`, "roadmap.updated", "roadmap_item", id, changedBefore, changedAfter);
  if (phase !== before.phase) await syncFeedbackWithItem(id, phase, `user:${user.sub}`);
  revalidatePath(`/pipeline/${id}`);
  return { ok: true };
}

/** Arrastar uma tarefa no quadro: muda a fase com as mesmas regras do formulário da tarefa. */
export async function moveItem(id: number, to: string): Promise<{ error?: string }> {
  const user = await requireUser("pipeline");
  if (!PHASES.includes(to as Phase)) return { error: (await getT())("Fase inválida.") };
  const phase = to as Phase;
  const [before] = await db.select().from(schema.roadmapItems).where(eq(schema.roadmapItems.id, id));
  if (!before || !allowedSoftware(user, before.softwareId)) return { error: (await getT())("Sem acesso a este item.") };
  if (before.phase === phase) return {};
  const err = phaseGuard(before, phase);
  if (err) return { error: err };
  const now = new Date();
  await db.update(schema.roadmapItems).set({ phase, phaseChangedAt: now, updatedAt: now }).where(eq(schema.roadmapItems.id, id));
  await audit(`user:${user.sub}`, "roadmap.moved", "roadmap_item", id, { phase: before.phase }, { phase });
  await syncFeedbackWithItem(id, phase, `user:${user.sub}`);
  revalidatePath("/pipeline");
  return {};
}

/** Trocar o responsável a partir do cartão. Em Desenvolvimento ou mais à frente a tarefa não pode ficar sem responsável. */
export async function setOwner(id: number, ownerUserId: string | null): Promise<{ error?: string }> {
  const user = await requireUser("pipeline");
  const [before] = await db.select().from(schema.roadmapItems).where(eq(schema.roadmapItems.id, id));
  if (!before || !allowedSoftware(user, before.softwareId)) return { error: (await getT())("Sem acesso a este item.") };
  if (ownerUserId) {
    const [member] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, ownerUserId));
    if (!member) return { error: (await getT())("Pessoa desconhecida.") };
  }
  const err = phaseGuard({ ...before, ownerUserId }, before.phase);
  if (err) return { error: err.replace("Para entrar em", "Para estar em") };
  if (before.ownerUserId === ownerUserId) return {};
  await db.update(schema.roadmapItems).set({ ownerUserId, updatedAt: new Date() }).where(eq(schema.roadmapItems.id, id));
  await audit(`user:${user.sub}`, "roadmap.owner", "roadmap_item", id, { ownerUserId: before.ownerUserId }, { ownerUserId });
  revalidatePath("/pipeline");
  return {};
}

/** Mudar o vencimento a partir do cartão. */
export async function setDueDate(id: number, value: string | null): Promise<{ error?: string }> {
  const user = await requireUser("pipeline");
  const [before] = await db.select().from(schema.roadmapItems).where(eq(schema.roadmapItems.id, id));
  if (!before || !allowedSoftware(user, before.softwareId)) return { error: (await getT())("Sem acesso a este item.") };
  const next = value === null ? null : dueDate(value);
  if (value !== null && !next) return { error: (await getT())("Data inválida.") };
  if (before.dueDate === next) return {};
  await db.update(schema.roadmapItems).set({ dueDate: next, updatedAt: new Date() }).where(eq(schema.roadmapItems.id, id));
  await audit(`user:${user.sub}`, "roadmap.due", "roadmap_item", id, { dueDate: before.dueDate }, { dueDate: next });
  revalidatePath("/pipeline");
  return {};
}

/** Mudar a prioridade a partir do cartão. */
export async function setPriority(id: number, value: string): Promise<{ error?: string }> {
  const user = await requireUser("pipeline");
  if (!PRIORITIES.includes(value as Priority)) return { error: (await getT())("Prioridade inválida.") };
  const [before] = await db.select().from(schema.roadmapItems).where(eq(schema.roadmapItems.id, id));
  if (!before || !allowedSoftware(user, before.softwareId)) return { error: (await getT())("Sem acesso a este item.") };
  if (before.priority === value) return {};
  await db.update(schema.roadmapItems).set({ priority: value as Priority, updatedAt: new Date() }).where(eq(schema.roadmapItems.id, id));
  await audit(`user:${user.sub}`, "roadmap.priority", "roadmap_item", id, { priority: before.priority }, { priority: value });
  revalidatePath("/pipeline");
  return {};
}

/** Apagar uma tarefa. O retrato completo fica no histórico; comentários vão com ela; feedback e PRs ligados ficam sem ligação. */
export async function deleteItem(id: number): Promise<{ error?: string }> {
  const user = await requireUser("pipeline");
  const [before] = await db.select().from(schema.roadmapItems).where(eq(schema.roadmapItems.id, id));
  if (!before || !allowedSoftware(user, before.softwareId)) return { error: (await getT())("Sem acesso a este item.") };
  await db.transaction(async (tx) => {
    await tx.insert(schema.auditLog).values({ actor: `user:${user.sub}`, action: "roadmap.deleted", entity: "roadmap_item", entityId: String(id), before, after: null });
    await tx.update(schema.feedback).set({ roadmapItemId: null }).where(eq(schema.feedback.roadmapItemId, id));
    await tx.update(schema.pullRequests).set({ roadmapItemId: null }).where(eq(schema.pullRequests.roadmapItemId, id));
    await tx.delete(schema.roadmapItems).where(eq(schema.roadmapItems.id, id));
  });
  revalidatePath("/pipeline");
  return {};
}

export async function addComment(itemId: number, _prev: { error?: string; ok?: boolean } | undefined, form: FormData): Promise<{ error?: string; ok?: boolean }> {
  const user = await requireUser("pipeline");
  const body = String(form.get("body") ?? "").trim();
  if (!body) return { error: (await getT())("Escreve o comentário.") };
  if (body.length > 4000) return { error: (await getT())("O comentário tem mais de 4000 caracteres.") };
  const [item] = await db.select().from(schema.roadmapItems).where(eq(schema.roadmapItems.id, itemId));
  if (!item || !allowedSoftware(user, item.softwareId)) return { error: (await getT())("Sem acesso a este item.") };
  const [row] = await db.insert(schema.roadmapComments).values({ itemId, userId: user.sub, body }).returning();
  await audit(`user:${user.sub}`, "roadmap.commented", "roadmap_item", itemId, null, { commentId: row.id, body: body.slice(0, 300) });
  revalidatePath(`/pipeline/${itemId}`);
  revalidatePath("/pipeline");
  return { ok: true };
}

export async function saveRelease(form: FormData) {
  const user = await requireUser("pipeline");
  if (user.role === "colaborador") throw new Error("Sem acesso.");
  const softwareId = String(form.get("softwareId"));
  if (!allowedSoftware(user, softwareId)) throw new Error("Sem acesso a este software.");
  const version = String(form.get("version") ?? "").trim();
  // Changelog proposto a partir dos itens desta versão; a pessoa revê antes de publicar
  const items = await db.select().from(schema.roadmapItems).where(eq(schema.roadmapItems.softwareId, softwareId));
  const included = items.filter((i) => i.version === version);
  const notes = String(form.get("notes") ?? "").trim() || included.map((i) => `• ${i.title}`).join("\n");
  await db.insert(schema.releases).values({ softwareId, version, notes })
    .onConflictDoUpdate({ target: [schema.releases.softwareId, schema.releases.version], set: { notes } });
  await audit(`user:${user.sub}`, "release.saved", "release", `${softwareId}:${version}`);
  revalidatePath("/pipeline");
}

export async function publishRelease(form: FormData) {
  const user = await requireUser("pipeline");
  if (user.role === "colaborador") throw new Error("Sem acesso.");
  const id = Number(form.get("id"));
  const [rel] = await db.select().from(schema.releases).where(eq(schema.releases.id, id));
  if (!rel || !allowedSoftware(user, rel.softwareId)) throw new Error("Sem acesso.");
  const [sw] = await db.select().from(schema.softwares).where(eq(schema.softwares.id, rel.softwareId));
  const now = new Date();
  const channel = `${sw?.slackPrefix ?? sw?.code.toLowerCase()}-novidades`;
  const posted = await postSlackMessage(channel, `*${sw?.name} ${rel.version}* já está disponível.\n${rel.notes}`);
  await db.update(schema.releases).set({ publishedAt: rel.publishedAt ?? now, slackPostedAt: posted ? now : null }).where(eq(schema.releases.id, id));
  // As tarefas não mudam de fase ao publicar: o Pipeline é gerido à mão.
  await audit(`user:${user.sub}`, "release.published", "release", id);
  revalidatePath("/pipeline");
}

export async function saveProviderCost(form: FormData) {
  const user = await requireUser("custos");
  const softwareId = String(form.get("softwareId"));
  const month = String(form.get("month"));
  const provider = String(form.get("provider")).trim().toLowerCase();
  const costCents = Math.round(Number(String(form.get("cost")).replace(",", ".")) * 100);
  if (!/^\d{4}-\d{2}$/.test(month) || !provider || !Number.isFinite(costCents)) throw new Error("Dados inválidos.");
  await db.insert(schema.providerCosts).values({ softwareId, month, provider, costCents })
    .onConflictDoUpdate({ target: [schema.providerCosts.softwareId, schema.providerCosts.month, schema.providerCosts.provider], set: { costCents } });
  await audit(`user:${user.sub}`, "cost.saved", "provider_cost", `${softwareId}:${month}:${provider}`);
  revalidatePath("/pipeline");
}
