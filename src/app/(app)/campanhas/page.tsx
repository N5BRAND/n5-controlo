import { requireUser, scopeSoftwares } from "@/lib/auth";
import { readFilters } from "@/lib/filters";
import { campaigns, softwaresFor } from "@/lib/queries";
import { fmtEur, fmtNum, fmtPct } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { Bar, Empty, Kpi, PageHeader } from "@/components/ui";
import { ImportForm } from "./ImportForm";
import { syncNow } from "./actions";

export default async function Campanhas({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser("campanhas");
  const t = await getT();
  const sp = await searchParams;
  const filters = readFilters(sp);
  const sws = await softwaresFor(user);
  const ids = scopeSoftwares(user, filters.software, sws);
  const { rows, funnel } = await campaigns(ids, filters.range);
  const swName = (id: string) => sws.find((s) => s.id === id)?.name ?? id;
  const stages = funnel ? [
    { label: t("Impressões"), n: funnel.impressions }, { label: t("Cliques"), n: funnel.clicks }, { label: t("Registos"), n: funnel.signups },
    { label: t("Ativações"), n: funnel.activated }, { label: t("Clientes pagantes"), n: funnel.paying },
  ] : [];

  return (
    <>
      <PageHeader title={t("Campanhas e funil")} lead={t("Do gasto na Meta ao cliente pagante, por software.")}>
        <form action={syncNow}><button className="btn">{t("Sincronizar Meta agora")}</button></form>
      </PageHeader>
      {funnel ? (
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <Kpi label={t("Gasto")} value={fmtEur(funnel.spend)} />
          <Kpi label={t("Registos")} value={fmtNum(funnel.signups)} note={funnel.signups ? t("{v} por registo", { v: fmtEur(Math.round(funnel.spend / funnel.signups)) }) : undefined} />
          <Kpi label={t("Clientes pagantes")} value={fmtNum(funnel.paying)} note={t("CAC {v}", { v: fmtEur(funnel.cac) })} />
          <Kpi label={t("Registos sem atribuição")} value={funnel.signups ? fmtPct(funnel.unattributed / funnel.signups) : "–"}
            tone={funnel.signups && funnel.unattributed / funnel.signups > 0.2 ? "warn" : undefined} note={t("alerta acima de 20%")} />
        </section>
      ) : null}
      <div className="grid lg:grid-cols-[1fr_340px] gap-4">
        <div className="space-y-4 min-w-0">
          <section className="card">
            <h2 className="h2">{t("Funil do período")}</h2>
            {stages.every((s) => s.n === 0) ? <p className="text-muted">{t("Sem dados no período.")}</p> : (
              <ol className="space-y-2">
                {stages.map((s, i) => {
                  // Cliques em % das impressões; o resto em % dos registos (as etapas depois do registo não são subconjuntos exatos)
                  const base = i === 0 || i === 2 ? null : i === 1 ? stages[0].n : stages[2].n;
                  const baseLabel = i === 1 ? t("das impressões") : t("dos registos");
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
            <h2 className="h2">{t("Campanhas")}</h2>
            {rows.length === 0 ? <Empty title={t("Sem campanhas no período")}>{t("Liga a conta de anúncios do software nas Definições e sincroniza, ou importa um CSV.")}</Empty> : (
              <table className="tbl">
                <thead><tr><th>{t("Campanha")}</th><th>{t("Software")}</th><th className="text-right">{t("Gasto")}</th><th className="text-right">CPM</th><th className="text-right">CTR</th><th className="text-right">CPC</th><th className="text-right">{t("Leads")}</th><th className="text-right">CPL</th><th className="text-right">{t("Registos")}</th><th className="text-right">{t("Pagantes")}</th><th className="text-right">CAC</th><th className="text-right">{t("Freq. máx.")}</th></tr></thead>
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
            <p className="text-xs text-muted mt-3">{t("Registos e pagantes por campanha usam a UTM utm_campaign igual ao nome da campanha (convenção software_objetivo_público_data).")}</p>
          </section>
        </div>
        <ImportForm softwares={sws.filter((s) => ids.includes(s.id))} />
      </div>
    </>
  );
}
