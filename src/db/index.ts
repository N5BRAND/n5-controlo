import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// DATABASE_URL: Postgres da VPS (Easypanel), RDS, Docker local, ou outro
const url = process.env.DATABASE_URL ?? "postgres://n5:n5@localhost:5432/n5";
// Em funções serverless (Lambda) cada instância abre poucas ligações (5, para as leituras em paralelo) e não usa prepared statements,
// para funcionar atrás de um pooler em modo transação.
const serverless = !!process.env.AWS_LAMBDA_FUNCTION_NAME || /pooler|:6543\//.test(url);

// Uma ligação partilhada por processo (no modo dev o Next recarrega módulos)
const globalForDb = globalThis as unknown as { n5Sql?: ReturnType<typeof postgres> };
export const sql = globalForDb.n5Sql ?? postgres(url, { max: serverless ? 5 : 10, prepare: !serverless });
if (process.env.NODE_ENV !== "production") globalForDb.n5Sql = sql;

export const db = drizzle(sql, { schema });
export { schema };
