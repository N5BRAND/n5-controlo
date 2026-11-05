"use client";
import { useActionState } from "react";
import { useT } from "@/lib/i18n/client";

type Item = {
  id: number; title: string; description: string | null; impact: number; reach: number; confidence: number; effort: number;
  ownerUserId: string | null; agent: boolean; acceptanceCriteria: string | null; productEvents: string[]; sprint: string | null; version: string | null; phase: string; dueDate: string | null; priority: string;
};

export function ItemForm({ item, team, phases, priorities, action }: {
  item: Item; team: { id: string; name: string }[]; phases: [string, string][]; priorities: [string, string][];
  action: (prev: { error?: string; ok?: boolean } | undefined, form: FormData) => Promise<{ error?: string; ok?: boolean }>;
}) {
  const tr = useT();
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="card space-y-3">
      <div><label className="label" htmlFor="t">{tr("Título")}</label><input id="t" name="title" defaultValue={item.title} className="input" /></div>
      <div className="grid sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div><label className="label" htmlFor="ph">{tr("Fase")}</label><select id="ph" name="phase" defaultValue={item.phase} className="input">{phases.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div><label className="label" htmlFor="ow">{tr("Responsável")}</label><select id="ow" name="owner" defaultValue={item.ownerUserId ?? ""} className="input"><option value="">{tr("Sem dono")}</option>{team.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
        <div><label className="label" htmlFor="pr">{tr("Prioridade")}</label><select id="pr" name="priority" defaultValue={item.priority} className="input">{priorities.map(([k, v]) => <option key={k} value={k}>{tr(v)}</option>)}</select></div>
        <div><label className="label" htmlFor="due">{tr("Data de vencimento")}</label><input id="due" name="dueDate" type="date" defaultValue={item.dueDate ?? ""} className="input" /></div>
        <div className="flex items-end gap-2 pb-1.5"><input id="ag" name="agent" type="checkbox" defaultChecked={item.agent} className="size-4" /><label htmlFor="ag" className="text-sm">{tr("Pode ir para um agente de código")}</label></div>
      </div>
      <div><label className="label" htmlFor="d">{tr("Descrição")}</label><textarea id="d" name="description" rows={5} defaultValue={item.description ?? ""} className="input" /></div>
      <div><label className="label" htmlFor="ac">{tr("Critérios de aceitação")}</label><textarea id="ac" name="acceptanceCriteria" rows={5} defaultValue={item.acceptanceCriteria ?? ""} className="input" /></div>
      <div><label className="label" htmlFor="ev">{tr("Eventos de produto que vai enviar (separados por vírgula)")}</label><input id="ev" name="productEvents" defaultValue={item.productEvents.join(", ")} className="input" placeholder="feature.used, lead.replied_by_agent" /></div>
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
        <div><label className="label" htmlFor="im">{tr("Impacto")}</label><input id="im" name="impact" type="number" min={1} max={3} defaultValue={item.impact} className="input" /></div>
        <div><label className="label" htmlFor="re">{tr("Alcance")}</label><input id="re" name="reach" type="number" defaultValue={item.reach} className="input" /></div>
        <div><label className="label" htmlFor="co">{tr("Confiança %")}</label><input id="co" name="confidence" type="number" defaultValue={item.confidence} className="input" /></div>
        <div><label className="label" htmlFor="ef">{tr("Esforço")}</label><input id="ef" name="effort" type="number" min={1} defaultValue={item.effort} className="input" /></div>
        <div><label className="label" htmlFor="sp">{tr("Sprint")}</label><input id="sp" name="sprint" defaultValue={item.sprint ?? ""} className="input" /></div>
        <div><label className="label" htmlFor="ve">{tr("Versão")}</label><input id="ve" name="version" defaultValue={item.version ?? ""} className="input" /></div>
      </div>
      {state?.error ? <p role="alert" className="text-bad text-sm">{state.error}</p> : null}
      {state?.ok ? <p role="status" className="text-good text-sm">{tr("Guardado.")}</p> : null}
      <button className="btn btn-primary" disabled={pending}>{pending ? tr("A guardar…") : tr("Guardar")}</button>
    </form>
  );
}
