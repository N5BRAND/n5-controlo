"use client";
import { useActionState } from "react";
import { saveAboCampaign } from "./actions";

/** Liga uma campanha da Meta às regras de orçamento ABO (ou atualiza o total do dia e a data de início). */
export function AboForm({ softwares }: { softwares: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(saveAboCampaign, undefined);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(new Date());
  return (
    <form action={action} className="card space-y-3">
      <h2 className="h2">Ligar campanha às regras ABO</h2>
      <p className="text-xs text-muted">Para campanhas com orçamento em cada conjunto de anúncios, um criativo por conjunto (até 1000 € por mês). As regras repartem o total do dia entre os conjuntos às 08:00 e às 20:00.</p>
      <div><label className="label" htmlFor="abo-sw">Software</label><select id="abo-sw" name="softwareId" className="input">{softwares.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
      <div><label className="label" htmlFor="abo-id">ID da campanha</label><input id="abo-id" name="campaignId" inputMode="numeric" className="input" placeholder="52530624317796" required /></div>
      <div><label className="label" htmlFor="abo-name">Nome</label><input id="abo-name" name="name" className="input" placeholder="N5 Clara · Pré-reserva · Leads" required /></div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="label" htmlFor="abo-budget">Total do dia (€)</label><input id="abo-budget" name="dailyBudget" type="number" min="1" max="1000" step="0.5" className="input" defaultValue="30" required /></div>
        <div><label className="label" htmlFor="abo-since">ABO desde</label><input id="abo-since" name="aboSince" type="date" className="input" defaultValue={today} required /></div>
      </div>
      {state?.error ? <p role="alert" className="text-bad text-sm">{state.error}</p> : null}
      {state?.message ? <p role="status" className="text-good text-sm">{state.message}</p> : null}
      <button className="btn" disabled={pending}>{pending ? "A guardar…" : "Guardar"}</button>
    </form>
  );
}
