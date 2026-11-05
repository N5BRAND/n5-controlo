import { requireUser, scopeSoftwares } from "@/lib/auth";
import { readFilters } from "@/lib/filters";
import { campaigns, softwaresFor } from "@/lib/queries";
import { fmtEur, fmtNum, fmtPct } from "@/lib/format";
import { Bar, Empty, Kpi, PageHeader, Tabs, withParams } from "@/components/ui";
import { syncMetaLive } from "@/lib/meta";
import { MetaLida } from "../MetaLida";
import { syncNow } from "../actions";

export default async function TodasAsCampanhas({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser("campanhas");
  const sp = await searchParams;
  const filters = readFilters(sp);
  const sws = await softwaresFor(user);
  const ids = scopeSoftwares(user, filters.software, sws);
  // números da Meta ao vivo: cada abertura lê os últimos dias antes de mostrar
  const live = await syncMetaLive();
  const { rows, funnel } = await campaigns(ids, filters.range);
  const swName = (id: string) => sws.find((s) => s.id === id)?.name ?? id;
  const stages = funnel ? [
    { label: "Impressões", n: funnel.impressions }, { label: "Cliques", n: funnel.clicks }, { label: "Registos", n: funnel.signups },
    { label: "Ativações", n: funnel.activated }, { label: "Clientes pagantes", n: funnel.paying },
  ] : [];

  return (
    <>
      <PageHeader title="Campanhas e funil" lead="Do gasto na Meta ao cliente pagante, por software.">
        <MetaLida live={live} action={syncNow} />
      </PageHeader>
      <Tabs items={[{ key: "monitorizacao", label: "Monitorização", href: withParams("/campanhas", sp) }, { key: "todas", label: "Todas as campanhas", href: withParams("/campanhas/todas", sp) }]} active="todas" />
      {funnel ? (
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <Kpi label="Gasto" value={fmtEur(funnel.spend)} />
          <Kpi label="Registos" value={fmtNum(funnel.signups)} note={funnel.signups ? `${fmtEur(Math.round(funnel.spend / funnel.signups))} por registo` : undefined} />
          <Kpi label="Clientes pagantes" value={fmtNum(funnel.paying)} note={`CAC ${fmtEur(funnel.cac)}`} />
          <Kpi label="Registos sem atribuição" value={funnel.signups ? fmtPct(funnel.unattributed / funnel.signups) : "–"}
            tone={funnel.signups && funnel.unattributed / funnel.signups > 0.2 ? "warn" : undefined} note="alerta acima de 20%" />
        </section>
      ) : null}
      <div>
        <div className="space-y-4 min-w-0">
          <section className="card">
            <h2 className="h2">Funil do período</h2>
            {stages.every((s) => s.n === 0) ? <p className="text-muted">Sem dados no período.</p> : (
              <ol className="space-y-2">
                {stages.map((s, i) => {
                  // Cliques em % das impressões; o resto em % dos registos (as etapas depois do registo não são subconjuntos exatos)
                  const base = i === 0 || i === 2 ? null : i === 1 ? stages[0].n : stages[2].n;
                  const baseLabel = i === 1 ? "das impressões" : "dos registos";
                  return (
                    <li key={s.label} className="grid grid-cols-[130px_1fr_190px] gap-3 items-center text-sm">
                      <span>{s.label}</span><Bar value={s.n} max={stages[0].n || 1} />
                      <span className="num text-right">{fmtNum(s.n)}{base ? <span className="text-muted text-xs"> · {fmtPct(s.n / base)} {baseLabel}</span> : null}</span>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
          <section className="card overflow-x-auto">
            <h2 className="h2">Campanhas</h2>
            {rows.length === 0 ? <Empty title="Sem campanhas no período">Liga a conta de anúncios do software nas Definições e sincroniza.</Empty> : (
              <table className="tbl">
                <thead><tr><th>Campanha</th><th>Software</th><th className="text-right">Gasto</th><th className="text-right">CPM</th><th className="text-right">CTR</th><th className="text-right">CPC</th><th className="text-right">Leads</th><th className="text-right">CPL</th><th className="text-right">Registos</th><th className="text-right">Pagantes</th><th className="text-right">CAC</th><th className="text-right">Freq. máx.</th></tr></thead>
                <tbody>{rows.map((r) => (
                  <tr key={r.sw + r.campaignId}>
                    <td className="max-w-xs">{r.name}</td><td>{swName(r.sw)}</td><td className="num text-right">{fmtEur(r.spend)}</td>
                    <td className="num text-right">{fmtEur(r.cpm === null ? null : Math.round(r.cpm))}</td><td className="num text-right">{fmtPct(r.ctr, 2)}</td>
                    <td className="num text-right">{fmtEur(r.cpc === null ? null : Math.round(r.cpc))}</td><td className="num text-right">{fmtNum(r.leads)}</td>
                    <td className="num text-right">{fmtEur(r.cpl === null ? null : Math.round(r.cpl))}</td><td className="num text-right">{fmtNum(r.signups)}</td>
                    <td className="num text-right">{fmtNum(r.paying)}</td><td className="num text-right">{fmtEur(r.cac)}</td>
                    <td className={`num text-right ${r.freq > 3 ? "text-warn font-semibold" : ""}`}>{r.freq ? r.freq.toFixed(2) : "–"}</td>
                  </tr>))}</tbody>
              </table>
            )}
            <p className="text-xs text-muted mt-3">Registos e pagantes por campanha usam a UTM utm_campaign igual ao nome da campanha (convenção software_objetivo_público_data).</p>
          </section>
        </div>
      </div>
    </>
  );
}
