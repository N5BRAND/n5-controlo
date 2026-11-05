import Link from "next/link";
import { redirect } from "next/navigation";
import { canSee, getCurrentUser, requireUser } from "@/lib/auth";
import { readFilters } from "@/lib/filters";
import { overview } from "@/lib/queries";
import { delta, fmtEur, fmtNum, fmtPct, LABELS } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { Delta, Empty, Kpi, PageHeader, Pill, withParams } from "@/components/ui";

export default async function PainelGeral({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Quem não vê o Painel (colaboradores) vai direto para o Pipeline, em vez de "Sem acesso".
  const current = await getCurrentUser();
  if (current && !canSee(current.role, "painel")) redirect("/pipeline");
  await requireUser("painel");
  const t = await getT();
  const sp = await searchParams;
  const { range } = readFilters(sp);
  const { rows, totals } = await overview(range);

  return (
    <>
      <PageHeader title={t("Painel geral")} lead={t("Todos os softwares N5 lado a lado. Valores em euros sem IVA.")} />
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6" aria-label={t("Totais N5")}>
        <Kpi label="MRR" value={fmtEur(totals.mrr)} note={totals.mrrPrev === null ? t("sem mês anterior") : <Delta value={delta(totals.mrr, totals.mrrPrev)} />} />
        <Kpi label="ARR" value={fmtEur(totals.arr)} note={t("MRR × 12")} />
        <Kpi label={t("Contas pagantes")} value={fmtNum(totals.paying)} note={t("{n} trials ativos", { n: fmtNum(totals.trials) })} />
        <Kpi label={t("Gasto Meta no período")} value={fmtEur(totals.spend)} note={<Delta value={delta(totals.spend, totals.spendPrev)} neutral />} />
        <Kpi label={t("CAC médio")} value={fmtEur(totals.cac)} note={t("{n} novos clientes pagantes", { n: fmtNum(totals.newPaying) })} />
        <Kpi label={t("Margem bruta (30 dias)")} value={fmtPct(totals.margin)} note={t("MRR menos o registo de consumo")}
          tone={totals.margin === null ? undefined : totals.margin >= 0.75 ? "good" : totals.margin >= 0.5 ? "warn" : "bad"} />
        <Kpi label={t("Alertas críticos abertos")} value={fmtNum(totals.criticalAlerts)} tone={totals.criticalAlerts ? "bad" : "good"}
          note={<Link className="underline" href={withParams("/alertas", sp)}>{t("Abrir centro de alertas")}</Link>} />
      </section>

      {rows.length === 0 ? (
        <Empty title={t("Ainda não há softwares")}>{t("Cria o primeiro em")} <Link className="underline" href="/definicoes">{t("Definições")}</Link>.</Empty>
      ) : (
        <section className="card overflow-x-auto" aria-label={t("Softwares")}>
          <table className="tbl">
            <thead>
              <tr>
                <th>{t("Software")}</th><th className="text-right">MRR</th><th className="text-right">{t("Pagantes")}</th><th className="text-right">{t("Trials")}</th>
                <th className="text-right">CAC</th><th className="text-right">{t("Margem")}</th><th>{t("Feedback aberto")}</th><th>{t("Versão")}</th><th>{t("Alertas")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sw.id}>
                  <td>
                    <Link className="font-semibold underline-offset-2 hover:underline" href={withParams("/receita", { ...sp, sw: r.sw.id })}>{r.sw.name}</Link>
                    <div><Pill tone={r.sw.status === "lancado" ? "verde" : r.sw.status === "beta" ? "accent" : "neutro"}>{t(LABELS.softwareStatus[r.sw.status])}</Pill></div>
                  </td>
                  <td className="num text-right">{fmtEur(r.mrr)}<div className="text-xs">{r.mrrPrev === null ? "" : <Delta value={delta(r.mrr, r.mrrPrev)} />}</div></td>
                  <td className="num text-right">{fmtNum(r.paying)}</td>
                  <td className="num text-right">{fmtNum(r.trials)}</td>
                  <td className="num text-right">{fmtEur(r.cac)}</td>
                  <td className="num text-right">{fmtPct(r.margin)}</td>
                  <td>
                    <Link href={withParams("/comunidades", { ...sp, sw: r.sw.id })} className="hover:underline">{fmtNum(r.feedbackOpen)}</Link>
                    {r.criticalBugs ? <> · <Pill tone="critico">{r.criticalBugs === 1 ? t("{n} bug crítico", { n: r.criticalBugs }) : t("{n} bugs críticos", { n: r.criticalBugs })}</Pill></> : null}
                  </td>
                  <td>{r.nextRelease ? <>{r.nextRelease.version} <span className="text-xs text-muted">{r.nextRelease.published ? t("publicada") : t("em preparação")}</span></> : <span className="text-muted">–</span>}</td>
                  <td className="space-x-1">
                    {r.alerts.critico ? <Pill tone="critico">{t("{n} críticos", { n: r.alerts.critico })}</Pill> : null}
                    {r.alerts.aviso ? <Pill tone="aviso">{t("{n} avisos", { n: r.alerts.aviso })}</Pill> : null}
                    {!r.alerts.critico && !r.alerts.aviso ? <span className="text-muted">–</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
