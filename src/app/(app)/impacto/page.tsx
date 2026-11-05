import { requireUser, scopeSoftwares } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import type { TFn } from "@/lib/i18n";
import { readFilters } from "@/lib/filters";
import { softwaresFor } from "@/lib/queries";
import { catalogFor, hoursPerMonth, loadImpact, settingsFor, type ImpactBlock } from "@/lib/impact";
import { fmtEur0, fmtNum, fmtPct } from "@/lib/format";
import { Bar, Empty, Kpi, PageHeader, Pill, Tabs, withParams } from "@/components/ui";
import { SettingsForm, TaskForm } from "./forms";

type SP = Record<string, string | string[] | undefined>;

const fmtH = (minutes: number) => `${(minutes / 60).toLocaleString("pt-PT", { maximumFractionDigits: minutes < 600 ? 1 : 0 })} h`;
const fmtX = (x: number | null) => (x == null ? "–" : `${x.toLocaleString("pt-PT", { maximumFractionDigits: x < 10 ? 1 : 0 })}×`);
function fmtDur(seconds: number | null) {
  if (seconds == null) return "–";
  if (seconds < 90) return `${Math.round(seconds)} s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toLocaleString("pt-PT", { maximumFractionDigits: 1 })} h`;
}

export default async function Impacto({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("impacto");
  const t = await getT();
  const sp = await searchParams;
  const filters = readFilters(sp);
  const sws = await softwaresFor(user);
  const ids = scopeSoftwares(user, filters.software, sws);
  const vista = typeof sp.vista === "string" ? sp.vista : "resumo";
  const tabs = [{ key: "resumo", label: t("Resumo") }, { key: "tarefas", label: t("Tempo poupado por tarefa") }, { key: "leads", label: t("Leads e negócio") }, { key: "contas", label: t("Por conta") }, { key: "pressupostos", label: t("Pressupostos") }]
    .map((tb) => ({ ...tb, href: withParams("/impacto", sp, { vista: tb.key }) }));
  const swName = (id: string) => sws.find((s) => s.id === id)?.name ?? id;
  const [data, settings] = await Promise.all([loadImpact(ids, filters.range), settingsFor(ids)]);

  return (
    <>
      <PageHeader title={t("Impacto")} lead={t("A prova de que cada software compensa para quem o usa: tempo poupado em cada tarefa, leads atendidas a tempo que de outra forma se perdiam e o negócio que daí resulta.")} />
      <Tabs items={tabs} active={vista} />
      {!ids.length ? <Empty title={t("Sem softwares neste filtro")} /> : null}
      {vista === "resumo" ? ids.map((id) => <Resumo key={id} name={swName(id)} b={data.bySoftware.get(id)!} months={data.months} fastMin={settings.get(id)!.fastResponseMinutes} />) : null}
      {vista === "resumo" && ids.length ? <ComoLer /> : null}
      {vista === "tarefas" ? ids.map((id) => <Tarefas key={id} name={swName(id)} b={data.bySoftware.get(id)!} />) : null}
      {vista === "leads" ? ids.map((id) => <Leads key={id} name={swName(id)} b={data.bySoftware.get(id)!} fastMin={settings.get(id)!.fastResponseMinutes} minSample={settings.get(id)!.minSample} />) : null}
      {vista === "contas" ? <Contas accounts={data.accounts} swName={swName} months={data.months} /> : null}
      {vista === "pressupostos" ? <Pressupostos ids={ids} swName={swName} settings={settings} data={data} /> : null}
    </>
  );
}

function hourNote(b: ImpactBlock, t: TFn) {
  const h = b.hourValue;
  if (!h.accounts) return t("sem contas com dados");
  if (!h.fromProfile) return t("{eur}/h de reserva: nenhuma conta respondeu ao onboarding", { eur: fmtEur0(h.fallbackCents) });
  return t("valor da hora de cada conta, do onboarding ({n} de {total} contas, mediana {eur}/h)", { n: h.fromProfile, total: h.accounts, eur: fmtEur0(h.medianCents) });
}

async function Resumo({ name, b, months, fastMin }: { name: string; b: ImpactBlock; months: number; fastMin: number }) {
  const t = await getT();
  const l = b.leads;
  if (!b.tasks.length && !l.total) {
    return <section className="mb-6"><h2 className="h2">{name}</h2><Empty title={t("Ainda sem dados de impacto")}>{t("Aparecem quando o software enviar os eventos task.completed, lead.received e lead.first_response.")}</Empty></section>;
  }
  const roiTone = b.roiTime == null ? undefined : b.roiTime >= 3 ? "good" : b.roiTime >= 1 ? "warn" : "bad";
  return (
    <section className="mb-8">
      <h2 className="h2 flex items-center gap-2">{name} <span className="text-xs text-muted font-normal">{t("{n} contas pagantes", { n: fmtNum(b.accounts) })}</span></h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label={t("Tempo poupado")} value={fmtH(b.minutesSaved)} note={t("{h} h por conta por mês · medido", { h: hoursPerMonth(b.minutesSaved, months, b.accounts).toLocaleString("pt-PT", { maximumFractionDigits: 1 }) })} tone="good" />
        <Kpi label={t("Valor desse tempo")} value={fmtEur0(b.timeValueCents)} note={hourNote(b, t)} />
        <Kpi label={t("Retorno por cada € pago")} value={fmtX(b.roiTime)} tone={roiTone} note={<>{t("só com o tempo poupado")}{b.roiWithBusiness != null ? <> · {t("com negócio protegido:")} <strong>{fmtX(b.roiWithBusiness)}</strong></> : null}</>} />
        <Kpi label={t("Negócio protegido (estimado)")} value={l.protectedCommissionCents != null ? fmtEur0(l.protectedCommissionCents) : "–"}
          note={l.protectedDeals != null ? t("{n} negócios que se perderiam sem resposta fora de horas", { n: l.protectedDeals.toLocaleString("pt-PT", { maximumFractionDigits: 1 }) }) : t("amostra ainda insuficiente para estimar")} />
        <Kpi label={t("Leads atendidas fora de horas pela IA")} value={fmtNum(l.afterHoursByAi)} note={t("{visits} visitas e {deals} negócios saíram daqui · medido", { visits: fmtNum(l.afterHoursByAiVisits), deals: fmtNum(l.afterHoursByAiDeals) })} />
        <Kpi label={t("Primeira resposta (mediana)")} value={fmtDur(l.medianSeconds)} note={t("IA {ai} · pessoa {human}", { ai: fmtDur(l.medianAiSeconds), human: fmtDur(l.medianHumanSeconds) })} />
        <Kpi label={t("Leads respondidas em {min} min", { min: fastMin })} value={fmtPct(l.fastShare)} note={t("{n} leads no período", { n: fmtNum(l.total) })} />
        <Kpi label={t("Negócios com 1.ª resposta da IA")} value={fmtNum(l.dealsFirstByAi)} note={t("{eur} em comissões · influenciado, não causado", { eur: fmtEur0(l.commissionFirstByAiCents) })} />
      </div>
      {b.tasks.length ? (
        <div className="card mt-3">
          <div className="text-sm font-semibold mb-2">{t("Onde está o tempo poupado")}</div>
          <ol className="space-y-1.5">
            {b.tasks.filter((tk) => tk.known).slice(0, 6).map((tk) => (
              <li key={tk.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_70px] gap-3 items-center text-sm">
                <span className="truncate">{tk.label}</span><Bar value={tk.minutesSaved} max={b.tasks[0].minutesSaved} /><span className="num text-right">{fmtH(tk.minutesSaved)}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}

async function ComoLer() {
  const t = await getT();
  return (
    <section className="card text-sm space-y-2">
      <h2 className="h2">{t("Como ler estes números")}</h2>
      <p><Pill tone="verde">{t("medido")}</Pill> {t("Vem diretamente dos eventos dos softwares: tarefas feitas pela IA, leads, tempos de resposta, visitas e negócios. O tempo à mão de cada tarefa é medido automaticamente quando os utilizadores a fazem sem a IA; o valor da hora de cada conta sai da faturação média e das horas de trabalho que o utilizador indica no onboarding. Os valores do separador Pressupostos só servem de reserva enquanto estes dados não existem.")}</p>
      <p><Pill tone="amarelo">{t("estimado")}</Pill> {t("O negócio protegido compara, nos nossos próprios dados, quantas leads chegam a visita e a negócio quando a resposta é rápida e quando passa de uma hora. Essa diferença aplica-se às leads que a IA atendeu fora de horas, que sem ela só teriam resposta no dia seguinte. Só aparece com amostra suficiente nos dois grupos.")}</p>
      <p><Pill>{t("influenciado")}</Pill> {t("Negócios cuja primeira resposta foi da IA. Mostra a contribuição, não prova que o negócio não acontecia sem ela; por isso não entra no retorno.")}</p>
    </section>
  );
}

async function Tarefas({ name, b }: { name: string; b: ImpactBlock }) {
  const t = await getT();
  return (
    <section className="card overflow-x-auto mb-4">
      <h2 className="h2">{name}</h2>
      {b.tasks.length === 0 ? <p className="text-muted">{t("Sem tarefas registadas no período.")}</p> : (
        <table className="tbl">
          <thead><tr><th>{t("Tarefa")}</th><th className="text-right">{t("Feitas")}</th><th className="text-right">{t("Pela IA")}</th><th className="text-right">{t("À mão (min)")}</th><th className="text-right">{t("Fica para a pessoa (min)")}</th><th className="text-right">{t("Tempo poupado")}</th><th>{t("Base do tempo")}</th></tr></thead>
          <tbody>{b.tasks.map((row) => (
            <tr key={row.key}>
              <td>{row.label}<div className="text-xs text-muted font-mono">{row.key}</div></td>
              <td className="num text-right">{fmtNum(row.count)}</td>
              <td className="num text-right">{fmtPct((row.ai + row.assisted) / Math.max(1, row.count), 0)}</td>
              <td className="num text-right">{row.known ? fmtNum(row.manualMinutes) : "–"}</td>
              <td className="num text-right">{row.known ? fmtNum(row.remainingMinutes) : "–"}</td>
              <td className="num text-right font-semibold">{row.known ? fmtH(row.minutesSaved) : "–"}</td>
              <td>{!row.known ? <Pill tone="aviso">{t("fora do catálogo")}</Pill> : row.measured ? <Pill tone="verde">{t("medido ({n} à mão)", { n: fmtNum(row.samples) })}</Pill> : row.validated ? <Pill tone="verde">{t("validado")}</Pill> : <Pill tone="amarelo">{t("estimativa · {n} medições", { n: fmtNum(row.samples) })}</Pill>}</td>
            </tr>))}</tbody>
        </table>
      )}
      <p className="text-xs text-muted mt-3">{t("Tempo poupado = execuções feitas ou ajudadas pela IA × (minutos à mão − minutos que ficam para a pessoa). Os minutos à mão são a mediana das execuções feitas pela pessoa (com human_seconds) a partir da amostra mínima; até lá usa-se a estimativa do catálogo. Tarefas fora do catálogo não contam.")}</p>
    </section>
  );
}

async function Leads({ name, b, fastMin, minSample }: { name: string; b: ImpactBlock; fastMin: number; minSample: number }) {
  const t = await getT();
  const l = b.leads;
  const maxRate = Math.max(...l.buckets.map((x) => x.visitRate ?? 0), 0.01);
  return (
    <section className="mb-6">
      <h2 className="h2">{name}</h2>
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card overflow-x-auto">
          <div className="text-sm font-semibold mb-1">{t("Quanto mais rápida a resposta, mais visitas")}</div>
          <p className="text-xs text-muted mb-3">{t("Leads recebidas no período, pelo tempo até à primeira resposta. Medido.")}</p>
          <table className="tbl">
            <thead><tr><th>{t("Primeira resposta")}</th><th className="text-right">{t("Leads")}</th><th className="text-right">{t("Visitas")}</th><th>{t("Taxa de visita")}</th></tr></thead>
            <tbody>{l.buckets.filter((x) => x.leads > 0).map((x) => (
              <tr key={x.key}><td>{t(x.label)}</td><td className="num text-right">{fmtNum(x.leads)}</td><td className="num text-right">{fmtNum(x.visits)}</td>
                <td><div className="grid grid-cols-[1fr_48px] gap-2 items-center"><Bar value={x.visitRate ?? 0} max={maxRate} /><span className="num text-right text-sm">{fmtPct(x.visitRate, 0)}</span></div></td></tr>))}</tbody>
          </table>
        </div>
        <div className="card space-y-3 text-sm">
          <div className="font-semibold">{t("O que não se perdeu")}</div>
          <ol className="space-y-1">
            <li className="flex justify-between"><span>{t("Leads recebidas fora de horas")}</span><span className="num">{fmtNum(l.afterHours)}</span></li>
            <li className="flex justify-between"><span>{t("… atendidas pela IA em {min} min", { min: fastMin })}</span><span className="num">{fmtNum(l.afterHoursByAi)}</span></li>
            <li className="flex justify-between"><span>{t("… que chegaram a visita")}</span><span className="num">{fmtNum(l.afterHoursByAiVisits)}</span></li>
            <li className="flex justify-between"><span>{t("… que fecharam negócio")}</span><span className="num">{fmtNum(l.afterHoursByAiDeals)} · {fmtEur0(l.afterHoursByAiCommissionCents)}</span></li>
          </ol>
          <div className="border-t border-line pt-3">
            <div className="font-semibold mb-1">{t("Comparação rápida vs lenta (medida nos nossos dados)")}</div>
            <table className="tbl">
              <thead><tr><th>{t("Grupo")}</th><th className="text-right">{t("Leads")}</th><th className="text-right">{t("Visita")}</th><th className="text-right">{t("Negócio")}</th></tr></thead>
              <tbody>
                <tr><td>{t("Resposta até {min} min", { min: fastMin })}</td><td className="num text-right">{fmtNum(l.fast.n)}</td><td className="num text-right">{fmtPct(l.fast.visitRate)}</td><td className="num text-right">{fmtPct(l.fast.dealRate)}</td></tr>
                <tr><td>{t("Resposta depois de 1 h")}</td><td className="num text-right">{fmtNum(l.slow.n)}</td><td className="num text-right">{fmtPct(l.slow.visitRate)}</td><td className="num text-right">{fmtPct(l.slow.dealRate)}</td></tr>
              </tbody>
            </table>
            {l.upliftDeal != null ? (
              <p className="mt-2">{t("Responder depressa dá mais {visits} de visitas e {deals} de negócios. Aplicado às leads atendidas fora de horas pela IA: cerca de {pv} visitas e {pd} negócios ({eur}) que se teriam perdido.", { visits: fmtPct(l.upliftVisit), deals: fmtPct(l.upliftDeal), pv: (l.protectedVisits ?? 0).toLocaleString("pt-PT", { maximumFractionDigits: 1 }), pd: (l.protectedDeals ?? 0).toLocaleString("pt-PT", { maximumFractionDigits: 1 }), eur: fmtEur0(l.protectedCommissionCents) })} <Pill tone="amarelo">{t("estimado")}</Pill></p>
            ) : <p className="mt-2 text-muted">{t("Ainda não há {n} leads em cada grupo para estimar com segurança.", { n: minSample })}</p>}
          </div>
        </div>
      </div>
    </section>
  );
}

async function Contas({ accounts, swName, months }: { accounts: Awaited<ReturnType<typeof loadImpact>>["accounts"]; swName: (id: string) => string; months: number }) {
  const t = await getT();
  if (!accounts.length) return <Empty title={t("Sem contas com dados de impacto no período")} />;
  return (
    <section className="card overflow-x-auto">
      <p className="text-sm text-muted mb-3">{t("As contas com retorno alto são candidatas a caso de estudo e testemunho; as que ficam abaixo de 1× correm risco de cancelar e geram um alerta.")}</p>
      <table className="tbl">
        <thead><tr><th>{t("Conta")}</th><th>{t("Software")}</th><th className="text-right">{t("Horas/mês")}</th><th className="text-right">{t("Valor/hora")}</th><th className="text-right">{t("Valor do tempo")}</th><th className="text-right">{t("Pago")}</th><th className="text-right">{t("Retorno")}</th><th className="text-right">{t("Fora de horas pela IA")}</th><th className="text-right">{t("Visitas pela IA")}</th><th className="text-right">{t("Negócio protegido")}</th><th></th></tr></thead>
        <tbody>{accounts.map((a) => (
          <tr key={`${a.softwareId}-${a.orgId}`}>
            <td>{a.orgName}</td><td>{swName(a.softwareId)}</td>
            <td className="num text-right">{hoursPerMonth(a.minutesSaved, months).toLocaleString("pt-PT", { maximumFractionDigits: 1 })}</td>
            <td className="num text-right">{fmtEur0(a.hourValueCents)}<div className="text-xs text-muted font-sans">{a.hourValueSource === "onboarding" ? t("onboarding") : t("reserva")}</div></td>
            <td className="num text-right">{fmtEur0(a.timeValueCents)}</td>
            <td className="num text-right">{a.costCents ? fmtEur0(a.costCents) : t("trial")}</td>
            <td className={`num text-right font-semibold ${a.roiTime == null ? "" : a.roiTime >= 3 ? "text-good" : a.roiTime >= 1 ? "text-warn" : "text-bad"}`}>{fmtX(a.roiTime)}</td>
            <td className="num text-right">{fmtNum(a.afterHoursByAi)}</td>
            <td className="num text-right">{fmtNum(a.visitsByAi)}</td>
            <td className="num text-right">{a.protectedCommissionCents != null ? fmtEur0(a.protectedCommissionCents) : "–"}</td>
            <td>{a.roiTime != null && a.roiTime >= 10 ? <Pill tone="verde">{t("caso de estudo")}</Pill> : a.roiTime != null && a.roiTime < 1 ? <Pill tone="critico">{t("risco")}</Pill> : null}</td>
          </tr>))}</tbody>
      </table>
    </section>
  );
}

async function Pressupostos({ ids, swName, settings, data }: { ids: string[]; swName: (id: string) => string; settings: Awaited<ReturnType<typeof settingsFor>>; data: Awaited<ReturnType<typeof loadImpact>> }) {
  const t = await getT();
  const catalog = await catalogFor(ids);
  return (
    <div className="space-y-6">
      <section className="card text-sm text-muted">
        {t("Os pressupostos calculam-se sozinhos a partir dos dados de cada conta.")} {t("O")} <strong>{t("valor da hora")}</strong> {t("vem da faturação média e das horas de trabalho que o utilizador indica no onboarding (evento account.profile_updated).")} {t("O")} <strong>{t("tempo à mão")}</strong> {t("de cada tarefa é a mediana do tempo que os utilizadores gastam quando a fazem sem a IA (task.completed com by = human e human_seconds).")} {t("Os valores abaixo só se usam como reserva enquanto esses dados não existem. Todas as alterações ficam no registo de auditoria.")}
      </section>
      {ids.map((id) => {
        const s = settings.get(id)!;
        const rows = catalog.filter((c) => c.softwareId === id);
        const b = data.bySoftware.get(id)!;
        const refs = data.catalogRefs.get(id) ?? [];
        const measuredN = refs.filter((r) => r.measured).length;
        return (
          <section key={id} className="space-y-3">
            <h2 className="h2">{swName(id)}</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              <Kpi label={t("Valor da hora (automático)")} value={b.hourValue.medianCents != null ? `${fmtEur0(b.hourValue.medianCents)}/h` : "–"}
                note={b.hourValue.accounts ? t("mediana de {n} de {total} contas com onboarding; as restantes usam a reserva", { n: b.hourValue.fromProfile, total: b.hourValue.accounts }) : t("sem contas com dados no período")} />
              <Kpi label={t("Tempos à mão medidos automaticamente")} value={t("{n} de {total}", { n: measuredN, total: refs.length })} note={t("tarefas com pelo menos {n} execuções feitas à mão no período", { n: s.minSample })} />
            </div>
            <div className="card"><SettingsForm softwareId={id} hourValue={s.hourValueCents / 100} defaultWeeklyHours={s.defaultWeeklyHours} fastResponseMinutes={s.fastResponseMinutes} minSample={s.minSample} /></div>
            {rows.map((tk) => { const ref = refs.find((r) => r.key === tk.key); return (
              <details key={tk.id} className="card">
                <summary className="cursor-pointer flex flex-wrap gap-2 items-center">
                  <span className="font-semibold">{tk.label}</span>
                  {ref?.measured
                    ? <><span className="text-sm num">{t("{a} → {b} min", { a: fmtNum(Math.round(ref.manualMinutes * 10) / 10), b: fmtNum(Number(tk.remainingMinutes)) })}</span><Pill tone="verde">{t("medido em {n} execuções à mão", { n: fmtNum(ref.samples ?? 0) })}</Pill><span className="text-xs text-muted">{t("reserva: {n} min", { n: fmtNum(Number(tk.manualMinutes)) })}</span></>
                    : <><span className="text-sm text-muted num">{t("{a} → {b} min", { a: fmtNum(Number(tk.manualMinutes)), b: fmtNum(Number(tk.remainingMinutes)) })}</span>{tk.validated ? <Pill tone="verde">{t("validado")}</Pill> : <Pill tone="amarelo">{t("estimativa · {n} de {total} medições", { n: fmtNum(ref?.samples ?? 0), total: s.minSample })}</Pill>}</>}
                  {!tk.active ? <Pill>{t("não conta")}</Pill> : null}
                </summary>
                <div className="mt-3"><TaskForm softwareId={id} task={{ ...tk }} /></div>
              </details>
            ); })}
            <div className="card"><div className="text-sm font-semibold mb-2">{t("Nova tarefa")}</div><TaskForm softwareId={id} /></div>
          </section>
        );
      })}
    </div>
  );
}
