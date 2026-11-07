import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL ?? "postgres://n5:n5@localhost:5432/n5";
const sql = postgres(url, { max: 1, onnotice: () => {} });

migrate(drizzle(sql), { migrationsFolder: "./drizzle" })
  .then(() => { console.log("Migrações aplicadas."); return sql.end(); })
  .catch((err) => { console.error(err); process.exit(1); });
