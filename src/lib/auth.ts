import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { SESSION_COOKIE, verifySession, type SessionPayload, type TeamRole } from "./session";

export type Module = "painel" | "comunidades" | "pipeline" | "campanhas" | "receita" | "reativacao" | "impacto" | "chat" | "custos" | "alertas" | "definicoes";

// Regras de acesso da especificação: sócios e direção de operações veem tudo;
// colaboradores veem só o Pipeline dos softwares atribuídos (sem o ecrã de custos).
// Comunidades e Chat estão temporariamente reservados a sócios e direção de operações.
const COLLABORATOR_MODULES: Module[] = ["pipeline"];

export function canSee(role: TeamRole, module: Module): boolean {
  if (role === "socio" || role === "direcao_operacoes") return true;
  return COLLABORATOR_MODULES.includes(module);
}

export interface CurrentUser extends SessionPayload { softwareIds: string[] | "all" }

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const jar = await cookies();
  const session = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.sub));
  if (!user || !user.active) return null;
  if (user.role !== "colaborador") return { ...session, role: user.role, softwareIds: "all" };
  const rows = await db.select().from(schema.userSoftwares).where(eq(schema.userSoftwares.userId, user.id));
  return { ...session, role: user.role, softwareIds: rows.map((r) => r.softwareId) };
}

export async function requireUser(module: Module): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canSee(user.role, module)) redirect("/sem-acesso");
  return user;
}

export function allowedSoftware(user: CurrentUser, softwareId: string): boolean {
  return user.softwareIds === "all" || user.softwareIds.includes(softwareId);
}

/** Softwares visíveis nesta vista: os permitidos ao utilizador, restringidos ao escolhido no seletor. */
export function scopeSoftwares(user: CurrentUser, selected: string | null, all: { id: string }[]): string[] {
  const allowed = all.map((s) => s.id).filter((id) => allowedSoftware(user, id));
  return selected ? allowed.filter((id) => id === selected) : allowed;
}
