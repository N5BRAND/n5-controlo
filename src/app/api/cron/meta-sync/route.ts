import { cronAuthorized } from "@/lib/cron";
import { syncMetaInsights } from "@/lib/meta";
import { raiseAlert } from "@/lib/alerts";
import { purgeExpiredConsents } from "@/lib/metaCapi";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// A cada 6 horas: recalcula os últimos 28 dias de cada conta de anúncios e apaga os consentimentos expirados
export async function POST(req: Request) {
  if (!cronAuthorized(req)) return new Response("não autorizado", { status: 401 });
  const result = await syncMetaInsights();
  for (const r of result.filter((x) => x.error && x.software !== "-")) {
    await raiseAlert({ module: "sistema", softwareId: r.software, severity: "aviso", title: "Sincronização Meta com erro",
      detail: r.error, dedupeKey: `meta-sync:${r.software}:${new Date().toISOString().slice(0, 10)}` });
  }
  // Consentimentos da API de Conversões com mais de 90 dias
  const consentsPurged = await purgeExpiredConsents();
  return Response.json({ result, consentsPurged });
}
