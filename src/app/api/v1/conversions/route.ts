import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { authenticate, errorResponse, ApiError } from "@/lib/apikeys";
import { leadEvent } from "@/lib/conversions";
import { capiConfigured, saveAttribution, saveConsent, sendToMeta } from "@/lib/metaCapi";

const leadSchema = z.object({
  event: z.literal("Lead"),
  event_id: z.string().min(8).max(100),
  email: z.string().email().max(254),
  phone: z.string().max(40).optional(),
  name: z.string().max(200).optional(),
  fbp: z.string().max(200).optional(),
  fbc: z.string().max(500).optional(),
  client_ip: z.string().max(64).optional(),
  user_agent: z.string().max(1000).optional(),
  source_url: z.string().url().max(2000),
  ad: z.string().max(150).optional(), // utm_content do anúncio de onde veio
  consent: z.boolean(),
});

// POST /api/v1/conversions — inscrição num site N5.
// Sempre: guarda de que página e anúncio veio (email cifrado), para juntar as compras da Stripe aos anúncios.
// Só com os cookies de marketing aceites (consent: true): guarda o consentimento (90 dias), para a compra que a Stripe
// confirmar mais tarde, e envia o Lead à Meta com o mesmo event_id que o píxel usou no navegador.
export async function POST(req: Request) {
  try {
    const caller = await authenticate(req, "events:write");
    if (!caller.softwareId) throw new ApiError(403, "Usa uma chave ligada a um software.", "forbidden_software");
    const p = leadSchema.safeParse(await req.json().catch(() => null));
    if (!p.success) throw new ApiError(400, p.error.issues[0]?.message ?? "Pedido inválido.", "bad_request");
    const d = p.data;
    await saveAttribution({ email: d.email, softwareId: caller.softwareId, page: new URL(d.source_url).pathname, ad: d.ad ?? null });
    if (!d.consent) return Response.json({ sent: false, reason: "sem consentimento de marketing" }, { status: 202 });
    const person = { email: d.email, phone: d.phone, name: d.name, clientIp: d.client_ip, userAgent: d.user_agent, fbp: d.fbp, fbc: d.fbc };
    await saveConsent({ ...person, softwareId: caller.softwareId, leadEventId: d.event_id, sourceUrl: d.source_url });
    if (!capiConfigured()) return Response.json({ sent: false, reason: "META_CAPI_TOKEN não configurado" }, { status: 202 });
    const [software] = await db.select().from(schema.softwares).where(eq(schema.softwares.id, caller.softwareId));
    try {
      const r = await sendToMeta([leadEvent({ eventId: d.event_id, sourceUrl: d.source_url, person, contentName: software?.name ?? caller.softwareId })]);
      return Response.json({ sent: true, events_received: r.eventsReceived });
    } catch (err) {
      throw new ApiError(502, String(err instanceof Error ? err.message : err), "meta_error");
    }
  } catch (err) {
    return errorResponse(err);
  }
}
