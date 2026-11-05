"use server";
import { getT } from "@/lib/i18n/server";
import { randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { and, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { SESSION_COOKIE, sessionMaxAge, signSession } from "@/lib/session";
import { audit } from "@/lib/audit";
import { raiseAlert } from "@/lib/alerts";
import { clientIp, fingerprint, LOGIN_WINDOW_MINUTES, loginBlocked, MAX_FAILS_PER_ACCOUNT, normalizeEmail } from "@/lib/login-rules";

// Quando o e-mail não existe, compara-se na mesma com um hash qualquer: o tempo de resposta não revela que contas há.
let decoy: Promise<string> | null = null;
const decoyHash = () => (decoy ??= bcrypt.hash(randomBytes(16).toString("hex"), 12));

export async function login(_prev: { error?: string } | undefined, form: FormData): Promise<{ error?: string }> {
  const email = normalizeEmail(String(form.get("email") ?? ""));
  const password = String(form.get("password") ?? "");
  const account = fingerprint(email);
  const ip = `ip:${fingerprint(clientIp(await headers()))}`;

  // Travão: 5 falhas por conta ou 20 por IP nos últimos 15 minutos (registadas no audit_log)
  const since = new Date(Date.now() - LOGIN_WINDOW_MINUTES * 60_000);
  const [fails] = await db.select({
    account: sql<number>`count(*) filter (where ${schema.auditLog.entityId} = ${account})::int`,
    ip: sql<number>`count(*) filter (where ${schema.auditLog.actor} = ${ip})::int`,
  }).from(schema.auditLog).where(and(eq(schema.auditLog.action, "auth.login_failed"), gte(schema.auditLog.at, since)));
  if (loginBlocked(fails)) return { error: (await getT())("Demasiadas tentativas. Tenta de novo daqui a {n} minutos.", { n: LOGIN_WINDOW_MINUTES }) };

  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  const ok = await bcrypt.compare(password, user?.passwordHash ?? (await decoyHash()));
  // Mesma mensagem para utilizador inexistente, desativado e palavra-passe errada
  if (!user || !user.active || !ok) {
    await audit(ip, "auth.login_failed", "user", account);
    if (fails.account + 1 === MAX_FAILS_PER_ACCOUNT) {
      await raiseAlert({ module: "sistema", severity: "aviso", title: "Conta bloqueada por tentativas de entrada falhadas",
        detail: `${MAX_FAILS_PER_ACCOUNT} falhas em ${LOGIN_WINDOW_MINUTES} minutos${user ? ` na conta de ${user.name}` : " num e-mail que não existe"}. Fica bloqueada ${LOGIN_WINDOW_MINUTES} minutos.`,
        dedupeKey: `login-bloqueado:${account}:${new Date().toISOString().slice(0, 13)}` });
    }
    return { error: (await getT())("E-mail ou palavra-passe errados.") };
  }
  await audit(`user:${user.id}`, "auth.login", "user", user.id);
  const token = await signSession({ sub: user.id, name: user.name, role: user.role });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: sessionMaxAge,
  });
  redirect("/");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
