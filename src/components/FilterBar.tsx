"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PERIODS } from "@/lib/filters";
import { LABELS } from "@/lib/format";
import { useT } from "@/lib/i18n/client";

export function FilterBar({ softwares, team = [] }: { softwares: { id: string; name: string }[]; team?: { id: string; name: string }[] }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const set = (key: string, value: string) => {
    const p = new URLSearchParams(params.toString());
    if (value) p.set(key, value); else p.delete(key);
    router.push(`${pathname}?${p.toString()}`);
  };
  // No Quadro e na Lista do Pipeline, os filtros de responsável e prioridade ficam aqui, junto dos outros.
  const vista = params.get("vista");
  const taskFilters = pathname === "/pipeline" && (!vista || vista === "quadro" || vista === "lista" || vista === "roadmap");
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex min-w-0 items-center gap-2 text-sm text-muted">
        {t("Software")}
        <select className="input w-auto max-w-[10rem] sm:max-w-none" value={params.get("sw") ?? "todos"} onChange={(e) => set("sw", e.target.value === "todos" ? "" : e.target.value)}>
          <option value="todos">{t("Todos os softwares")}</option>
          {softwares.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      <label className="flex min-w-0 items-center gap-2 text-sm text-muted">
        {t("Período")}
        <select className="input w-auto max-w-[10rem] sm:max-w-none" value={params.get("periodo") ?? "mes"} onChange={(e) => set("periodo", e.target.value)}>
          {PERIODS.map((p) => <option key={p.key} value={p.key}>{t(p.label)}</option>)}
        </select>
      </label>
      {taskFilters ? (
        <>
          <label className="flex min-w-0 items-center gap-2 text-sm text-muted">
            {t("Responsável")}
            <select className="input w-auto max-w-[10rem] sm:max-w-none" value={params.get("resp") ?? ""} onChange={(e) => set("resp", e.target.value)}>
              <option value="">{t("Todos")}</option><option value="meus">{t("Os meus")}</option><option value="sem">{t("Sem responsável")}</option>
              {team.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="flex min-w-0 items-center gap-2 text-sm text-muted">
            {t("Prioridade")}
            <select className="input w-auto max-w-[10rem] sm:max-w-none" value={params.get("prio") ?? ""} onChange={(e) => set("prio", e.target.value)}>
              <option value="">{t("Todas")}</option>
              {Object.entries(LABELS.priority).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
            </select>
          </label>
        </>
      ) : null}
    </div>
  );
}
