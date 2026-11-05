"use client";
import { useActionState } from "react";
import { useT } from "@/lib/i18n/client";
import { importCsv } from "./actions";

export function ImportForm({ softwares }: { softwares: { id: string; name: string }[] }) {
  const t = useT();
  const [state, action, pending] = useActionState(importCsv, undefined);
  return (
    <form action={action} className="card space-y-3">
      <h2 className="h2">{t("Importar CSV do Gestor de Anúncios")}</h2>
      <p className="text-xs text-muted">{t("Exporta por dia, com as colunas Dia, Nome da campanha, Nome do conjunto, Nome do anúncio, Valor gasto, Impressões, Cliques, Resultados e Frequência.")}</p>
      <div><label className="label" htmlFor="imp-sw">{t("Software")}</label><select id="imp-sw" name="softwareId" className="input">{softwares.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
      <div><label className="label" htmlFor="imp-file">{t("Ficheiro")}</label><input id="imp-file" name="file" type="file" accept=".csv,text/csv" className="input" required /></div>
      {state?.error ? <p role="alert" className="text-bad text-sm">{state.error}</p> : null}
      {state?.message ? <p role="status" className="text-good text-sm">{state.message}</p> : null}
      <button className="btn" disabled={pending}>{pending ? t("A importar…") : t("Importar")}</button>
    </form>
  );
}
