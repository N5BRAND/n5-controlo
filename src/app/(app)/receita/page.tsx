import { requireUser, scopeSoftwares } from "@/lib/auth";
import { readFilters } from "@/lib/filters";
import { accounts, revenue, softwaresFor, trials, usageStats } from "@/lib/queries";
import { acvCents, arpaCents } from "@/lib/metrics";
import { fmtDate, fmtEur, fmtNum, fmtPct } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { Bar, Empty, Kpi, PageHeader, Pill, Tabs, withParams } from "@/components/ui";

type SP = Record<string, string | string[] | undefined>;

export default async function Receita({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("receita");
  const t = await getT();
  const sp = await searchParams;
  const filters = readFilters(sp);
  const sws = await softwaresFor(user);
  const ids = scopeSoftwares(user, filters.software, sws);
  const vista = typeof sp.vista === "string" ? sp.vista : "receita";
  const tabs = [
    { key: "receita", label: t("Receita") }, { key: "contas", label: t("Contas e margem") }, { key: "utilizacao", label: t("Utilização") }, { key: "trials", label: t("Trials") },
  ].map((t) => ({ ...t, href: withParams("/receita", sp, { vista: t.key }) }));
  const swName = (id: string) => sws.find((s) => s.id === id)?.name ?? id;
  return (
    <>
      <PageHeader title={t("Utilização e receita")} lead={t("Quanto cada software fatura, quanto cada conta usa e quanto deixa de margem. Euros sem IVA.")} />
      <Tabs items={tabs} active={vista} />
      {vista === "receita" ? <RevenueView ids={ids} /> : null}
      {vista === "contas" ? <AccountsView ids={ids} swName={swName} /> : null}
      {vista === "utilizacao" ? <UsageView ids={ids} sp={sp} /> : null}
      {vista === "trials" ? <TrialsView ids={ids} swName={swName} /> : null}
    </>
  );
}

async function RevenueView({ ids }: { ids: string[] }) {
  const t = await getT();
  const r = await revenue(ids);
  const accs = await accounts(ids);
  if (!r || r.series.length === 0) return <Empty title={t("Ainda não há receita registada")}>{t("Liga o Stripe (webhooks) nas Definições. O MRR é gravado todos os dias.")}</Empty>;
  const last = r.series[r.series.length - 1];
  const paying = accs.filter((a) => ["active", "past_due"].includes(a.sub.status));
  const acvAvg = paying.length ? paying.reduce((s, a) => s + acvCents(a.sub.mrrCents, 0, Math.max(1, Math.round((Date.now() - a.sub.startedAt.getTime()) / (30 * 864e5)))), 0) / paying.length : null;
  const max = Math.max(...r.series.map((s) => s.endCents), 1);
  return (
    <>
      <section className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        <Kpi label="MRR" value={fmtEur(last.endCents)} />
        <Kpi label="ARR" value={fmtEur(last.endCents * 12)} />
        <Kpi label="ARPA" value={fmtEur(arpaCents(last.endCents, paying.length))} note={t("{n} contas pagantes", { n: paying.length })} />
        <Kpi label={t("ACV médio")} value={fmtEur(acvAvg === null ? null : Math.round(acvAvg))} note={t("MRR × 12 + consumo extra")} />
        <Kpi label={t("Churn do mês")} value={last.startAccounts ? fmtPct(last.churnedAccounts / last.startAccounts) : "–"} note={t("{n} contas perdidas de {total}", { n: last.churnedAccounts, total: last.startAccounts })} />
      </section>
      <section className="card overflow-x-auto">
        <h2 className="h2">{t("MRR mês a mês")}</h2>
        <table className="tbl">
          <thead><tr><th>{t("Mês")}</th><th className="w-1/3">MRR</th><th className="text-right">{t("Novo")}</th><th className="text-right">{t("Expansão")}</th><th className="text-right">{t("Contração")}</th><th className="text-right">{t("Churn")}</th><th className="text-right">{t("Fim do mês")}</th></tr></thead>
          <tbody>{r.series.map((s) => (
            <tr key={s.month}>
              <td className="num">{s.month}</td><td><Bar value={s.endCents} max={max} /></td>
              <td className="num text-right text-good">{fmtEur(s.newCents)}</td><td className="num text-right text-good">{fmtEur(s.expansionCents)}</td>
              <td className="num text-right text-warn">{s.contractionCents ? fmtEur(-s.contractionCents) : fmtEur(0)}</td><td className="num text-right text-bad">{s.churnCents ? fmtEur(-s.churnCents) : fmtEur(0)}</td>
              <td className="num text-right font-semibold">{fmtEur(s.endCents)}</td>
            </tr>))}</tbody>
        </table>
      </section>
    </>
  );
}

async function AccountsView({ ids, swName }: { ids: string[]; swName: (id: string) => string }) {
  const t = await getT();
  const rows = await accounts(ids);
  if (!rows.length) return <Empty title={t("Sem contas ainda")} />;
  return (
    <section className="card overflow-x-auto">
      <table className="tbl">
        <thead><tr><th>{t("Conta")}</th><th>{t("Software")}</th><th>{t("Plano")}</th><th>{t("Estado")}</th><th className="text-right">MRR</th><th className="text-right">{t("Custo do mês")}</th><th className="text-right">{t("Margem")}</th><th className="text-right">{t("Pessoas ativas (30 d)")}</th><th>{t("Última atividade")}</th><th>{t("Saúde")}</th></tr></thead>
        <tbody>{rows.sort((a, b) => a.marginCents - b.marginCents).map((a) => (
          <tr key={a.sub.id}>
            <td>{a.org.name}{a.org.isExample ? <> <Pill>{t("exemplo")}</Pill></> : null}</td><td>{swName(a.sub.softwareId)}</td><td>{a.sub.plan}</td><td>{a.sub.status}</td>
            <td className="num text-right">{fmtEur(a.sub.mrrCents)}</td><td className="num text-right">{fmtEur(a.costCents)}</td>
            <td className={`num text-right ${a.marginCents < 0 ? "text-bad font-semibold" : ""}`}>{fmtEur(a.marginCents)}</td>
            <td className="num text-right">{fmtNum(a.activePeople)}</td>
            <td>{a.daysSinceSeen === null ? t("sem eventos") : a.daysSinceSeen === 0 ? t("hoje") : a.daysSinceSeen === 1 ? t("há 1 dia") : t("há {n} dias", { n: a.daysSinceSeen })}</td>
            <td><Pill tone={a.health}>{a.health}</Pill></td>
          </tr>))}</tbody>
      </table>
      <p className="text-xs text-muted mt-3">{t("Margem do mês = mensalidade menos o registo de consumo da conta. Ordenado da pior para a melhor margem.")}</p>
    </section>
  );
}

async function UsageView({ ids, sp }: { ids: string[]; sp: SP }) {
  const t = await getT();
  const u = await usageStats(ids, readFilters(sp).range);
  if (!u) return <Empty title={t("Sem softwares neste filtro")} />;
  const maxOrgs = Math.max(...u.features.map((f) => f.orgs), 1);
  return (
    <>
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Kpi label={t("Ativos hoje")} value={fmtNum(u.dau)} />
        <Kpi label={t("Ativos em 7 dias")} value={fmtNum(u.wau)} />
        <Kpi label={t("Ativos em 30 dias")} value={fmtNum(u.mau)} note={u.mau ? t("DAU/MAU {v}", { v: fmtPct(u.dau / u.mau) }) : undefined} />
        <Kpi label={t("Tempo na app por pessoa e dia")} value={u.minutesPerPersonDay === null ? "–" : t("{n} min", { n: u.minutesPerPersonDay.toFixed(0) })} note={t("sinais de 60 s com a app aberta")} />
      </section>
      <section className="card">
        <h2 className="h2">{t("Funcionalidades, das mais às menos usadas")}</h2>
        {u.features.length === 0 ? <p className="text-muted">{t("Sem eventos de funcionalidade no período.")}</p> : (
          <ol className="space-y-2">{u.features.map((f) => (
            <li key={f.feature} className="grid grid-cols-[220px_1fr_170px] gap-3 items-center text-sm">
              <span className="truncate" title={f.feature ?? ""}>{f.feature}</span><Bar value={f.orgs} max={maxOrgs} tone={u.activeOrgs && f.orgs / u.activeOrgs < 0.1 ? "warn" : "accent"} />
              <span className="num text-right">{t("{contas} contas · {usos} usos", { contas: fmtNum(f.orgs), usos: fmtNum(f.uses) })}</span>
            </li>))}</ol>
        )}
      </section>
    </>
  );
}

async function TrialsView({ ids, swName }: { ids: string[]; swName: (id: string) => string }) {
  const tr = await trials(ids);
  const t = await getT();
  return (
    <>
      <section className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
        <Kpi label={t("Trials ativos")} value={fmtNum(tr.active.length)} />
        <Kpi label={t("A terminar em 3 dias")} value={fmtNum(tr.active.filter((r) => r.s.trialEnd && r.s.trialEnd.getTime() - Date.now() < 3 * 864e5).length)} />
        <Kpi label={t("Conversão de trials")} value={fmtPct(tr.conversion)} />
      </section>
      <section className="card overflow-x-auto">
        {tr.active.length === 0 ? <p className="text-muted">{t("Sem trials ativos.")}</p> : (
          <table className="tbl"><thead><tr><th>{t("Conta")}</th><th>{t("Software")}</th><th>{t("Plano")}</th><th>{t("Termina")}</th></tr></thead>
            <tbody>{tr.active.map((r) => <tr key={r.s.id}><td>{r.o.name}</td><td>{swName(r.s.softwareId)}</td><td>{r.s.plan}</td><td>{fmtDate(r.s.trialEnd)}</td></tr>)}</tbody></table>
        )}
      </section>
    </>
  );
}
