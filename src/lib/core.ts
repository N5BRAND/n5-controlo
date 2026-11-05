import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { monthKey } from "./metrics";
import { raiseAlert } from "./alerts";
import { postSlackMessage } from "./slack";
import { audit } from "./audit";
import { LABELS } from "./format";
import { ACTIVE_PHASES, EVENTS_REQUIRED_PHASES, OWNER_REQUIRED_PHASES, type Phase } from "./phases";
import { newId } from "./ids";
import { recordActivity } from "./engagement";

export { newId } from "./ids";

// ---------------- Eventos de produto ----------------
export const eventSchema = z.object({
  id: z.string().min(4).max(80),
  software: z.string().min(3),
  name: z.string().regex(/^[a-z0-9_]+(\.[a-z0-9_]+)+$/, "nome no formato area.acao"),
  occurred_at: z.iso.datetime({ offset: true }),
  person: z.string().optional(),
  organization: z.string().optional(),
  session: z.string().optional(),
  feature: z.string().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
});
export type EventInput = z.infer<typeof eventSchema>;

const STANDARD_EVENTS = new Set([
  "session.started", "session.heartbeat", "feature.used", "account.signed_up", "account.activated",
  "member.invited", "member.joined", "integration.connected", "integration.failed",
  // Módulo Impacto
  "task.completed", "lead.received", "lead.first_response", "visit.scheduled", "deal.closed", "account.profile_updated",
]);

export interface BatchResult { accepted: number; duplicates: number; rejected: { id?: string; error: string }[] }

export async function ingestEvents(items: unknown[], restrictSoftware: string | null): Promise<BatchResult> {
  const result: BatchResult = { accepted: 0, duplicates: 0, rejected: [] };
  const lastByPersonOut = new Map<string, Date>();
  const sws = await db.select().from(schema.softwares);
  const valid: EventInput[] = [];
  for (const raw of items) {
    const p = eventSchema.safeParse(raw);
    if (!p.success) { result.rejected.push({ id: (raw as { id?: string })?.id, error: p.error.issues[0]?.message ?? "inválido" }); continue; }
    const e = p.data;
    const sw = sws.find((s) => s.id === e.software);
    if (!sw) { result.rejected.push({ id: e.id, error: `software desconhecido: ${e.software}` }); continue; }
    if (restrictSoftware && restrictSoftware !== e.software) { result.rejected.push({ id: e.id, error: "a chave não pode enviar eventos deste software" }); continue; }
    if (!STANDARD_EVENTS.has(e.name) && !sw.keyEvents.includes(e.name)) {
      result.rejected.push({ id: e.id, error: `evento não declarado nas definições do software: ${e.name}` }); continue;
    }
    valid.push(e);
  }
  if (valid.length) {
    const inserted = await db.insert(schema.productEvents).values(valid.map((e) => ({
      id: e.id, softwareId: e.software, name: e.name, occurredAt: new Date(e.occurred_at),
      personId: e.person ?? null, organizationId: e.organization ?? null, sessionId: e.session ?? null,
      feature: e.feature ?? null, properties: e.properties ?? null,
    }))).onConflictDoNothing().returning({ id: schema.productEvents.id });
    result.accepted = inserted.length;
    result.duplicates = valid.length - inserted.length;
    // Efeitos laterais dos eventos padrão
    const insertedIds = new Set(inserted.map((r) => r.id));
    // Última utilização por pessoa (módulo Reativação)
    for (const e of valid.filter((v) => insertedIds.has(v.id) && v.person)) {
      const at = new Date(e.occurred_at);
      if (!lastByPersonOut.has(e.person!) || lastByPersonOut.get(e.person!)! < at) lastByPersonOut.set(e.person!, at);
    }
    for (const e of valid.filter((v) => insertedIds.has(v.id))) {
      if (e.name === "account.activated" && e.person) {
        await db.update(schema.persons).set({ activatedAt: new Date(e.occurred_at) })
          .where(and(eq(schema.persons.id, e.person), sql`${schema.persons.activatedAt} is null`));
      }
      if (e.name === "account.signed_up" && e.person) {
        const props = (e.properties ?? {}) as Record<string, string | undefined>;
        await db.insert(schema.persons).values({
          id: e.person, organizationId: e.organization ?? null, softwareId: e.software, origin: "trial",
          signedUpAt: new Date(e.occurred_at),
          attribution: {
            fbclid: props.fbclid, utm_source: props.utm_source, utm_medium: props.utm_medium,
            utm_campaign: props.utm_campaign, utm_content: props.utm_content,
            first_campaign: props.utm_campaign, last_campaign: props.utm_campaign,
          },
        }).onConflictDoNothing();
      }
      if (e.name === "account.profile_updated" && e.organization) {
        // Perfil do onboarding (módulo Impacto): faturação média e horas de trabalho, para o valor da hora da conta
        const pr = (e.properties ?? {}) as Record<string, unknown>;
        const n = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
        const monthly = isFinite(n(pr.avg_monthly_revenue_eur)) ? n(pr.avg_monthly_revenue_eur) : isFinite(n(pr.annual_revenue_eur)) ? n(pr.annual_revenue_eur) / 12 : NaN;
        const hours = n(pr.weekly_hours);
        const values = {
          avgMonthlyRevenueCents: isFinite(monthly) && monthly > 0 ? Math.round(monthly * 100) : null,
          weeklyHours: isFinite(hours) && hours > 0 && hours <= 100 ? hours.toFixed(1) : null,
          updatedAt: new Date(e.occurred_at),
        };
        await db.insert(schema.accountProfiles).values({ organizationId: e.organization, softwareId: e.software, ...values })
          .onConflictDoUpdate({ target: [schema.accountProfiles.organizationId, schema.accountProfiles.softwareId], set: values });
      }
      if (e.name === "integration.failed") {
        await raiseAlert({ module: "sistema", softwareId: e.software, severity: "aviso",
          title: `Integração com erro: ${String(e.properties?.integration ?? "desconhecida")}`,
          detail: `Conta ${e.organization ?? "?"}`, dedupeKey: `integracao:${e.organization}:${String(e.properties?.integration)}` });
      }
    }
  }
  for (const [person, at] of lastByPersonOut) await recordActivity(person, at);
  return result;
}

// ---------------- Registo de consumo ----------------
export const usageSchema = z.object({
  id: z.string().min(4).max(80),
  software: z.string(),
  organization: z.string(),
  person: z.string().optional(),
  unit: z.string().regex(/^[a-z0-9_.]+$/),
  quantity: z.number().nonnegative(),
  cost_usd: z.number().nonnegative(),
  provider: z.string(),
  provider_ref: z.string().optional(),
  occurred_at: z.iso.datetime({ offset: true }),
  billable: z.boolean().default(true),
});

export async function ingestUsage(items: unknown[], restrictSoftware: string | null): Promise<BatchResult> {
  const result: BatchResult = { accepted: 0, duplicates: 0, rejected: [] };
  const rows = [];
  for (const raw of items) {
    const p = usageSchema.safeParse(raw);
    if (!p.success) { result.rejected.push({ id: (raw as { id?: string })?.id, error: p.error.issues[0]?.message ?? "inválido" }); continue; }
    const u = p.data;
    if (restrictSoftware && restrictSoftware !== u.software) { result.rejected.push({ id: u.id, error: "a chave não pode registar consumo deste software" }); continue; }
    rows.push({
      id: u.id, softwareId: u.software, organizationId: u.organization, personId: u.person ?? null, unit: u.unit,
      quantity: String(u.quantity), costUsd: u.cost_usd.toFixed(6), provider: u.provider,
      providerRef: u.provider_ref ?? null, billable: u.billable, occurredAt: new Date(u.occurred_at),
    });
  }
  if (rows.length) {
    const inserted = await db.insert(schema.usageRecords).values(rows).onConflictDoNothing().returning({ id: schema.usageRecords.id });
    result.accepted = inserted.length;
    result.duplicates = rows.length - inserted.length;
  }
  return result;
}

// ---------------- Direitos (incluído, usado, restante) ----------------
// Unidades que contam para os minutos e para as leads incluídos no plano
const MINUTE_UNITS = ["call.forward.minute"];
const LEAD_UNITS = ["lead.conversation"];

export async function entitlements(orgId: string, softwareId: string, now = new Date()) {
  const [sub] = await db.select().from(schema.subscriptions)
    .where(and(eq(schema.subscriptions.organizationId, orgId), eq(schema.subscriptions.softwareId, softwareId),
      inArray(schema.subscriptions.status, ["active", "trialing", "past_due"])));
  if (!sub) return { active: false as const, reason: "sem subscrição ativa" };
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const used = await db.select({ unit: schema.usageRecords.unit, q: sql<number>`sum(${schema.usageRecords.quantity})::float` })
    .from(schema.usageRecords)
    .where(and(eq(schema.usageRecords.organizationId, orgId), eq(schema.usageRecords.softwareId, softwareId),
      eq(schema.usageRecords.billable, true), sql`${schema.usageRecords.occurredAt} >= ${monthStart.toISOString()}`))
    .groupBy(schema.usageRecords.unit);
  const sum = (units: string[]) => used.filter((u) => units.includes(u.unit)).reduce((a, u) => a + u.q, 0);
  const minutesUsed = sum(MINUTE_UNITS), leadsUsed = sum(LEAD_UNITS);
  const over = minutesUsed > sub.includedMinutes || leadsUsed > sub.includedLeads;
  const blocked = over && sub.extraLimitCents === 0;
  return {
    active: true as const,
    plan: sub.plan,
    status: sub.status,
    minutes: { included: sub.includedMinutes, used: Math.round(minutesUsed * 10) / 10, remaining: Math.max(0, sub.includedMinutes - minutesUsed) },
    leads: { included: sub.includedLeads, used: leadsUsed, remaining: Math.max(0, sub.includedLeads - leadsUsed) },
    extra_allowed: sub.extraLimitCents === null || sub.extraLimitCents > 0,
    can_continue: !blocked,
    period_start: monthStart.toISOString(),
  };
}

// ---------------- MRR mensal ----------------
/** Grava o MRR de cada conta no mês corrente (corre todos os dias; o mês fecha sozinho). */
export async function snapshotMrr(now = new Date()): Promise<number> {
  const month = monthKey(now);
  const subs = await db.select().from(schema.subscriptions)
    .where(inArray(schema.subscriptions.status, ["active", "past_due"]));
  const totals = new Map<string, { org: string; sw: string; cents: number }>();
  for (const s of subs) {
    const k = `${s.organizationId}|${s.softwareId}`;
    const t = totals.get(k) ?? { org: s.organizationId, sw: s.softwareId, cents: 0 };
    t.cents += s.mrrCents;
    totals.set(k, t);
  }
  // Contas que deixaram de pagar ficam a zero neste mês (para o churn aparecer)
  const existing = await db.select().from(schema.mrrMonthly).where(eq(schema.mrrMonthly.month, month));
  for (const e of existing) {
    const k = `${e.organizationId}|${e.softwareId}`;
    if (!totals.has(k)) totals.set(k, { org: e.organizationId, sw: e.softwareId, cents: 0 });
  }
  for (const t of totals.values()) {
    await db.insert(schema.mrrMonthly).values({ organizationId: t.org, softwareId: t.sw, month, mrrCents: t.cents })
      .onConflictDoUpdate({ target: [schema.mrrMonthly.organizationId, schema.mrrMonthly.softwareId, schema.mrrMonthly.month], set: { mrrCents: t.cents } });
  }
  return totals.size;
}

// ---------------- Feedback ----------------
export interface NewFeedback {
  softwareId: string; type: "sugestao" | "bug" | "funciona_bem" | "funciona_mal"; text: string; title?: string;
  feature?: string | null; severity?: "critico" | "alto" | "medio" | "baixo" | null;
  authorName?: string | null; authorSlackId?: string | null; authorPersonId?: string | null;
  origin?: "pagante" | "beta" | "trial" | null; slackChannel?: string | null; slackTs?: string | null;
}

export async function createFeedback(f: NewFeedback, actor: string) {
  const id = newId("fb");
  const title = f.title?.trim() || f.text.trim().split(/\n|\. /)[0].slice(0, 90);
  const [row] = await db.insert(schema.feedback).values({
    id, softwareId: f.softwareId, type: f.type, title, text: f.text, feature: f.feature ?? null,
    severity: f.type === "bug" ? (f.severity ?? "medio") : null, authorName: f.authorName ?? null,
    authorSlackId: f.authorSlackId ?? null, authorPersonId: f.authorPersonId ?? null, origin: f.origin ?? null,
    slackChannel: f.slackChannel ?? null, slackTs: f.slackTs ?? null,
  }).returning();
  await audit(actor, "feedback.created", "feedback", id, null, row);
  if (row.type === "bug" && row.severity === "critico") {
    await raiseAlert({ module: "comunidades", softwareId: row.softwareId, severity: "critico",
      title: `Bug crítico: ${row.title}`, detail: row.text.slice(0, 300), dedupeKey: `bug-critico:${row.id}` });
    if (row.slackChannel) {
      await postSlackMessage(row.slackChannel, "Recebemos este erro e já está com a equipa. Damos notícias aqui.", row.slackTs ?? undefined);
      await db.update(schema.feedback).set({ firstResponseAt: new Date() }).where(eq(schema.feedback.id, row.id));
    }
  }
  return row;
}

const NOTIFY_STATUSES = new Set(["planeado", "lancado", "recusado"]);

/** Muda o estado de um feedback e responde na conversa do Slack quando o estado interessa ao autor. */
export async function setFeedbackStatus(id: string, status: typeof schema.feedback.$inferSelect.status, actor: string, extra: { refusalReason?: string; roadmapItemId?: number | null; duplicateOfId?: string } = {}) {
  const [before] = await db.select().from(schema.feedback).where(eq(schema.feedback.id, id));
  if (!before) throw new Error("Feedback não encontrado");
  if (status === "recusado" && !extra.refusalReason?.trim()) throw new Error("Recusar exige um motivo.");
  if (status === "duplicado" && !extra.duplicateOfId) throw new Error("Indica o feedback original.");
  const [after] = await db.update(schema.feedback).set({
    status, updatedAt: new Date(), refusalReason: extra.refusalReason ?? before.refusalReason,
    roadmapItemId: extra.roadmapItemId === undefined ? before.roadmapItemId : extra.roadmapItemId,
    duplicateOfId: extra.duplicateOfId ?? before.duplicateOfId,
    firstResponseAt: before.firstResponseAt ?? (status !== "recebido" ? new Date() : null),
  }).where(eq(schema.feedback.id, id)).returning();
  if (status === "duplicado" && extra.duplicateOfId) {
    await db.update(schema.feedback).set({ votes: sql`${schema.feedback.votes} + ${before.votes}` })
      .where(eq(schema.feedback.id, extra.duplicateOfId));
  }
  await audit(actor, "feedback.status", "feedback", id, { status: before.status }, { status });
  if (NOTIFY_STATUSES.has(status) && after.slackChannel) {
    const msg = status === "recusado"
      ? `Obrigado pela sugestão. Decidimos não avançar: ${after.refusalReason}`
      : `Atualização: ${LABELS.feedbackStatus[status]}.`;
    await postSlackMessage(after.slackChannel, msg, after.slackTs ?? undefined);
  }
  return after;
}

// ---------------- Roadmap ----------------
export async function nextRoadmapCode(softwareId: string): Promise<string> {
  const [sw] = await db.select().from(schema.softwares).where(eq(schema.softwares.id, softwareId));
  if (!sw) throw new Error("Software desconhecido");
  // Maior número já usado neste software, incluindo as tarefas apagadas (ficam no histórico): um código apagado nunca se reutiliza
  const rows = await db.execute(sql`
    select coalesce(max(n), 0)::int as n from (
      select (regexp_replace(code, '^.*-', ''))::int as n from roadmap_items where software_id = ${softwareId} and code ~ '-[0-9]+$'
      union all
      select (regexp_replace(after->>'code', '^.*-', ''))::int as n from audit_log
        where entity = 'roadmap_item' and action = 'roadmap.created' and after->>'softwareId' = ${softwareId} and after->>'code' ~ '-[0-9]+$'
    ) used`);
  const used = Number((rows as unknown as { n: number }[])[0]?.n ?? 0);
  return `${sw.code}-${used + 1}`;
}


/** Valida as regras de mudança de fase do Pipeline. Devolve a mensagem de erro, ou null se pode avançar. */
export function phaseGuard(item: { ownerUserId: string | null; acceptanceCriteria: string | null; productEvents: string[] }, to: Phase): string | null {
  if (OWNER_REQUIRED_PHASES.includes(to)) {
    if (!item.ownerUserId) return `Para entrar em ${LABELS.phase[to]} o item precisa de dono.`;
    if (!item.acceptanceCriteria?.trim()) return `Para entrar em ${LABELS.phase[to]} o item precisa de critérios de aceitação.`;
  }
  if (EVENTS_REQUIRED_PHASES.includes(to) && item.productEvents.length === 0) {
    return `Antes de ${LABELS.phase[to]} o item tem de declarar os eventos de produto que vai enviar.`;
  }
  return null;
}

/** Quando um item muda de fase, os feedbacks ligados acompanham (Comunidades, regras 4 e 5). */
export async function syncFeedbackWithItem(itemId: number, phase: Phase, actor: string) {
  const linked = await db.select().from(schema.feedback).where(eq(schema.feedback.roadmapItemId, itemId));
  const target = phase === "done" ? "lancado" : ACTIVE_PHASES.includes(phase) ? "em_desenvolvimento" : null;
  if (!target) return;
  for (const f of linked) {
    if (f.status !== target && f.status !== "recusado" && f.status !== "duplicado") {
      await setFeedbackStatus(f.id, target, actor);
    }
  }
}
