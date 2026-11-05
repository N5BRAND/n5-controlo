import "server-only";
import { sql } from "@/db";
import { EXAMPLE_RULES, UNLINK_STATEMENTS } from "@/lib/exampleData";

// As regras são texto fixo do código (sem nada vindo do pedido), por isso podem ir em sql.unsafe.

export async function countExampleData(): Promise<{ table: string; label: string; rows: number }[]> {
  const out = [];
  for (const r of EXAMPLE_RULES) {
    const [row] = await sql.unsafe<{ n: number }[]>(`select count(*)::int as n from ${r.table} where ${r.where}`);
    out.push({ table: r.table, label: r.label, rows: row?.n ?? 0 });
  }
  return out;
}

/** Apaga tudo de uma vez: ou sai tudo, ou nada (transação). Nunca apaga o utilizador que carregou no botão. */
export async function deleteExampleData(actorUserId: string): Promise<{ table: string; rows: number }[]> {
  return sql.begin(async (tx) => {
    for (const s of UNLINK_STATEMENTS) await tx.unsafe(s);
    const out: { table: string; rows: number }[] = [];
    for (const r of EXAMPLE_RULES) {
      const extra = r.table === "users" ? ` and id <> '${actorUserId.replace(/[^0-9a-f-]/gi, "")}'` : "";
      const res = await tx.unsafe(`delete from ${r.table} where (${r.where})${extra}`);
      out.push({ table: r.table, rows: res.count });
    }
    return out;
  });
}
