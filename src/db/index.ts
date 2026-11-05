import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// DATABASE_URL (AWS, Docker, Supabase, Neon, local) ou NETLIFY_DB_URL (Netlify Database)
const url = process.env.DATABASE_URL ?? process.env.NETLIFY_DB_URL ?? "postgres://n5:n5@localhost:5432/n5";
// Em funções serverless (Netlify, Lambda) cada instância abre poucas ligações (5, para as leituras em paralelo) e não usa prepared statements,
// para funcionar atrás de um pooler em modo transação.
const serverless = !!process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY === "true" || /pooler|:6543\//.test(url);

// Uma ligação partilhada por processo (no modo dev o Next recarrega módulos)
const globalForDb = globalThis as unknown as { n5Sql?: ReturnType<typeof postgres> };
export const sql = globalForDb.n5Sql ?? postgres(url, { max: serverless ? 5 : 10, prepare: !serverless });
if (process.env.NODE_ENV !== "production") globalForDb.n5Sql = sql;

export const db = drizzle(sql, { schema });
export { schema };
