"use client";
import { useActionState } from "react";
import { useT } from "@/lib/i18n/client";
import { createApiKey, removeExampleData, saveSoftware, saveUser } from "./actions";

type Software = {
  id: string; name: string; code: string; status: string; metaAdAccountId: string | null; metaPixelId: string | null; githubRepos: string[];
  slackPrefix: string | null; activationDefinition: string | null; keyEvents: string[]; cplLimitCents: number | null; costPerAccountLimitCents: number | null;
};

const STATUS: [string, string][] = [["em_construcao", "Em construção"], ["beta", "Beta"], ["lancado", "Lançado"], ["pausado", "Pausado"]];

function Result({ state }: { state?: { error?: string; ok?: string } }) {
  if (state?.error) return <p role="alert" className="text-bad text-sm">{state.error}</p>;
  if (state?.ok) return <p role="status" className="text-good text-sm">{state.ok}</p>;
  return null;
}

export function SoftwareForm({ sw }: { sw?: Software }) {
  const t = useT();
  const [state, action, pending] = useActionState(saveSoftware, undefined);
  const k = sw?.id ?? "novo";
  return (
    <form action={action} className="space-y-3">
      <div className="grid sm:grid-cols-4 gap-3">
        <div><label className="label" htmlFor={`${k}-id`}>{t("Identificador")}</label><input id={`${k}-id`} name="id" defaultValue={sw?.id ?? "sw_"} readOnly={!!sw} className="input num" /></div>
        <div><label className="label" htmlFor={`${k}-name`}>{t("Nome")}</label><input id={`${k}-name`} name="name" defaultValue={sw?.name} className="input" required /></div>
        <div><label className="label" htmlFor={`${k}-code`}>{t("Código do roadmap")}</label><input id={`${k}-code`} name="code" defaultValue={sw?.code} className="input num" placeholder="CLA" required /></div>
        <div><label className="label" htmlFor={`${k}-status`}>{t("Estado")}</label><select id={`${k}-status`} name="status" defaultValue={sw?.status ?? "em_construcao"} className="input">{STATUS.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}</select></div>
        <div><label className="label" htmlFor={`${k}-acc`}>{t("Conta de anúncios Meta")}</label><input id={`${k}-acc`} name="metaAdAccountId" defaultValue={sw?.metaAdAccountId ?? ""} className="input num" placeholder="act_123…" /></div>
        <div><label className="label" htmlFor={`${k}-px`}>{t("Pixel")}</label><input id={`${k}-px`} name="metaPixelId" defaultValue={sw?.metaPixelId ?? ""} className="input num" /></div>
        <div><label className="label" htmlFor={`${k}-slack`}>{t("Prefixo dos canais Slack")}</label><input id={`${k}-slack`} name="slackPrefix" defaultValue={sw?.slackPrefix ?? ""} className="input" placeholder="clara" /></div>
        <div><label className="label" htmlFor={`${k}-repos`}>{t("Repositórios GitHub")}</label><input id={`${k}-repos`} name="githubRepos" defaultValue={sw?.githubRepos.join(", ")} className="input" placeholder="org/repo, org/outro" /></div>
        <div><label className="label" htmlFor={`${k}-cpl`}>{t("Custo por registo máximo (€)")}</label><input id={`${k}-cpl`} name="cplLimit" defaultValue={sw?.cplLimitCents ? sw.cplLimitCents / 100 : ""} className="input num" inputMode="decimal" /></div>
        <div><label className="label" htmlFor={`${k}-cost`}>{t("Custo por conta máximo (€/mês)")}</label><input id={`${k}-cost`} name="costLimit" defaultValue={sw?.costPerAccountLimitCents ? sw.costPerAccountLimitCents / 100 : ""} className="input num" inputMode="decimal" /></div>
      </div>
      <div><label className="label" htmlFor={`${k}-act`}>{t("Definição de ativação")}</label><input id={`${k}-act`} name="activationDefinition" defaultValue={sw?.activationDefinition ?? ""} className="input" /></div>
      <div><label className="label" htmlFor={`${k}-ev`}>{t("Eventos chave (separados por vírgula)")}</label><textarea id={`${k}-ev`} name="keyEvents" rows={2} defaultValue={sw?.keyEvents.join(", ")} className="input num" /></div>
      <Result state={state} />
      <button className="btn btn-primary" disabled={pending}>{sw ? t("Guardar alterações") : t("Criar software")}</button>
    </form>
  );
}

export function UserForm({ softwares }: { softwares: { id: string; name: string }[] }) {
  const t = useT();
  const [state, action, pending] = useActionState(saveUser, undefined);
  return (
    <form action={action} className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <div><label className="label" htmlFor="u-name">{t("Nome")}</label><input id="u-name" name="name" className="input" required /></div>
        <div><label className="label" htmlFor="u-email">{t("E-mail")}</label><input id="u-email" name="email" type="email" className="input" required /></div>
        <div><label className="label" htmlFor="u-role">{t("Função")}</label><select id="u-role" name="role" className="input"><option value="colaborador">{t("Colaborador")}</option><option value="direcao_operacoes">{t("Direção de operações")}</option><option value="socio">{t("Sócio")}</option></select></div>
        <div><label className="label" htmlFor="u-pass">{t("Palavra-passe (12+ caracteres; vazio mantém a atual)")}</label><input id="u-pass" name="password" type="password" autoComplete="new-password" className="input" /></div>
      </div>
      <fieldset><legend className="label">{t("Softwares (só colaboradores)")}</legend>
        <div className="flex flex-wrap gap-3">{softwares.map((s) => <label key={s.id} className="flex gap-1.5 items-center text-sm"><input type="checkbox" name="softwares" value={s.id} />{s.name}</label>)}</div>
      </fieldset>
      <Result state={state} />
      <button className="btn btn-primary" disabled={pending}>{t("Guardar utilizador")}</button>
    </form>
  );
}

export function ApiKeyForm({ softwares, scopes }: { softwares: { id: string; name: string }[]; scopes: readonly string[] }) {
  const t = useT();
  const [state, action, pending] = useActionState(createApiKey, undefined);
  return (
    <form action={action} className="space-y-3">
      <div className="grid sm:grid-cols-3 gap-3">
        <div><label className="label" htmlFor="k-name">{t("Nome")}</label><input id="k-name" name="name" className="input" placeholder={t("N5 Clara produção")} required /></div>
        <div><label className="label" htmlFor="k-sw">{t("Restringir a um software")}</label><select id="k-sw" name="softwareId" className="input"><option value="">{t("Todos")}</option>{softwares.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div><label className="label" htmlFor="k-m">{t("Validade (meses, máx. 12)")}</label><input id="k-m" name="months" type="number" min={1} max={12} defaultValue={12} className="input" /></div>
      </div>
      <fieldset><legend className="label">{t("Permissões")}</legend>
        <div className="flex flex-wrap gap-3">{scopes.map((s) => <label key={s} className="flex gap-1.5 items-center text-sm num"><input type="checkbox" name="scopes" value={s} />{s}</label>)}</div>
      </fieldset>
      {state?.error ? <p role="alert" className="text-bad text-sm">{state.error}</p> : null}
      {state?.key ? (
        <div role="status" className="rounded-md border border-warn/40 bg-warn/5 p-3 text-sm">
          <p className="font-semibold">{t("Copia a chave agora: não volta a ser mostrada.")}</p>
          <code className="num block break-all mt-1 select-all">{state.key}</code>
        </div>
      ) : null}
      <button className="btn btn-primary" disabled={pending}>{t("Criar chave")}</button>
    </form>
  );
}

export function ExampleDataForm({ total }: { total: number }) {
  const t = useT();
  const [state, action, pending] = useActionState(removeExampleData, undefined);
  return (
    <form action={action} className="space-y-3">
      <div className="max-w-xs"><label className="label" htmlFor="confirmar-exemplo">{t("Escreve APAGAR para confirmar")}</label>
        <input id="confirmar-exemplo" name="confirmar" className="input num" autoComplete="off" disabled={!total} /></div>
      <Result state={state} />
      <button className="btn btn-primary" disabled={pending || !total}>{pending ? t("A apagar…") : t("Apagar dados de exemplo")}</button>
    </form>
  );
}
