import { createHash } from "node:crypto";

// API de Conversões da Meta: funções puras (normalizar, cifrar e montar os eventos).
// O envio e a base de dados ficam em src/lib/metaCapi.ts.
// Regras da Meta: email e nomes em minúsculas e sem espaços à volta, telefone só com dígitos e indicativo,
// tudo cifrado com SHA-256 antes de sair; IP, navegador, fbp e fbc seguem como vieram.

export const CONSENT_DAYS = 90;

/** Payment Links que contam como compra de cada software (plink → software). Sobrepõe-se com META_CAPI_PAYMENT_LINKS. */
export const DEFAULT_PAYMENT_LINKS: Record<string, string> = {
  plink_1UVEbARxjA6FBfLNUUGWxa0b: "sw_clara", // pré-reserva da N5 Clara (27 €)
};

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function normEmail(email: string | null | undefined): string {
  return String(email ?? "").trim().toLowerCase();
}

/** Só dígitos, com indicativo: números portugueses de 9 dígitos ganham o 351. */
export function normPhone(phone: string | null | undefined): string {
  const raw = String(phone ?? "").trim();
  if (!raw) return "";
  let digits = raw.replace(/\D/g, "");
  if (raw.startsWith("00")) digits = digits.slice(2);
  if (!raw.startsWith("+") && !raw.startsWith("00") && digits.length === 9) digits = "351" + digits;
  return digits;
}

export function emailHash(email: string | null | undefined): string | null {
  const e = normEmail(email);
  return e ? sha256(e) : null;
}

export interface Person {
  email?: string | null;
  phone?: string | null;
  name?: string | null;
  clientIp?: string | null;
  userAgent?: string | null;
  fbp?: string | null;
  fbc?: string | null;
}

/** user_data da Meta: o que identifica a pessoa vai cifrado; vazios ficam de fora. */
export function userData(p: Person): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  const email = normEmail(p.email);
  if (email) {
    out.em = [sha256(email)];
    out.external_id = [sha256(email)];
  }
  const phone = normPhone(p.phone);
  if (phone) out.ph = [sha256(phone)];
  const names = String(p.name ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (names.length) out.fn = [sha256(names[0])];
  if (names.length > 1) out.ln = [sha256(names[names.length - 1])];
  out.country = [sha256("pt")];
  if (p.clientIp) out.client_ip_address = p.clientIp;
  if (p.userAgent) out.client_user_agent = p.userAgent;
  if (p.fbp) out.fbp = p.fbp;
  if (p.fbc) out.fbc = p.fbc;
  return out;
}

export interface MetaEvent {
  event_name: "Lead" | "Purchase";
  event_time: number;
  event_id: string;
  action_source: "website";
  event_source_url?: string;
  user_data: Record<string, string | string[]>;
  custom_data?: Record<string, string | number>;
}

/** Inscrição: o event_id é o mesmo que o píxel usou no navegador, para a Meta juntar os dois. */
export function leadEvent(input: { eventId: string; sourceUrl: string; person: Person; contentName: string; now?: Date }): MetaEvent {
  return {
    event_name: "Lead",
    event_time: Math.floor((input.now ?? new Date()).getTime() / 1000),
    event_id: input.eventId,
    action_source: "website",
    event_source_url: input.sourceUrl,
    user_data: userData(input.person),
    custom_data: { content_name: input.contentName },
  };
}

/** Compra confirmada pela Stripe: o event_id é a sessão de checkout, por isso uma repetição do webhook não conta duas vezes. */
export function purchaseEvent(input: {
  session: StripeCheckoutSession;
  consent: { fbp?: string | null; fbc?: string | null; clientIp?: string | null; userAgent?: string | null; sourceUrl?: string | null };
  contentName: string;
  now?: Date;
}): MetaEvent {
  const s = input.session;
  const c = input.consent;
  return {
    event_name: "Purchase",
    event_time: Math.floor((input.now ?? new Date()).getTime() / 1000),
    event_id: s.id,
    action_source: "website",
    ...(c.sourceUrl ? { event_source_url: c.sourceUrl } : {}),
    user_data: userData({
      email: s.customer_details?.email, phone: s.customer_details?.phone, name: s.customer_details?.name,
      clientIp: c.clientIp, userAgent: c.userAgent, fbp: c.fbp, fbc: c.fbc,
    }),
    custom_data: { value: (s.amount_total ?? 0) / 100, currency: String(s.currency ?? "eur").toUpperCase(), content_name: input.contentName },
  };
}

export interface StripeCheckoutSession {
  id: string;
  payment_status?: string;
  payment_link?: string | null;
  amount_total?: number | null;
  currency?: string | null;
  customer_details?: { email?: string | null; phone?: string | null; name?: string | null } | null;
}

/** A compra só conta quando o dinheiro entrou: cartão e MB WAY no checkout; Multibanco quando a referência é paga. */
export function isPaidCheckout(eventType: string, session: StripeCheckoutSession): boolean {
  if (eventType === "checkout.session.async_payment_succeeded") return true;
  return eventType === "checkout.session.completed" && session.payment_status === "paid";
}

/** «plink_a:sw_clara,plink_b:sw_imobiliario» → mapa; sem variável, fica o predefinido. */
export function paymentLinks(env: string | undefined): Map<string, string> {
  const map = new Map(Object.entries(DEFAULT_PAYMENT_LINKS));
  for (const pair of String(env ?? "").split(",").map((p) => p.trim()).filter(Boolean)) {
    const [link, software] = pair.split(":").map((x) => x.trim());
    if (link && software) map.set(link, software);
  }
  return map;
}

export function consentExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + CONSENT_DAYS * 864e5);
}
