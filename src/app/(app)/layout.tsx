import { Suspense } from "react";
import { and, eq, inArray, ne } from "drizzle-orm";
import { deadlineStatus } from "@/lib/metrics";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { canSee, getCurrentUser, type Module } from "@/lib/auth";
import { softwaresFor } from "@/lib/queries";
import { FilterBar } from "@/components/FilterBar";
import { Nav } from "@/components/Nav";
import { Logo } from "@/components/Logo";
import { LangSwitch } from "@/components/LangSwitch";
import { getT } from "@/lib/i18n/server";
import { LABELS } from "@/lib/format";
import { logout } from "../login/actions";

export const dynamic = "force-dynamic";

const NAV: { href: string; label: string; module: Module; fullOnly?: boolean }[] = [
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
  const softwares = await softwaresFor(user);
  const team = await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(eq(schema.users.active, true)).orderBy(schema.users.name);
  const critical = canSee(user.role, "alertas")
    ? (await db.select().from(schema.alerts).where(and(eq(schema.alerts.severity, "critico"), ne(schema.alerts.status, "resolvido")))).length
    : 0;
  // Prazos em risco (ultrapassados, hoje ou a chegar) nos softwares a que a pessoa tem acesso
  const swIds = softwares.map((s) => s.id);
  const dueItems = swIds.length ? await db.select({ dueDate: schema.roadmapItems.dueDate, phase: schema.roadmapItems.phase }).from(schema.roadmapItems).where(inArray(schema.roadmapItems.softwareId, swIds)) : [];
  const urgent = dueItems.filter((i) => ["atrasado", "hoje", "a_chegar"].includes(deadlineStatus(i.dueDate, i.phase))).length;
  const items = NAV.filter((n) => canSee(user.role, n.module) && !(n.fullOnly && user.role === "colaborador")).map((n) => ({ href: n.href, label: t(n.label), badge: n.href === "/alertas" ? critical : n.label === "Notificações" ? urgent : undefined }));
  return (
    <div className="min-h-screen md:flex">
      <aside className="flex flex-col gap-4 bg-ink px-3 py-4 text-white md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:overflow-y-auto">
        <div className="flex items-center gap-3 px-3">
          <Logo className="h-8 w-auto shrink-0 text-white" title="Controlo N5" />
          <div className="min-w-0">
            <div className="text-lg font-semibold leading-tight tracking-tight">Controlo N5</div>
            <div className="truncate text-xs text-white/60">{user.name} · {t(LABELS.role[user.role])}</div>
          </div>
        </div>
        <nav aria-label={t("Módulos")}><Suspense><Nav items={items} /></Suspense></nav>
        <div className="mt-auto flex items-center justify-between gap-2 px-3">
          <form action={logout}><button className="text-sm text-white/60 hover:text-white">{t("Sair")}</button></form>
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
