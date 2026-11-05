"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PERIODS, isoDay } from "@/lib/filters";
import { LABELS } from "@/lib/format";
import { useT } from "@/lib/i18n/client";

export function FilterBar({ softwares, team = [] }: { softwares: { id: string; name: string }[]; team?: { id: string; name: string }[] }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const go = (changes: Record<string, string | null>) => {
    const p = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) { if (value) p.set(key, value); else p.delete(key); }
    router.push(`${pathname}?${p.toString()}`);
  };
  const set = (key: string, value: string) => go({ [key]: value });

  // na monitorização de campanhas, sem período escolhido, os números são desde o início da campanha
  const desdeInicio = pathname === "/campanhas";
  const periodo = params.get("periodo") ?? (desdeInicio ? "" : "mes");
  const personalizado = periodo === "personalizado";
  const hoje = isoDay(new Date());
  const [de, setDe] = useState(params.get("de") ?? "");
  const [ate, setAte] = useState(params.get("ate") ?? "");
  useEffect(() => { setDe(params.get("de") ?? ""); setAte(params.get("ate") ?? ""); }, [params]);

  const escolherPeriodo = (v: string) => {
    if (v === "personalizado") {
      // começa nos últimos 7 dias; depois escolhem-se as datas e carrega-se em «Aplicar»
      const inicio = params.get("de") ?? isoDay(new Date(Date.now() - 6 * 864e5));
      go({ periodo: v, de: inicio, ate: params.get("ate") ?? hoje });
    } else go({ periodo: v || null, de: null, ate: null });
  };
  const datasValidas = Boolean(de && ate);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2">
        <span className="rotulo">{t("Software")}</span>
        <select className="input w-auto" value={params.get("sw") ?? "todos"} onChange={(e) => set("sw", e.target.value === "todos" ? "" : e.target.value)}>
          <option value="todos">{t("Todos os softwares")}</option>
          {softwares.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2">
        <span className="rotulo">{t("Período")}</span>
        <select className="input w-auto" value={periodo} onChange={(e) => escolherPeriodo(e.target.value)}>
          {desdeInicio ? <option value="">{t("Desde o início")}</option> : null}
          {PERIODS.map((p) => <option key={p.key} value={p.key}>{t(p.label)}</option>)}
        </select>
      </label>
      {personalizado ? (
        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (datasValidas) go({ periodo: "personalizado", de, ate }); }}>
          <label className="flex items-center gap-2">
            <span className="rotulo">{t("De")}</span>
            <input type="date" className="input w-auto" value={de} max={ate || hoje} onChange={(e) => setDe(e.target.value)} required />
          </label>
          <label className="flex items-center gap-2">
            <span className="rotulo">{t("Até")}</span>
            <input type="date" className="input w-auto" value={ate} min={de || undefined} max={hoje} onChange={(e) => setAte(e.target.value)} required />
          </label>
          <button className="btn" disabled={!datasValidas}>{t("Aplicar")}</button>
        </form>
      ) : null}
      {/* No Quadro e na Lista do Pipeline, os filtros de responsável e prioridade ficam aqui, junto dos outros */}
      {pathname === "/pipeline" && (!params.get("vista") || ["quadro", "lista", "roadmap"].includes(params.get("vista") ?? "")) ? (
        <>
          <label className="flex items-center gap-2">
            <span className="rotulo">{t("Responsável")}</span>
            <select className="input w-auto" value={params.get("resp") ?? ""} onChange={(e) => set("resp", e.target.value)}>
              <option value="">{t("Todos")}</option><option value="meus">{t("Os meus")}</option><option value="sem">{t("Sem responsável")}</option>
              {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="rotulo">{t("Prioridade")}</span>
            <select className="input w-auto" value={params.get("prio") ?? ""} onChange={(e) => set("prio", e.target.value)}>
              <option value="">{t("Todas")}</option>
              {Object.entries(LABELS.priority).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
            </select>
          </label>
        </>
      ) : null}
    </div>
  );
}
