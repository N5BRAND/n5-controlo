import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { canSee, requireUser, scopeSoftwares } from "@/lib/auth";
import { readFilters } from "@/lib/filters";
import { delivery, roadmap, softwareCosts, softwaresFor } from "@/lib/queries";
import { fmtDate, fmtDateTime, fmtEur, fmtNum, fmtPct, LABELS } from "@/lib/format";
import { daysUntil, deadlineStatus, DUE_SOON_DAYS } from "@/lib/metrics";
import { ACTIVE_PHASES, PHASES } from "@/lib/phases";
import { Empty, Kpi, PageHeader, Pill, Tabs, withParams } from "@/components/ui";
import { createItem, publishRelease, saveProviderCost, saveRelease } from "./actions";
import { filterTasks, KanbanView, ListView } from "./TaskViews";
import { getT } from "@/lib/i18n/server";
import { History } from "./History";
import type { TaskRow } from "./taskUi";

type SP = Record<string, string | string[] | undefined>;

export default async function Pipeline({ searchParams }: { searchParams: Promise<SP> }) {
  const tr = await getT();
  const user = await requireUser("pipeline");
  const sp = await searchParams;
  const filters = readFilters(sp);
  const sws = await softwaresFor(user);
  const ids = scopeSoftwares(user, filters.software, sws);
  const wanted = typeof sp.vista === "string" && sp.vista !== "roadmap" ? sp.vista : "quadro";
  const vista = wanted;
  const showCosts = canSee(user.role, "custos");
  // Colaboradores não veem Backlog, Entregas e qualidade, Agentes de código nem Versões (por agora).
  const full = user.role !== "colaborador";
  const due = ids.length ? await db.select().from(schema.roadmapItems).where(inArray(schema.roadmapItems.softwareId, ids)) : [];
  const tabs = [
    { key: "quadro", label: tr("Quadro") }, { key: "lista", label: tr("Lista") }, ...(full ? [{ key: "backlog", label: tr("Backlog") }] : []), ...(full ? [{ key: "entregas", label: tr("Entregas e qualidade") }, { key: "agentes", label: tr("Agentes de código") }, { key: "versoes", label: tr("Versões") }] : []),
    ...(showCosts ? [{ key: "custos", label: tr("Custos") }] : []),
  ].map((t) => ({ ...t, href: withParams("/pipeline", sp, { vista: t.key }) }));
  const swName = (id: string) => sws.find((s) => s.id === id)?.name ?? id;
  const mySoftwares = sws.filter((s) => ids.includes(s.id));
  const team = await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(eq(schema.users.active, true)).orderBy(schema.users.name);

  return (
    <>
      <PageHeader title={vista === "notificacoes" ? tr("Notificações do Pipeline") : vista === "historico" ? tr("Histórico do Pipeline") : tr("Pipeline de desenvolvimento")} lead={vista === "notificacoes" ? tr("Prazos das tarefas: ultrapassados, a vencer e em curso sem data.") : vista === "historico" ? tr("Tudo o que se criou, alterou, comentou ou apagou nas tarefas, com quem fez e quando.") : tr("Tarefas do desenvolvimento por estágio, com o custo de cada software.")}>
        {(vista === "quadro" || vista === "lista") ? <Link href={withParams("/pipeline", sp, { vista: "novo" })} className="btn btn-primary">{tr("+ Nova tarefa")}</Link> : null}
      </PageHeader>
      {vista === "notificacoes" || vista === "historico" ? null : <Tabs items={tabs} active={vista} />}
      {vista === "quadro" || vista === "lista" ? <Tarefas ids={ids} vista={vista} sp={sp} userId={user.sub} team={team} swName={swName} /> : null}
      {vista === "historico" ? <History softwareIds={user.softwareIds} /> : null}
      {vista === "backlog" && full ? <Backlog ids={ids} swName={swName} /> : null}
      {vista === "entregas" && full ? <Entregas ids={ids} sp={sp} /> : null}
      {vista === "agentes" && full ? <Agentes ids={ids} sp={sp} /> : null}
      {vista === "versoes" && full ? <Versoes ids={ids} softwares={mySoftwares} swName={swName} /> : null}
      {vista === "custos" && showCosts ? <Custos ids={ids} softwares={mySoftwares} /> : null}
      {vista === "notificacoes" ? <Notificacoes items={due} swName={swName} userId={user.sub} meus={sp.meus === "1"} sp={sp} /> : null}
      {vista === "novo" ? <NovoItem softwares={mySoftwares} team={team} /> : null}
    </>
  );
}

async function Tarefas({ ids, vista, sp, userId, team, swName }: { ids: string[]; vista: string; sp: SP; userId: string; team: { id: string; name: string }[]; swName: (id: string) => string }) {
  const items = await roadmap(ids);
  const rows: TaskRow[] = items.map((i) => ({
    id: i.id, code: i.code, title: i.title, description: i.description, phase: i.phase, priority: i.priority, dueDate: i.dueDate,
    ownerUserId: i.ownerUserId, owner: i.owner, softwareId: i.softwareId, software: swName(i.softwareId), agent: i.agent, comments: i.comments, score: i.score,
  }));
  const tasks = filterTasks(rows, sp, userId);
  return (
    <>
      {vista === "lista" ? <ListView tasks={tasks} team={team} /> : <KanbanView tasks={tasks} team={team} />}
    </>
  );
}

async function Backlog({ ids, swName }: { ids: string[]; swName: (id: string) => string }) {
  const tr = await getT();
  const items = await roadmap(ids);
  const backlog = items.filter((i) => i.phase === "sprint_backlog");
  if (!backlog.length) return <Empty title={tr("Backlog vazio")}>{tr("Não há itens em Sprint Backlog.")}</Empty>;
  return (
    <section className="card overflow-x-auto">
      <table className="tbl">
        <thead><tr><th>{tr("Item")}</th><th>{tr("Software")}</th><th>{tr("Origem")}</th><th className="text-right">{tr("Impacto")}</th><th className="text-right">{tr("Alcance")}</th><th className="text-right">{tr("Confiança")}</th><th className="text-right">{tr("Esforço")}</th><th className="text-right">{tr("Pontuação")}</th><th className="text-right">{tr("Votos")}</th><th>{tr("Dono")}</th><th>{tr("Agente")}</th></tr></thead>
        <tbody>{backlog.map((i) => (
          <tr key={i.id}>
            <td><Link className="font-medium hover:underline" href={`/pipeline/${i.id}`}><span className="num text-muted">{i.code}</span> {i.title}</Link></td>
            <td>{swName(i.softwareId)}</td><td>{i.origin}</td><td className="num text-right">{i.impact}</td><td className="num text-right">{fmtNum(i.reach)}</td>
            <td className="num text-right">{i.confidence}%</td><td className="num text-right">{i.effort}</td><td className="num text-right font-semibold">{i.score}</td>
            <td className="num text-right">{i.communityVotes}</td><td>{i.owner ?? <span className="text-muted">–</span>}</td><td>{i.agent ? <Pill tone="accent">{tr("agente")}</Pill> : ""}</td>
          </tr>))}</tbody>
      </table>
    </section>
  );
}

async function Entregas({ ids, sp }: { ids: string[]; sp: SP }) {
  const tr = await getT();
  const d = await delivery(ids, readFilters(sp).range);
  const bugs = ids.length ? await db.select().from(schema.feedback).where(inArray(schema.feedback.softwareId, ids)) : [];
  const openBugs = bugs.filter((b) => b.type === "bug" && !["lancado", "recusado", "duplicado"].includes(b.status));
  if (!d) return <Empty title={tr("Sem softwares neste filtro")} />;
  return (
    <>
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Kpi label={tr("Deploys de produção por semana")} value={d.deploysPerWeek.toFixed(1)} />
        <Kpi label={tr("Tempo do PR ao merge")} value={d.leadTimeHours === null ? "–" : `${d.leadTimeHours.toFixed(1)} h`} note={tr("média dos PRs do período")} />
        <Kpi label={tr("Falhas por deploy")} value={fmtPct(d.failureRate)} tone={d.failureRate === null ? undefined : d.failureRate > 0.15 ? "bad" : "good"} />
        <Kpi label={tr("Tempo de recuperação")} value={d.recoveryHours === null ? "–" : `${d.recoveryHours.toFixed(1)} h`} />
      </section>
      <div className="grid lg:grid-cols-2 gap-4">
        <section className="card overflow-x-auto">
          <h2 className="h2">{tr("Últimos deploys")}</h2>
          {d.deployments.length === 0 ? <p className="text-muted">{tr("Ainda não chegaram deploys do GitHub.")}</p> : (
            <table className="tbl"><thead><tr><th>{tr("Repositório")}</th><th>{tr("Ambiente")}</th><th>{tr("Estado")}</th><th>{tr("Commit")}</th><th>{tr("Data")}</th></tr></thead>
              <tbody>{d.deployments.map((x) => <tr key={x.id}><td>{x.repo}</td><td>{x.environment}</td><td><Pill tone={x.status === "success" ? "verde" : x.status === "pending" ? "neutro" : "critico"}>{x.status}</Pill></td><td className="num">{x.sha?.slice(0, 7)}</td><td>{fmtDateTime(x.createdAt)}</td></tr>)}</tbody></table>
          )}
        </section>
        <section className="card overflow-x-auto">
          <h2 className="h2">{tr("Bugs abertos")} ({openBugs.length})</h2>
          {openBugs.length === 0 ? <p className="text-muted">{tr("Sem bugs abertos.")}</p> : (
            <table className="tbl"><thead><tr><th>{tr("Bug")}</th><th>{tr("Gravidade")}</th><th>{tr("Idade")}</th></tr></thead>
              <tbody>{openBugs.sort((a, b) => ["critico", "alto", "medio", "baixo"].indexOf(a.severity ?? "medio") - ["critico", "alto", "medio", "baixo"].indexOf(b.severity ?? "medio")).map((b) => (
                <tr key={b.id}><td><Link className="hover:underline" href={`/comunidades/${b.id}`}>{b.title}</Link></td>
                  <td><Pill tone={b.severity === "critico" ? "critico" : b.severity === "alto" ? "aviso" : "neutro"}>{b.severity ? tr(LABELS.severity[b.severity]) : "–"}</Pill></td>
                  <td className="num">{tr("{n} dias", { n: Math.floor((Date.now() - b.createdAt.getTime()) / 864e5) })}</td></tr>))}</tbody></table>
          )}
          <p className="text-xs text-muted mt-3">{tr("Uptime e erros em produção entram quando a ferramenta de monitorização estiver ligada (envia alertas para /api/v1/alerts).")}</p>
        </section>
      </div>
    </>
  );
}

async function Agentes({ ids, sp }: { ids: string[]; sp: SP }) {
  const tr = await getT();
  const d = await delivery(ids, readFilters(sp).range);
  if (!d) return <Empty title={tr("Sem softwares neste filtro")} />;
  return (
    <>
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Kpi label={tr("PRs no período")} value={fmtNum(d.prs.total)} />
        <Kpi label={tr("Feitos por agentes")} value={fmtNum(d.prs.agent)} note={d.prs.total ? fmtPct(d.prs.agent / d.prs.total) : undefined} />
        <Kpi label={tr("PRs de agentes aceites")} value={fmtNum(d.prs.agentMerged)} note={d.prs.agent ? fmtPct(d.prs.agentMerged / d.prs.agent) : undefined} />
        <Kpi label={tr("Tempo até à primeira revisão")} value={d.prs.reviewHours === null ? "–" : `${d.prs.reviewHours.toFixed(1)} h`} />
      </section>
      <section className="card">
        <h2 className="h2">{tr("PRs de agentes à espera de revisão")}</h2>
        {d.prs.openAgent.length === 0 ? <p className="text-muted">{tr("Nenhum.")}</p> : (
          <ul className="space-y-1">{d.prs.openAgent.map((p) => <li key={p.id}><a className="underline" href={p.url ?? "#"} target="_blank" rel="noreferrer">{p.repo}#{p.number}</a> {p.title} <span className="text-muted text-xs">{tr("aberto {date}", { date: fmtDate(p.createdAt) })}</span></li>)}</ul>
        )}
        <p className="text-xs text-muted mt-3">{tr("Um PR conta como de agente quando o autor é um bot do GitHub ou tem a etiqueta \"agente\".")}</p>
      </section>
    </>
  );
}

async function Versoes({ ids, softwares, swName }: { ids: string[]; softwares: { id: string; name: string }[]; swName: (id: string) => string }) {
  const tr = await getT();
  const rels = ids.length ? await db.select().from(schema.releases).where(inArray(schema.releases.softwareId, ids)).orderBy(desc(schema.releases.createdAt)) : [];
  return (
    <div className="grid lg:grid-cols-[1fr_340px] gap-4">
      <section className="space-y-3">
        {rels.length === 0 ? <Empty title={tr("Sem versões")} /> : rels.map((r) => (
          <article key={r.id} className="card">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="font-semibold">{swName(r.softwareId)} {r.version}</span>
              <Pill tone={r.publishedAt ? "verde" : "neutro"}>{r.publishedAt ? tr("Publicada {date}", { date: fmtDate(r.publishedAt) }) : tr("Por publicar")}</Pill>
              {!r.publishedAt ? <form action={publishRelease}><input type="hidden" name="id" value={r.id} /><button className="btn btn-primary">{tr("Publicar e enviar para o Slack")}</button></form> : null}
            </div>
            <pre className="whitespace-pre-wrap font-sans text-sm">{r.notes || tr("Sem notas.")}</pre>
          </article>
        ))}
      </section>
      <form action={saveRelease} className="card space-y-3 h-fit">
        <h2 className="h2">{tr("Preparar versão")}</h2>
        <div><label className="label" htmlFor="r-sw">{tr("Software")}</label><select id="r-sw" name="softwareId" className="input">{softwares.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div><label className="label" htmlFor="r-v">{tr("Versão")}</label><input id="r-v" name="version" className="input" placeholder="1.4.0" required /></div>
        <div><label className="label" htmlFor="r-n">{tr("Changelog")}</label><textarea id="r-n" name="notes" rows={6} className="input" placeholder={tr("Vazio: junta os títulos dos itens marcados com esta versão")} /></div>
        <p className="text-xs text-muted">{tr("Publicar passa os itens desta versão a Produção, marca o feedback ligado como Lançado e avisa os autores.")}</p>
        <button className="btn">{tr("Guardar versão")}</button>
      </form>
    </div>
  );
}

async function Custos({ ids, softwares }: { ids: string[]; softwares: { id: string; name: string }[] }) {
  const tr = await getT();
  const c = await softwareCosts(ids);
  const totals = c.months.map((_, i) => c.byProvider.reduce((a, p) => a + p.months[i], 0));
  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-4">
      <section className="card overflow-x-auto">
        <h2 className="h2">{tr("Custo por fornecedor")}</h2>
        {c.byProvider.length === 0 ? <p className="text-muted">{tr("Ainda sem custos. Importa a fatura de cada fornecedor ao lado, ou liga o AWS Cost Explorer.")}</p> : (
          <table className="tbl">
            <thead><tr><th>{tr("Fornecedor")}</th>{c.months.map((m) => <th key={m} className="text-right">{m}</th>)}<th className="text-right">{tr("Registo de consumo (mês atual)")}</th></tr></thead>
            <tbody>
              {c.byProvider.map((p) => <tr key={p.provider}><td>{p.provider}</td>{p.months.map((v, i) => <td key={i} className="num text-right">{fmtEur(v)}</td>)}<td className="num text-right">{fmtEur(p.registoMes)}</td></tr>)}
              <tr className="font-semibold"><td>{tr("Total")}</td>{totals.map((v, i) => <td key={i} className="num text-right">{fmtEur(v)}</td>)}<td /></tr>
              <tr><td>{tr("Custo por conta")}</td>{totals.map((v, i) => <td key={i} className="num text-right">{c.accounts ? fmtEur(Math.round(v / c.accounts)) : "–"}</td>)}<td className="text-xs text-muted">{tr("{n} contas pagantes", { n: c.accounts })}</td></tr>
            </tbody>
          </table>
        )}
      </section>
      <form action={saveProviderCost} className="card space-y-3 h-fit">
        <h2 className="h2">{tr("Registar custo do mês")}</h2>
        <div><label className="label" htmlFor="c-sw">{tr("Software")}</label><select id="c-sw" name="softwareId" className="input">{softwares.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div><label className="label" htmlFor="c-m">{tr("Mês (AAAA-MM)")}</label><input id="c-m" name="month" className="input" defaultValue={new Date().toISOString().slice(0, 7)} required /></div>
        <div><label className="label" htmlFor="c-p">{tr("Fornecedor")}</label><input id="c-p" name="provider" className="input" placeholder="aws, twilio, deepgram…" required /></div>
        <div><label className="label" htmlFor="c-v">{tr("Valor em euros")}</label><input id="c-v" name="cost" className="input" inputMode="decimal" required /></div>
        <button className="btn">{tr("Guardar")}</button>
      </form>
    </div>
  );
}

async function NovoItem({ softwares, team }: { softwares: { id: string; name: string }[]; team: { id: string; name: string }[] }) {
  const tr = await getT();
  return (
    <form action={createItem} className="card space-y-3 max-w-2xl">
      <div className="grid sm:grid-cols-2 gap-3">
        <div><label className="label" htmlFor="i-sw">{tr("Software")}</label><select id="i-sw" name="softwareId" className="input">{softwares.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div><label className="label" htmlFor="i-origin">{tr("Origem")}</label><select id="i-origin" name="origin" className="input"><option value="equipa">{tr("Equipa")}</option><option value="comunidade">{tr("Comunidade")}</option><option value="cliente">{tr("Cliente")}</option><option value="incidente">{tr("Incidente")}</option></select></div>
      </div>
      <div><label className="label" htmlFor="i-title">{tr("Título")}</label><input id="i-title" name="title" className="input" required /></div>
      <div><label className="label" htmlFor="i-desc">{tr("Descrição")}</label><textarea id="i-desc" name="description" rows={4} className="input" /></div>
      <div className="grid sm:grid-cols-3 gap-3">
        <div><label className="label" htmlFor="i-owner">{tr("Responsável")}</label><select id="i-owner" name="owner" className="input"><option value="">{tr("Sem responsável")}</option>{team.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
        <div><label className="label" htmlFor="i-prio">{tr("Prioridade")}</label><select id="i-prio" name="priority" defaultValue="normal" className="input">{Object.entries(LABELS.priority).map(([k, v]) => <option key={k} value={k}>{tr(v)}</option>)}</select></div>
        <div><label className="label" htmlFor="i-due">{tr("Data de vencimento")}</label><input id="i-due" name="dueDate" type="date" className="input" /></div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div><label className="label" htmlFor="i-imp">{tr("Impacto (1–3)")}</label><input id="i-imp" name="impact" type="number" min={1} max={3} defaultValue={2} className="input" /></div>
        <div><label className="label" htmlFor="i-reach">{tr("Alcance (contas)")}</label><input id="i-reach" name="reach" type="number" min={0} defaultValue={10} className="input" /></div>
        <div><label className="label" htmlFor="i-conf">{tr("Confiança (%)")}</label><input id="i-conf" name="confidence" type="number" min={0} max={100} defaultValue={50} className="input" /></div>
        <div><label className="label" htmlFor="i-eff">{tr("Esforço (pontos)")}</label><input id="i-eff" name="effort" type="number" min={1} defaultValue={3} className="input" /></div>
      </div>
      <button className="btn btn-primary">{tr("Criar item")}</button>
    </form>
  );
}


async function Notificacoes({ items, swName, userId, meus, sp }: { items: (typeof schema.roadmapItems.$inferSelect)[]; swName: (id: string) => string; userId: string; meus: boolean; sp: SP }) {
  const tr = await getT();
  const team = await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users);
  const owner = (id: string | null) => (id ? team.find((t) => t.id === id)?.name ?? "?" : null);
  const mine = meus ? items.filter((i) => i.ownerUserId === userId) : items;
  const withStatus = mine.map((i) => ({ i, st: deadlineStatus(i.dueDate, i.phase) }));
  const groups: { key: string; title: string; tone: string; note: string; rows: typeof withStatus }[] = [
    { key: "atrasado", title: tr("Prazo ultrapassado"), tone: "critico", note: tr("Já deviam estar concluídos."), rows: withStatus.filter((x) => x.st === "atrasado").sort((a, b) => a.i.dueDate!.localeCompare(b.i.dueDate!)) },
    { key: "hoje", title: tr("Prazo hoje"), tone: "aviso", note: tr("Têm de ficar concluídos hoje."), rows: withStatus.filter((x) => x.st === "hoje") },
    { key: "a_chegar", title: tr("A chegar ao prazo ({n} dias)", { n: DUE_SOON_DAYS }), tone: "amarelo", note: tr("Ainda dá para acabar, mas está perto."), rows: withStatus.filter((x) => x.st === "a_chegar").sort((a, b) => a.i.dueDate!.localeCompare(b.i.dueDate!)) },
    { key: "sem_prazo", title: tr("Em curso sem prazo"), tone: "neutro", note: tr("Itens em curso (de In progress a Testing) sem data: definir prazo para serem acompanhados."), rows: withStatus.filter((x) => x.st === "sem_prazo" && ACTIVE_PHASES.includes(x.i.phase)) },
  ];
  const total = groups.slice(0, 3).reduce((a, g) => a + g.rows.length, 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted max-w-3xl">{tr("Avisos de prazos do roadmap. Os atrasados e os que vencem hoje também aparecem em Alertas e no Slack interno; os que chegam ao prazo nos próximos {n} dias aparecem como informação.", { n: DUE_SOON_DAYS })}</p>
        <div className="flex gap-2 text-sm">
          <Link href={withParams("/pipeline", sp, { vista: "notificacoes" })} className={`tab ${!meus ? "tab-active" : ""}`}>{tr("Todos")}</Link>
          <Link href={withParams("/pipeline", sp, { vista: "notificacoes", meus: "1" })} className={`tab ${meus ? "tab-active" : ""}`}>{tr("Os meus")}</Link>
        </div>
      </div>
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {groups.map((g) => <Kpi key={g.key} label={g.title} value={fmtNum(g.rows.length)} tone={g.key === "atrasado" && g.rows.length ? "bad" : g.key !== "sem_prazo" && g.rows.length ? "warn" : undefined} />)}
      </section>
      {total === 0 && !groups[3].rows.length ? <Empty title={tr("Sem prazos em risco")}>{meus ? tr("Nenhum item atrasado ou a chegar ao prazo entre os teus.") : tr("Nenhum item atrasado ou a chegar ao prazo.")}</Empty> : null}
      {groups.filter((g) => g.rows.length).map((g) => (
        <section key={g.key} className="card overflow-x-auto">
          <h2 className="h2 flex items-center gap-2"><Pill tone={g.tone}>{g.title}</Pill><span className="text-sm text-muted font-normal">{g.note}</span></h2>
          <table className="tbl">
            <thead><tr><th>{tr("Item")}</th><th>{tr("Software")}</th><th>{tr("Fase")}</th><th>{tr("Dono")}</th><th>{tr("Prazo")}</th><th className="text-right">{tr("Dias")}</th></tr></thead>
            <tbody>{g.rows.map(({ i }) => {
              const d = i.dueDate ? daysUntil(i.dueDate) : null;
              const left = PHASES.indexOf("done") - PHASES.indexOf(i.phase);
              return (
                <tr key={i.id}>
                  <td><Link href={`/pipeline/${i.id}`} className="underline font-mono text-xs mr-2">{i.code}</Link>{i.title}</td>
                  <td>{swName(i.softwareId)}</td>
                  <td>{LABELS.phase[i.phase]}<div className="text-xs text-muted">{left > 0 ? tr("{n} fases até Done", { n: left }) : null}</div></td>
                  <td>{owner(i.ownerUserId) ?? <Pill tone="aviso">{tr("sem dono")}</Pill>}</td>
                  <td>{i.dueDate ? fmtDate(i.dueDate) : "–"}</td>
                  <td className={`num text-right ${d != null && d < 0 ? "text-bad font-semibold" : ""}`}>{d == null ? "–" : d < 0 ? tr("{n} em atraso", { n: -d }) : d === 0 ? tr("hoje") : tr("faltam {n}", { n: d })}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
