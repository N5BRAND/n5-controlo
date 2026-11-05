import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

// Cancelamento da subscrição de e-mails.
// GET (link no rodapé) mostra um botão de confirmação: os filtros de e-mail abrem links sozinhos e não podem cancelar ninguém.
// POST (botão do Gmail/Yahoo ou o botão da página) cancela de imediato.
export async function GET(req: Request): Promise<Response> {
  const token = new URL(req.url).searchParams.get("t") ?? "";
  const safe = token.replace(/[^A-Za-z0-9_-]/g, "");
  return new Response(
    `<!doctype html><html lang="pt-PT"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Subscrição</title><body style="font-family:Arial,sans-serif;max-width:480px;margin:60px auto;padding:0 16px;color:#15181D"><p>Quer deixar de receber estes e-mails?</p><form method="post" action="?t=${safe}"><button style="background:#E8A13C;color:#15181D;border:0;border-radius:6px;padding:10px 16px;font-size:15px">Cancelar a subscrição</button></form></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } });
}

export async function POST(req: Request): Promise<Response> {
  const token = new URL(req.url).searchParams.get("t") ?? "";
  const [p] = token ? await db.select().from(schema.persons).where(eq(schema.persons.unsubscribeToken, token)) : [];
  const page = (msg: string, status = 200) => new Response(
    `<!doctype html><html lang="pt-PT"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Subscrição</title><body style="font-family:Arial,sans-serif;max-width:480px;margin:60px auto;padding:0 16px;color:#15181D"><p>${msg}</p></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } });
  if (!p) return page("Esta ligação já não é válida.", 404);
  await db.update(schema.persons).set({ emailOptOut: true }).where(eq(schema.persons.id, p.id));
  return page("Pronto: não vai voltar a receber estes e-mails. As mensagens dentro da app continuam, e pode desligá-las nas definições da app.");
}
