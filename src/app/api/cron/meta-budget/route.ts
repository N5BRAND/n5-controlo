import { z } from "zod";
import { cronAuthorized } from "@/lib/cron";
import { syncMetaInsights } from "@/lib/meta";
import { runAbo } from "@/lib/meta-abo";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Query = z.object({ momento: z.enum(["manha", "noite"]) });

// Às 08:00 e às 20:00: sincroniza os últimos 3 dias da Meta e corre as regras de orçamento ABO
export async function POST(req: Request) {
  if (!cronAuthorized(req)) return new Response("não autorizado", { status: 401 });
  const q = Query.safeParse({ momento: new URL(req.url).searchParams.get("momento") });
  if (!q.success) return Response.json({ error: { code: "momento_invalido", message: "O momento tem de ser manha ou noite." } }, { status: 400 });
  const sync = await syncMetaInsights(3);
  const result = await runAbo(q.data.momento);
  return Response.json({ sync, result });
}
