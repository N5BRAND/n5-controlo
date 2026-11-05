"use client";
import { useActionState } from "react";
import { useT } from "@/lib/i18n/client";
import { saveRule, saveTemplate, sendManual } from "./actions";

type Opt = { id: string | number; name: string };
type Result = { error?: string; ok?: string } | undefined;

function Msg({ s }: { s: Result }) {
  if (s?.error) return <p role="alert" className="text-bad text-sm">{s.error}</p>;
  if (s?.ok) return <p role="status" className="text-good text-sm">{s.ok}</p>;
  return null;
}

const TYPES: [string, string][] = [["lembrete", "Lembrete"], ["dica", "Dica de funcionalidade"], ["novidade", "Novidade"], ["oferta", "Oferta"], ["feedback", "Pedido de feedback"], ["fim_trial", "Fim do trial"], ["reativacao", "Reativação"]];

export type TemplateRow = { id: number; name: string; softwareId: string | null; type: string; channel: string; subject: string; body: string; ctaLabel: string | null; ctaUrl: string | null };

export function TemplateForm({ softwares, tpl }: { softwares: Opt[]; tpl?: TemplateRow }) {
  const t = useT();
  const [s, action, pending] = useActionState(saveTemplate, undefined);
  const k = tpl ? `t${tpl.id}` : "tnew";
  return (
    <form action={action} className="space-y-3">
      {tpl ? <input type="hidden" name="id" value={tpl.id} /> : null}
      <div className="grid sm:grid-cols-4 gap-3">
        <div className="sm:col-span-2"><label className="label" htmlFor={`${k}-n`}>{t("Nome interno")}</label><input id={`${k}-n`} name="name" defaultValue={tpl?.name} className="input" required /></div>
        <div><label className="label" htmlFor={`${k}-c`}>{t("Canal")}</label><select id={`${k}-c`} name="channel" defaultValue={tpl?.channel ?? "inapp"} className="input"><option value="inapp">{t("Na app")}</option><option value="email">{t("E-mail")}</option></select></div>
        <div><label className="label" htmlFor={`${k}-t`}>{t("Tipo")}</label><select id={`${k}-t`} name="type" defaultValue={tpl?.type ?? "lembrete"} className="input">{TYPES.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}</select></div>
        <div className="sm:col-span-2"><label className="label" htmlFor={`${k}-sw`}>{t("Software")}</label><select id={`${k}-sw`} name="softwareId" defaultValue={tpl?.softwareId ?? ""} className="input"><option value="">{t("Todos")}</option>{softwares.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
      </div>
      <div><label className="label" htmlFor={`${k}-s`}>{t("Assunto do e-mail ou título na app")}</label><input id={`${k}-s`} name="subject" defaultValue={tpl?.subject} className="input" required /></div>
      <div><label className="label" htmlFor={`${k}-b`}>{t("Texto (variáveis: {vars})", { vars: "{{nome}}, {{dias}}, {{software}}" })}</label><textarea id={`${k}-b`} name="body" rows={5} defaultValue={tpl?.body} className="input" required /></div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div><label className="label" htmlFor={`${k}-cl`}>{t("Texto do botão")}</label><input id={`${k}-cl`} name="ctaLabel" defaultValue={tpl?.ctaLabel ?? ""} className="input" placeholder={t("Abrir o N5 Clara")} /></div>
        <div><label className="label" htmlFor={`${k}-cu`}>{t("Link do botão (https://)")}</label><input id={`${k}-cu`} name="ctaUrl" defaultValue={tpl?.ctaUrl ?? ""} className="input" /></div>
      </div>
      <Msg s={s} />
      <button className="btn btn-primary" disabled={pending}>{tpl ? t("Guardar modelo") : t("Criar modelo")}</button>
    </form>
  );
}

export type RuleRow = { id: number; name: string; softwareId: string | null; inactiveDays: number; audience: string; templateId: number; active: boolean };

export function RuleForm({ softwares, templates, r }: { softwares: Opt[]; templates: Opt[]; r?: RuleRow }) {
  const t = useT();
  const [s, action, pending] = useActionState(saveRule, undefined);
  const k = r ? `r${r.id}` : "rnew";
  return (
    <form action={action} className="space-y-3">
      {r ? <input type="hidden" name="id" value={r.id} /> : null}
      <div className="grid sm:grid-cols-3 gap-3">
        <div><label className="label" htmlFor={`${k}-n`}>{t("Nome")}</label><input id={`${k}-n`} name="name" defaultValue={r?.name} className="input" required /></div>
        <div><label className="label" htmlFor={`${k}-d`}>{t("Dias sem usar")}</label><input id={`${k}-d`} name="inactiveDays" type="number" min={1} defaultValue={r?.inactiveDays ?? 7} className="input" required /></div>
        <div><label className="label" htmlFor={`${k}-a`}>{t("Para quem")}</label><select id={`${k}-a`} name="audience" defaultValue={r?.audience ?? "todos"} className="input"><option value="todos">{t("Todos")}</option><option value="pagante">{t("Pagantes")}</option><option value="trial">{t("Trials")}</option><option value="beta">{t("Beta")}</option></select></div>
        <div><label className="label" htmlFor={`${k}-sw`}>{t("Software")}</label><select id={`${k}-sw`} name="softwareId" defaultValue={r?.softwareId ?? ""} className="input"><option value="">{t("Todos")}</option>{softwares.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
        <div className="sm:col-span-2"><label className="label" htmlFor={`${k}-t`}>{t("Comunicação a enviar")}</label><select id={`${k}-t`} name="templateId" defaultValue={r?.templateId ?? ""} className="input" required><option value="">{t("Escolhe um modelo")}</option>{templates.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={r?.active ?? true} /> {t("Regra ativa")}</label>
      <Msg s={s} />
      <button className="btn btn-primary" disabled={pending}>{r ? t("Guardar regra") : t("Criar regra")}</button>
    </form>
  );
}

export function ManualSend({ personId, templates }: { personId: string; templates: Opt[] }) {
  const t = useT();
  const [s, action, pending] = useActionState(sendManual, undefined);
  return (
    <form action={action} className="flex flex-wrap gap-2 items-center">
      <input type="hidden" name="personId" value={personId} />
      <select name="templateId" className="input w-56" aria-label={t("Modelo a enviar")} required><option value="">{t("Enviar comunicação…")}</option>{templates.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
      <button className="btn" disabled={pending}>{t("Enviar")}</button>
      <Msg s={s} />
    </form>
  );
}
