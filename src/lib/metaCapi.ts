import "server-only";
import { and, eq, lt } from "drizzle-orm";
import { db, schema } from "@/db";
import {
  consentExpiry, emailHash, isPaidCheckout, paymentLinks, purchaseEvent,
  type MetaEvent, type StripeCheckoutSession,
} from "@/lib/conversions";
import { adRef } from "@/lib/metrics";

// API de Conversões da Meta: envio dos eventos e consentimentos guardados.
// META_CAPI_TOKEN: token gerado no Gestor de Eventos (conjunto de dados › Definições › API de Conversões).
// META_PIXEL_ID: o conjunto de dados (predefinido: Nº5). META_CAPI_TEST_CODE: código de «Testar eventos», só para testes.

const DEFAULT_PIXEL_ID = "2268439390668297"; // conjunto de dados «Nº5»

export function capiConfigured(): boolean {
  return !!process.env.META_CAPI_TOKEN;
}

export async function sendToMeta(events: MetaEvent[]): Promise<{ eventsReceived: number }> {
  const token = process.env.META_CAPI_TOKEN;
  if (!token) throw new Error("META_CAPI_TOKEN não configurado");
  const pixel = process.env.META_PIXEL_ID || DEFAULT_PIXEL_ID;
  const version = process.env.META_API_VERSION || "v26.0";
  const body: Record<string, unknown> = { data: events, access_token: token };
  if (process.env.META_CAPI_TEST_CODE) body.test_event_code = process.env.META_CAPI_TEST_CODE;
  const res = await fetch(`https://graph.facebook.com/${version}/${pixel}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { events_received?: number; error?: { message?: string } };
  if (!res.ok || json.error) throw new Error(`Meta recusou o evento: ${json.error?.message ?? res.status}`);
  return { eventsReceived: json.events_received ?? 0 };
}

export async function saveConsent(input: {
  email: string; softwareId: string; leadEventId: string;
  fbp?: string | null; fbc?: string | null; clientIp?: string | null; userAgent?: string | null; sourceUrl?: string | null;
}): Promise<void> {
  const hash = emailHash(input.email);
  if (!hash) return;
  const now = new Date();
  const values = {
    softwareId: input.softwareId, leadEventId: input.leadEventId,
    fbp: input.fbp ?? null, fbc: input.fbc ?? null, clientIp: input.clientIp ?? null,
    userAgent: input.userAgent ?? null, sourceUrl: input.sourceUrl ?? null,
    consentedAt: now, expiresAt: consentExpiry(now),
  };
  await db.insert(schema.metaConsents).values({ emailHash: hash, ...values })
    .onConflictDoUpdate({ target: schema.metaConsents.emailHash, set: values });
}

/** De que página e anúncio veio a inscrição (a primeira de cada pessoa). Não sai do Controlo. */
export async function saveAttribution(input: { email: string; softwareId: string; page: string | null; ad: string | null }): Promise<void> {
  const hash = emailHash(input.email);
  if (!hash) return;
  await db.insert(schema.signupAttributions).values({ emailHash: hash, softwareId: input.softwareId, page: input.page, adRef: input.ad ? adRef(input.ad) || null : null })
    .onConflictDoNothing();
}

/** Chamado pelo webhook da Stripe. Guarda a compra e, com consentimento de marketing, envia-a à Meta.
 *  Devolve o que fez, para ficar no registo do webhook. */
export async function purchaseFromCheckout(eventType: string, session: StripeCheckoutSession, now = new Date()): Promise<string> {
  if (!isPaidCheckout(eventType, session)) return "por pagar";
  const softwareId = session.payment_link ? paymentLinks(process.env.META_CAPI_PAYMENT_LINKS).get(session.payment_link) : undefined;
  if (!softwareId) return "não é uma pré-reserva ligada à Meta";
  const hash = emailHash(session.customer_details?.email);
  await db.insert(schema.stripePurchases).values({
    sessionId: session.id, softwareId, emailHash: hash, amountCents: session.amount_total ?? 0,
    currency: String(session.currency ?? "eur"), paymentLink: session.payment_link ?? null, paidAt: now,
  }).onConflictDoNothing();
  if (!hash) return "compra guardada, sem email";
  const [consent] = await db.select().from(schema.metaConsents)
    .where(and(eq(schema.metaConsents.emailHash, hash), eq(schema.metaConsents.softwareId, softwareId)));
  if (!consent || consent.expiresAt < now) return "compra guardada; sem consentimento de marketing, não vai para a Meta";
  if (!capiConfigured()) return "META_CAPI_TOKEN não configurado";
  const [software] = await db.select().from(schema.softwares).where(eq(schema.softwares.id, softwareId));
  await sendToMeta([purchaseEvent({ session, consent, contentName: software?.name ?? softwareId, now })]);
  await db.update(schema.metaConsents).set({ purchaseSentAt: now }).where(eq(schema.metaConsents.emailHash, hash));
  return "compra enviada à Meta";
}

/** Apaga os consentimentos com mais de 90 dias. */
export async function purgeExpiredConsents(now = new Date()): Promise<number> {
  const rows = await db.delete(schema.metaConsents).where(lt(schema.metaConsents.expiresAt, now))
    .returning({ h: schema.metaConsents.emailHash });
  return rows.length;
}
