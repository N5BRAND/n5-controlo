import "server-only";
import { randomBytes } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { bandFor, capBlock, daysInactive, inSendingWindow, INACTIVITY_BANDS, renderTemplate, ruleShouldFire, type BandKey } from "./engagement-rules";
import { emailConfigured, sendEmail } from "./email";
import { newId } from "./ids";
import { audit } from "./audit";

const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

type Person = typeof schema.persons.$inferSelect;
type Template = typeof schema.messageTemplates.$inferSelect;

// ---------------- Inatividade ----------------
export async function inactivityOverview(softwareIds: string[], now = new Date()) {
  if (!softwareIds.length) return { bands: [] as { software: string; counts: Record<BandKey, number> }[], people: [] };
  const people = await db.select({ p: schema.persons, org: schema.organizations.name })
    .from(schema.persons).leftJoin(schema.organizations, eq(schema.organizations.id, schema.persons.organizationId))
    .where(inArray(schema.persons.softwareId, softwareIds));
  // Pessoas de contas canceladas não entram (já não são utilizadores)
  const canceled = new Set((await db.select({ org: schema.subscriptions.organizationId, status: schema.subscriptions.status }).from(schema.subscriptions))
    .filter((s) => s.status === "canceled").map((s) => s.org));
  const active = people.filter(({ p }) => !p.organizationId || !canceled.has(p.organizationId));
  const lastMsg = await db.select({ person: schema.outboundMessages.personId, at: sql<Date>`max(${schema.outboundMessages.createdAt})` })
    .from(schema.outboundMessages).groupBy(schema.outboundMessages.personId);
  const rows = active.map(({ p, org }) => {
    const days = daysInactive(p.lastSeenAt, p.signedUpAt ?? p.createdAt, now);
    return { person: p, org, days, band: bandFor(days), lastMessageAt: lastMsg.find((m) => m.person === p.id)?.at ?? null };
  });
  const bands = softwareIds.map((sw) => {
    const counts = Object.fromEntries(INACTIVITY_BANDS.map((b) => [b.key, 0])) as Record<BandKey, number>;
    for (const r of rows.filter((x) => x.person.softwareId === sw)) if (r.band) counts[r.band]++;
    return { software: sw, counts };
  });
  return { bands, people: rows.sort((a, b) => (b.days ?? -1) - (a.days ?? -1)) };
}

// ---------------- Criar e enviar ----------------
async function historyFor(personId: string) {
  const since = new Date(Date.now() - 8 * 864e5);
  return (await db.select({ channel: schema.outboundMessages.channel, at: schema.outboundMessages.createdAt })
    .from(schema.outboundMessages)
    .where(and(eq(schema.outboundMessages.personId, personId), gte(schema.outboundMessages.createdAt, since),
      inArray(schema.outboundMessages.status, ["pendente", "enviada", "entregue", "vista", "clicada", "dispensada"]))))
    .map((h) => ({ channel: h.channel, at: h.at }));
}

async function ensureUnsubscribeToken(p: Person): Promise<string> {
  if (p.unsubscribeToken) return p.unsubscribeToken;
  const token = randomBytes(18).toString("base64url");
  await db.update(schema.persons).set({ unsubscribeToken: token }).where(eq(schema.persons.id, p.id));
  return token;
}

export interface QueueResult { id?: string; status: "pendente" | "enviada" | "bloqueada" | "falhou"; reason?: string }

/** Cria uma comunicação para uma pessoa, aplicando opt-out e limites. Envia logo se for possível. */
export async function queueMessage(p: Person, t: Template, opts: { ruleId?: number | null; actor: string; now?: Date; ignoreCaps?: boolean }): Promise<QueueResult> {
  const now = opts.now ?? new Date();
  const [sw] = await db.select().from(schema.softwares).where(eq(schema.softwares.id, p.softwareId ?? ""));
  if (!sw) return { status: "bloqueada", reason: "pessoa sem software" };
  const days = daysInactive(p.lastSeenAt, p.signedUpAt ?? p.createdAt, now);
  let block: string | null = null;
  if (t.channel === "email" && !p.email) block = "sem e-mail";
  if (t.channel === "email" && p.emailOptOut) block = "pediu para não receber e-mails";
  if (t.channel === "inapp" && p.inappOptOut) block = "desligou as mensagens na app";
  if (!block && !opts.ignoreCaps) block = capBlock(await historyFor(p.id), t.channel, now);
  const id = newId("msg");
  const vars = { nome: p.name, dias: days, software: sw.name, link: t.ctaUrl ?? "" };
  const subject = renderTemplate(t.subject, vars);
  const body = renderTemplate(t.body, vars);
  await db.insert(schema.outboundMessages).values({
    id, personId: p.id, softwareId: sw.id, ruleId: opts.ruleId ?? null, templateId: t.id, channel: t.channel, type: t.type,
    subject, body, ctaLabel: t.ctaLabel, ctaUrl: t.ctaUrl, daysInactiveAtSend: days,
    status: block ? "bloqueada" : "pendente", error: block, createdAt: now,
  });
  await audit(opts.actor, block ? "message.blocked" : "message.queued", "outbound_message", id, null, { person: p.id, template: t.id, reason: block });
  if (block) return { id, status: "bloqueada", reason: block };
  return { id, ...(await deliver(id, now)) };
}

/** In-app: fica disponível para a app ir buscar. E-mail: envia dentro do horário; fora dele fica pendente. */
async function deliver(id: string, now: Date): Promise<{ status: QueueResult["status"]; reason?: string }> {
  const [m] = await db.select().from(schema.outboundMessages).where(eq(schema.outboundMessages.id, id));
  if (!m || m.status !== "pendente") return { status: "bloqueada", reason: "já tratada" };
  if (m.channel === "inapp") {
    await db.update(schema.outboundMessages).set({ status: "enviada", sentAt: now }).where(eq(schema.outboundMessages.id, id));
    return { status: "enviada" };
  }
  if (!inSendingWindow(now)) return { status: "pendente", reason: "fora do horário de envio (09:00–20:00, segunda a sábado)" };
  const [p] = await db.select().from(schema.persons).where(eq(schema.persons.id, m.personId));
  if (!p?.email) {
    await db.update(schema.outboundMessages).set({ status: "falhou", error: "sem e-mail" }).where(eq(schema.outboundMessages.id, id));
    return { status: "falhou", reason: "sem e-mail" };
  }
  const token = await ensureUnsubscribeToken(p);
  const unsubscribeUrl = `${appUrl()}/api/unsubscribe?t=${token}`;
  const ctaLink = m.ctaUrl ? `${appUrl()}/api/r/${m.id}` : null;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#15181D;max-width:560px">
${m.body.split(/\n{2,}/).map((para) => `<p>${esc(para).replace(/\n/g, "<br>")}</p>`).join("\n")}
${ctaLink ? `<p><a href="${ctaLink}" style="display:inline-block;background:#E8A13C;color:#15181D;padding:10px 16px;border-radius:6px;text-decoration:none">${esc(m.ctaLabel ?? "Abrir")}</a></p>` : ""}
<p style="font-size:12px;color:#5E6066">Não quer receber estes e-mails? <a href="${unsubscribeUrl}">Cancelar a subscrição</a>.</p></div>`;
  const text = `${m.body}${ctaLink ? `\n\n${m.ctaLabel ?? "Abrir"}: ${ctaLink}` : ""}\n\nCancelar a subscrição: ${unsubscribeUrl}`;
  const r = await sendEmail({ to: p.email, subject: m.subject, text, html, unsubscribeUrl });
  await db.update(schema.outboundMessages).set(r.ok
    ? { status: "enviada", sentAt: now, error: r.simulated ? "simulado: SES não configurado" : null }
    : { status: "falhou", error: r.error ?? "erro no envio" }).where(eq(schema.outboundMessages.id, id));
  return r.ok ? { status: "enviada" } : { status: "falhou", reason: r.error };
}

/** Corre a cada hora: regras ativas, depois e-mails que ficaram pendentes por estarem fora do horário. */
export async function runEngagement(now = new Date()): Promise<{ evaluated: number; queued: number; blocked: number; sent: number }> {
  let queued = 0, blocked = 0, sent = 0;
  const rules = await db.select({ r: schema.engagementRules, t: schema.messageTemplates })
    .from(schema.engagementRules).innerJoin(schema.messageTemplates, eq(schema.messageTemplates.id, schema.engagementRules.templateId))
    .where(and(eq(schema.engagementRules.active, true), eq(schema.messageTemplates.active, true)));
  const canceled = new Set((await db.select().from(schema.subscriptions)).filter((s) => s.status === "canceled").map((s) => s.organizationId));
  for (const { r, t } of rules) {
    const conds = [];
    if (r.softwareId) conds.push(eq(schema.persons.softwareId, r.softwareId));
    if (r.audience !== "todos") conds.push(eq(schema.persons.origin, r.audience));
    const people = await db.select().from(schema.persons).where(conds.length ? and(...conds) : undefined);
    // Envios desta regra que contam (os bloqueados voltam a ser tentados, no máximo uma vez por dia)
    const lastFromRule = await db.select({
      person: schema.outboundMessages.personId,
      at: sql<Date>`max(${schema.outboundMessages.createdAt}) filter (where ${schema.outboundMessages.status} <> 'bloqueada')`,
      blockedAt: sql<Date>`max(${schema.outboundMessages.createdAt}) filter (where ${schema.outboundMessages.status} = 'bloqueada')`,
    }).from(schema.outboundMessages).where(eq(schema.outboundMessages.ruleId, r.id)).groupBy(schema.outboundMessages.personId);
    for (const p of people) {
      if (p.organizationId && canceled.has(p.organizationId)) continue;
      const days = daysInactive(p.lastSeenAt, p.signedUpAt ?? p.createdAt, now);
      const rec = lastFromRule.find((l) => l.person === p.id);
      const last = rec?.at ?? null;
      if (!ruleShouldFire(days, r.inactiveDays, p.lastSeenAt, last ? new Date(last) : null)) continue;
      if (rec?.blockedAt && now.getTime() - new Date(rec.blockedAt).getTime() < 864e5) continue;
      const res = await queueMessage(p, t, { ruleId: r.id, actor: `rule:${r.id}`, now });
      if (res.status === "bloqueada") blocked++; else queued++;
      if (res.status === "enviada") sent++;
    }
  }
  const pending = await db.select({ id: schema.outboundMessages.id }).from(schema.outboundMessages)
    .where(and(eq(schema.outboundMessages.status, "pendente"), eq(schema.outboundMessages.channel, "email")));
  for (const m of pending) if ((await deliver(m.id, now)).status === "enviada") sent++;
  return { evaluated: rules.length, queued, blocked, sent };
}

// ---------------- Ligação aos eventos de produto ----------------
/** Atualiza a última utilização e marca o regresso de quem recebeu uma comunicação nos 7 dias anteriores. */
export async function recordActivity(personId: string, at: Date) {
  await db.update(schema.persons).set({ lastSeenAt: at })
    .where(and(eq(schema.persons.id, personId), sql`(${schema.persons.lastSeenAt} is null or ${schema.persons.lastSeenAt} < ${at.toISOString()})`));
  const weekBefore = new Date(at.getTime() - 7 * 864e5);
  await db.update(schema.outboundMessages).set({ returnedAt: at })
    .where(and(eq(schema.outboundMessages.personId, personId), isNull(schema.outboundMessages.returnedAt),
      sql`${schema.outboundMessages.sentAt} is not null and ${schema.outboundMessages.sentAt} >= ${weekBefore.toISOString()} and ${schema.outboundMessages.sentAt} <= ${at.toISOString()}`));
}

// ---------------- Resultados ----------------
export async function messageStats(softwareIds: string[], since: Date) {
  if (!softwareIds.length) return { byRule: [], totals: null };
  const msgs = await db.select().from(schema.outboundMessages)
    .where(and(inArray(schema.outboundMessages.softwareId, softwareIds), gte(schema.outboundMessages.createdAt, since)));
  const rules = await db.select().from(schema.engagementRules);
  const sentLike = (m: typeof msgs[number]) => !!m.sentAt;
  const summarize = (list: typeof msgs) => {
    const sent = list.filter(sentLike);
    return {
      total: list.length, sent: sent.length, blocked: list.filter((m) => m.status === "bloqueada").length,
      failed: list.filter((m) => m.status === "falhou").length,
      seen: sent.filter((m) => m.seenAt).length, clicked: sent.filter((m) => m.clickedAt).length,
      returned: sent.filter((m) => m.returnedAt).length,
    };
  };
  const ids = [...new Set(msgs.map((m) => m.ruleId))];
  return {
    totals: summarize(msgs),
    byRule: ids.map((id) => ({ ruleId: id, name: id === null ? "Envios manuais" : rules.find((r) => r.id === id)?.name ?? `Regra ${id}`, ...summarize(msgs.filter((m) => m.ruleId === id)) }))
      .sort((a, b) => b.sent - a.sent),
  };
}

export async function recentMessages(softwareIds: string[], limit = 200) {
  if (!softwareIds.length) return [];
  return db.select({ m: schema.outboundMessages, person: schema.persons.name, email: schema.persons.email })
    .from(schema.outboundMessages).innerJoin(schema.persons, eq(schema.persons.id, schema.outboundMessages.personId))
    .where(inArray(schema.outboundMessages.softwareId, softwareIds)).orderBy(desc(schema.outboundMessages.createdAt)).limit(limit);
}

export { emailConfigured };
