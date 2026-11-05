import { Suspense } from "react";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { deadlineStatus } from "@/lib/metrics";
import { LangSwitch } from "@/components/LangSwitch";
import { getT } from "@/lib/i18n/server";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { canSee, getCurrentUser, type Module } from "@/lib/auth";
import { softwaresFor } from "@/lib/queries";
import { FilterBar } from "@/components/FilterBar";
import { Nav } from "@/components/Nav";
import { Marca } from "@/components/Simbolo";
import { LABELS } from "@/lib/format";
import { logout } from "../login/actions";

export const dynamic = "force-dynamic";

const NAV: { href: string; label: string; module: Module }[] = [
  { href: "/", label: "Painel geral", module: "painel" },
  { href: "/comunidades", label: "Comunidades", module: "comunidades" },
  { href: "/pipeline", label: "Pipeline", module: "pipeline" },
  { href: "/pipeline?vista=notificacoes", label: "Notificações", module: "pipeline" },
  { href: "/pipeline?vista=historico", label: "Histórico", module: "pipeline" },
  { href: "/chat", label: "Chat", module: "chat" },
  { href: "/campanhas", label: "Campanhas e funil", module: "campanhas" },
  { href: "/receita", label: "Utilização e receita", module: "receita" },
  { href: "/reativacao", label: "Reativação", module: "reativacao" },
  { href: "/impacto", label: "Impacto", module: "impacto" },
  { href: "/alertas", label: "Alertas", module: "alertas" },
  { href: "/definicoes", label: "Definições", module: "definicoes" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const t = await getT();
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // Em paralelo, e só a contagem dos alertas críticos (antes vinham as linhas todas)
  const [softwares, critical] = await Promise.all([
    softwaresFor(user),
    canSee(user.role, "alertas")
      ? db.select({ n: sql<number>`count(*)::int` }).from(schema.alerts).where(and(eq(schema.alerts.severity, "critico"), ne(schema.alerts.status, "resolvido"))).then(([r]) => r?.n ?? 0)
      : Promise.resolve(0),
  ]);
  const team = await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(eq(schema.users.active, true)).orderBy(schema.users.name);
  // Prazos em risco (ultrapassados, hoje ou a chegar) nos softwares a que a pessoa tem acesso
  const swIds = softwares.map((s) => s.id);
  const dueItems = swIds.length ? await db.select({ dueDate: schema.roadmapItems.dueDate, phase: schema.roadmapItems.phase }).from(schema.roadmapItems).where(inArray(schema.roadmapItems.softwareId, swIds)) : [];
  const urgent = dueItems.filter((i) => ["atrasado", "hoje", "a_chegar"].includes(deadlineStatus(i.dueDate, i.phase))).length;
  const items = NAV.filter((n) => canSee(user.role, n.module)).map((n) => ({ href: n.href, label: t(n.label), badge: n.href === "/alertas" ? critical : n.label === "Notificações" ? urgent : undefined }));
  return (
    <div className="min-h-screen md:flex">
      <aside className="md:w-60 md:shrink-0 md:min-h-screen bg-ink text-cream px-3 py-5 flex flex-col gap-5">
        <div className="px-3">
          <Marca fundo="escuro" />
          <div className="text-xs text-cream/60 mt-2.5">{user.name} · {t(LABELS.role[user.role])}</div>
        </div>
        <nav aria-label={t("Módulos")}><Suspense><Nav items={items} /></Suspense></nav>
        <div className="mt-auto flex items-center justify-between gap-2 px-3">
          <form action={logout}><button className="text-sm text-cream/60 hover:text-cream">{t("Sair")}</button></form>
          <LangSwitch dark />
        </div>
      </aside>
      <div className="flex-1 min-w-0">
        <div className="sticky top-0 z-10 bg-canvas/95 backdrop-blur border-b border-line px-4 md:px-8 py-3">
          <Suspense><FilterBar softwares={softwares.map((s) => ({ id: s.id, name: s.name }))} team={team} /></Suspense>
        </div>
        <main className="px-4 md:px-8 py-6 max-w-[1400px] [&:has(.board-wide)]:max-w-none">{children}</main>
      </div>
    </div>
  );
}
