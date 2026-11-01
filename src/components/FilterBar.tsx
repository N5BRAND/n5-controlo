"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PERIODS, isoDay } from "@/lib/filters";

export function FilterBar({ softwares }: { softwares: { id: string; name: string }[] }) {
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
        <span className="rotulo">Software</span>
        <select className="input w-auto" value={params.get("sw") ?? "todos"} onChange={(e) => set("sw", e.target.value === "todos" ? "" : e.target.value)}>
          <option value="todos">Todos os softwares</option>
          {softwares.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2">
        <span className="rotulo">Período</span>
        <select className="input w-auto" value={periodo} onChange={(e) => escolherPeriodo(e.target.value)}>
          {desdeInicio ? <option value="">Desde o início</option> : null}
          {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </label>
      {personalizado ? (
        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (datasValidas) go({ periodo: "personalizado", de, ate }); }}>
          <label className="flex items-center gap-2">
            <span className="rotulo">De</span>
            <input type="date" className="input w-auto" value={de} max={ate || hoje} onChange={(e) => setDe(e.target.value)} required />
          </label>
          <label className="flex items-center gap-2">
            <span className="rotulo">Até</span>
            <input type="date" className="input w-auto" value={ate} min={de || undefined} max={hoje} onChange={(e) => setAte(e.target.value)} required />
          </label>
          <button className="btn" disabled={!datasValidas}>Aplicar</button>
        </form>
      ) : null}
    </div>
  );
}
