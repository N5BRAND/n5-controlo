import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { verifyStripe } from "@/lib/signatures";
import { newId, snapshotMrr } from "@/lib/core";
import { raiseAlert } from "@/lib/alerts";
import { purchaseFromCheckout } from "@/lib/metaCapi";
import type { StripeCheckoutSession } from "@/lib/conversions";

// Webhooks do Stripe: subscrições, checkout, faturas pagas e pagamentos falhados.
// Checkouts pagos de um Payment Link ligado à Meta (pré-reservas) seguem como Purchase para a API de Conversões.
// Cada subscrição leva em metadata: n5_software (ex.: sw_clara). Os preços levam em metadata
// included_minutes e included_leads (o incluído no plano).

interface StripeEvent { id: string; type: string; data: { object: Record<string, any> } }

const STATUS_MAP: Record<string, typeof schema.subscriptions.$inferSelect.status> = {
  trialing: "trialing", active: "active", past_due: "past_due", unpaid: "past_due",
  canceled: "canceled", incomplete: "incomplete", incomplete_expired: "canceled", paused: "canceled",
};

async function orgForCustomer(customerId: string, name?: string | null): Promise<string> {
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.stripeCustomerId, customerId));
  if (org) return org.id;
  const id = newId("org");
  await db.insert(schema.organizations).values({ id, name: name || customerId, stripeCustomerId: customerId });
  return id;
}

/** MRR em cêntimos sem IVA a partir dos itens da subscrição (planos anuais divididos por 12). */
function mrrFromItems(sub: Record<string, any>): { mrr: number; plan: string; minutes: number; leads: number } {
  let mrr = 0, minutes = 0, leads = 0, plan = "";
  for (const item of sub.items?.data ?? []) {
    const price = item.price ?? {};
    const amount = (price.unit_amount ?? 0) * (item.quantity ?? 1);
    const interval = price.recurring?.interval;
    const count = price.recurring?.interval_count ?? 1;
    if (price.recurring?.usage_type === "metered") continue; // consumo extra fica fora do MRR
    mrr += interval === "year" ? amount / (12 * count) : interval === "week" ? (amount * 52) / (12 * count) : amount / count;
    minutes += Number(price.metadata?.included_minutes ?? 0);
    leads += Number(price.metadata?.included_leads ?? 0);
    plan = plan || price.nickname || price.lookup_key || price.id;
  }
  // Descontos: percentagem aplicada ao MRR
  const pct = sub.discount?.coupon?.percent_off ?? sub.discounts?.[0]?.coupon?.percent_off;
  if (pct) mrr = mrr * (1 - pct / 100);
  return { mrr: Math.round(mrr), plan, minutes, leads };
}

async function handle(evt: StripeEvent): Promise<string | void> {
  const o = evt.data.object;
  switch (evt.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const softwareId = o.metadata?.n5_software;
      if (!softwareId) throw new Error(`subscrição ${o.id} sem metadata.n5_software`);
      const orgId = await orgForCustomer(o.customer, o.metadata?.n5_org_name);
      const { mrr, plan, minutes, leads } = mrrFromItems(o);
      const status = evt.type === "customer.subscription.deleted" ? "canceled" : (STATUS_MAP[o.status] ?? "incomplete");
      const values = {
        organizationId: orgId, softwareId, plan, status, mrrCents: status === "trialing" ? 0 : mrr,
        includedMinutes: minutes, includedLeads: leads,
        trialEnd: o.trial_end ? new Date(o.trial_end * 1000) : null,
        currentPeriodEnd: o.current_period_end ? new Date(o.current_period_end * 1000) : null,
        startedAt: new Date((o.start_date ?? o.created) * 1000),
        canceledAt: o.ended_at ? new Date(o.ended_at * 1000) : null,
        updatedAt: new Date(),
      };
      await db.insert(schema.subscriptions).values({ id: o.id, ...values })
        .onConflictDoUpdate({ target: schema.subscriptions.id, set: values });
      // Origem da pessoa acompanha a subscrição (trial → pagante)
      if (status === "active") {
        await db.update(schema.persons).set({ origin: "pagante" }).where(eq(schema.persons.organizationId, orgId));
      }
      await snapshotMrr();
      break;
    }
    case "checkout.session.completed": {
      if (o.customer) await orgForCustomer(o.customer, o.customer_details?.name);
      return purchaseFromCheckout(evt.type, o as StripeCheckoutSession);
    }
    case "checkout.session.async_payment_succeeded": {
      // Multibanco: a compra só conta quando a referência é paga
      return purchaseFromCheckout(evt.type, o as StripeCheckoutSession);
    }
    case "invoice.paid":
    case "invoice.payment_failed": {
      const orgId = o.customer ? await orgForCustomer(o.customer, o.customer_name) : null;
      const softwareId = o.subscription_details?.metadata?.n5_software ?? o.parent?.subscription_details?.metadata?.n5_software ?? null;
      const status = evt.type === "invoice.paid" ? "paid" : "failed";
      await db.insert(schema.invoices).values({
        id: o.id, organizationId: orgId, softwareId, amountCents: o.total ?? 0, vatCents: o.tax ?? 0, status,
        issuedAt: new Date((o.created ?? Date.now() / 1000) * 1000),
      }).onConflictDoUpdate({ target: schema.invoices.id, set: { status } });
      if (status === "failed") {
        await raiseAlert({ module: "receita", softwareId, severity: "critico",
          title: `Pagamento falhado: ${o.customer_name ?? orgId}`, detail: `Fatura ${o.number ?? o.id}, ${((o.total ?? 0) / 100).toFixed(2)} €`,
          dedupeKey: `pagamento-falhado:${o.id}` });
      }
      break;
    }
    default:
      break; // outros eventos ficam só no registo bruto
  }
}

export async function POST(req: Request) {
  const body = await req.text();
  if (!verifyStripe(body, req.headers.get("stripe-signature"), process.env.STRIPE_WEBHOOK_SECRET ?? "")) {
    return new Response("assinatura inválida", { status: 400 });
  }
  const evt = JSON.parse(body) as StripeEvent;
  const [inbox] = await db.insert(schema.webhookInbox).values({ source: "stripe", externalId: evt.id, body })
    .onConflictDoNothing().returning({ id: schema.webhookInbox.id });
  if (!inbox) return Response.json({ received: true, duplicate: true });
  try {
    const note = await handle(evt);
    if (note) console.log(`Webhook Stripe ${evt.type} ${evt.data.object.id}: ${note}`);
    await db.update(schema.webhookInbox).set({ processedAt: new Date() }).where(eq(schema.webhookInbox.id, inbox.id));
  } catch (err) {
    await db.update(schema.webhookInbox).set({ error: String(err) }).where(eq(schema.webhookInbox.id, inbox.id));
    console.error("Webhook Stripe falhou:", err);
  }
  return Response.json({ received: true });
}
