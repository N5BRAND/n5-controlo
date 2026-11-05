"use client";
import { useActionState } from "react";
import { useT } from "@/lib/i18n/client";
import { saveSettings, saveTask } from "./actions";

type Result = { error?: string; ok?: string } | undefined;

function Msg({ s }: { s: Result }) {
  if (s?.error) return <p role="alert" className="text-bad text-sm">{s.error}</p>;
  if (s?.ok) return <p role="status" className="text-good text-sm">{s.ok}</p>;
  return null;
}

export function SettingsForm({ softwareId, hourValue, defaultWeeklyHours, fastResponseMinutes, minSample }: { softwareId: string; hourValue: number; defaultWeeklyHours: number; fastResponseMinutes: number; minSample: number }) {
  const t = useT();
  const [s, action, pending] = useActionState(saveSettings, undefined);
  const k = `set-${softwareId}`;
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="softwareId" value={softwareId} />
      <div className="text-sm font-semibold">{t("Valores de reserva e regras de cálculo")}</div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div><label className="label" htmlFor={`${k}-h`}>{t("Valor da hora sem onboarding (€)")}</label><input id={`${k}-h`} name="hourValue" type="number" step="0.5" min="1" defaultValue={hourValue} className="input" required /></div>
        <div><label className="label" htmlFor={`${k}-w`}>{t("Horas por semana se não indicadas")}</label><input id={`${k}-w`} name="defaultWeeklyHours" type="number" step="1" min="1" max="100" defaultValue={defaultWeeklyHours} className="input" required /></div>
        <div><label className="label" htmlFor={`${k}-f`}>{t("Resposta rápida até (min)")}</label><input id={`${k}-f`} name="fastResponseMinutes" type="number" step="1" min="1" defaultValue={fastResponseMinutes} className="input" required /></div>
        <div><label className="label" htmlFor={`${k}-m`}>{t("Amostra mínima por grupo (leads)")}</label><input id={`${k}-m`} name="minSample" type="number" step="1" min="10" defaultValue={minSample} className="input" required /></div>
      </div>
      <Msg s={s} />
      <button className="btn btn-primary" disabled={pending}>{t("Guardar pressupostos")}</button>
    </form>
  );
}

export type TaskFormRow = { id: number; softwareId: string; key: string; label: string; manualMinutes: string; remainingMinutes: string; basis: string | null; validated: boolean; active: boolean };

export function TaskForm({ softwareId, task }: { softwareId: string; task?: TaskFormRow }) {
  const t = useT();
  const [s, action, pending] = useActionState(saveTask, undefined);
  const k = task ? `task-${task.id}` : `task-new-${softwareId}`;
  return (
    <form action={action} className="space-y-3">
      {task ? <input type="hidden" name="id" value={task.id} /> : null}
      <input type="hidden" name="softwareId" value={softwareId} />
      <div className="grid sm:grid-cols-4 gap-3">
        <div className="sm:col-span-2"><label className="label" htmlFor={`${k}-l`}>{t("Tarefa")}</label><input id={`${k}-l`} name="label" defaultValue={task?.label} className="input" required /></div>
        <div className="sm:col-span-2"><label className="label" htmlFor={`${k}-k`}>{t("Código no evento (task)")}</label><input id={`${k}-k`} name="key" defaultValue={task?.key} className="input font-mono" required readOnly={!!task} /></div>
        <div><label className="label" htmlFor={`${k}-m`}>{t("Minutos à mão, sem o software")}</label><input id={`${k}-m`} name="manualMinutes" type="number" step="0.1" min="0.1" defaultValue={task ? Number(task.manualMinutes) : undefined} className="input" required /></div>
        <div><label className="label" htmlFor={`${k}-r`}>{t("Minutos que ficam para a pessoa")}</label><input id={`${k}-r`} name="remainingMinutes" type="number" step="0.1" min="0" defaultValue={task ? Number(task.remainingMinutes) : 0} className="input" required /></div>
        <div className="sm:col-span-2"><label className="label" htmlFor={`${k}-b`}>{t("Como se mediu o tempo")}</label><input id={`${k}-b`} name="basis" defaultValue={task?.basis ?? ""} className="input" placeholder={t("Ex.: cronometragem com 5 consultores, out 2026")} /></div>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" name="validated" defaultChecked={task?.validated} /> {t("Tempo validado com utilizadores")}</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="active" value="on" defaultChecked={task?.active ?? true} onChange={(e) => { const h = e.currentTarget.form?.querySelector<HTMLInputElement>(`input[name=active][type=hidden]`); if (h) h.disabled = e.currentTarget.checked; }} /> {t("Conta para o impacto")}</label>
        <input type="hidden" name="active" value="off" disabled={task?.active ?? true} />
      </div>
      <Msg s={s} />
      <button className="btn btn-primary" disabled={pending}>{task ? t("Guardar tarefa") : t("Acrescentar tarefa")}</button>
    </form>
  );
}
