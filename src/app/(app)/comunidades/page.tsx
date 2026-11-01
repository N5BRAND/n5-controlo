import Link from "next/link";
import { desc, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser, scopeSoftwares } from "@/lib/auth";
import { KEEP_PARAMS, readFilters } from "@/lib/filters";
import { communityStats, listFeedback, softwaresFor } from "@/lib/queries";
import { fmtDate, fmtDateTime, fmtNum, fmtPct, LABELS } from "@/lib/format";
import { Empty, Kpi, PageHeader, Pill, Tabs, withParams } from "@/components/ui";
import { addBetaMember, newFeedback } from "./actions";

type SP = Record<string, string | string[] | undefined>;

export default async function Comunidades({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("comunidades");
  const sp = await searchParams;
  const filters = readFilters(sp);
  const sws = await softwaresFor(user);
  const ids = scopeSoftwares(user, filters.software, sws);
  const vista = typeof sp.vista === "string" ? sp.vista : "caixa";
  const stats = await communityStats(ids, filters.range);
  const swName = (id: string) => sws.find((s) => s.id === id)?.name ?? id;

  const tabs = [
    { key: "caixa", label: "Caixa de feedback", href: withParams("/comunidades", sp, { vista: "caixa" }) },
    { key: "membros", label: "Membros", href: withParams("/comunidades", sp, { vista: "membros" }) },
    { key: "changelog", label: "Changelog", href: withParams("/comunidades", sp, { vista: "changelog" }) },
    { key: "novo", label: "Registar feedback", href: withParams("/comunidades", sp, { vista: "novo" }) },
  ];

  return (
    <>
      <PageHeader title="Comunidades" lead="O que a comunidade diz no Slack N5, com estado, dono e ligação ao roadmap." />
      {stats ? (
        <section className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
          <Kpi label="Membros" value={fmtNum((stats.members.pagante ?? 0) + (stats.members.beta ?? 0) + (stats.members.trial ?? 0))}
            note={`${fmtNum(stats.members.pagante ?? 0)} pagantes · ${fmtNum(stats.members.beta ?? 0)} beta · ${fmtNum(stats.members.trial ?? 0)} trial`} />
          <Kpi label="Feedback no período" value={fmtNum(stats.feedbackCount)}
            note={`${stats.byType.sugestao} sugestões · ${stats.byType.bug} bugs · ${stats.byType.funciona_mal} mal · ${stats.byType.funciona_bem} bem`} />
          <Kpi label="Primeira resposta (média)" value={stats.avgResponseH === null ? "–" : `${stats.avgResponseH.toFixed(1)} h`} />
          <Kpi label="Taxa de fecho" value={fmtPct(stats.closeRate)} note="lançado, recusado ou duplicado" />
          <Kpi label="Sentimento" value={stats.sentiment === null ? "–" : stats.sentiment.toFixed(2)} note="de −1 (só negativo) a +1"
            tone={stats.sentiment === null ? undefined : stats.sentiment >= 0 ? "good" : "bad"} />
        </section>
      ) : null}
      <Tabs items={tabs} active={vista} />
      {vista === "caixa" ? <Caixa ids={ids} sp={sp} swName={swName} /> : null}
      {vista === "membros" ? <Membros ids={ids} swName={swName} softwares={sws.filter((s) => ids.includes(s.id))} /> : null}
      {vista === "changelog" ? <Changelog ids={ids} swName={swName} /> : null}
      {vista === "novo" ? <Novo softwares={sws.filter((s) => ids.includes(s.id))} /> : null}
    </>
  );
}

async function Caixa({ ids, sp, swName }: { ids: string[]; sp: SP; swName: (id: string) => string }) {
  const status = typeof sp.estado === "string" ? sp.estado : "abertos";
  const type = typeof sp.tipo === "string" ? sp.tipo : "";
  const q = typeof sp.q === "string" ? sp.q : "";
  const rows = await listFeedback(ids, { status: status === "todos" ? undefined : status, type: type || undefined, q: q || undefined });
  return (
    <section className="card">
      <form className="flex flex-wrap gap-2 mb-3" method="get">
        {typeof sp.sw === "string" ? <input type="hidden" name="sw" value={sp.sw} /> : null}
        {KEEP_PARAMS.filter((k) => k !== "sw").map((k) => (typeof sp[k] === "string" ? <input key={k} type="hidden" name={k} value={sp[k] as string} /> : null))}
        <select name="estado" defaultValue={status} className="input w-auto" aria-label="Estado">
          <option value="abertos">Abertos</option><option value="todos">Todos</option>
          {Object.entries(LABELS.feedbackStatus).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select name="tipo" defaultValue={type} className="input w-auto" aria-label="Tipo">
          <option value="">Todos os tipos</option>
          {Object.entries(LABELS.feedbackType).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input name="q" defaultValue={q} placeholder="Procurar no título ou no texto" className="input w-64" />
        <button className="btn">Filtrar</button>
      </form>
      {rows.length === 0 ? <Empty title="Sem feedback com estes filtros" /> : (
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Tipo</th><th>Título</th><th>Software</th><th>Autor</th><th>Funcionalidade</th><th className="text-right">Votos</th><th>Estado</th><th>Dono</th><th>Criado</th></tr></thead>
            <tbody>
              {rows.map(({ f, owner }) => (
                <tr key={f.id}>
                  <td><Pill tone={f.type === "bug" ? (f.severity === "critico" ? "critico" : "aviso") : f.type === "funciona_bem" ? "verde" : f.type === "funciona_mal" ? "amarelo" : "accent"}>
                    {LABELS.feedbackType[f.type]}{f.severity ? ` · ${LABELS.severity[f.severity]}` : ""}</Pill></td>
                  <td className="max-w-md"><Link className="font-medium hover:underline" href={`/comunidades/${f.id}`}>{f.title}</Link></td>
                  <td>{swName(f.softwareId)}</td>
                  <td>{f.authorName ?? "–"}{f.origin ? <div className="text-xs text-muted">{LABELS.origin[f.origin]}</div> : null}</td>
                  <td>{f.feature ?? <span className="text-muted">–</span>}</td>
                  <td className="num text-right">{f.votes}</td>
                  <td>{LABELS.feedbackStatus[f.status]}</td>
                  <td>{owner ?? <span className="text-muted">sem dono</span>}</td>
                  <td className="whitespace-nowrap">{fmtDate(f.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

async function Membros({ ids, swName, softwares }: { ids: string[]; swName: (id: string) => string; softwares: { id: string; name: string }[] }) {
  const people = ids.length ? await db.select().from(schema.persons).where(inArray(schema.persons.softwareId, ids)).orderBy(desc(schema.persons.createdAt)).limit(300) : [];
  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-4">
      <section className="card overflow-x-auto">
        {people.length === 0 ? <Empty title="Sem membros ainda" /> : (
          <table className="tbl">
            <thead><tr><th>Nome</th><th>E-mail</th><th>Software</th><th>Origem</th><th>Entrou</th><th>Ativou</th></tr></thead>
            <tbody>{people.map((p) => (
              <tr key={p.id}><td>{p.name ?? "–"}</td><td>{p.email ?? "–"}</td><td>{p.softwareId ? swName(p.softwareId) : "–"}</td>
                <td>{LABELS.origin[p.origin]}</td><td>{fmtDate(p.signedUpAt)}</td><td>{fmtDate(p.activatedAt)}</td></tr>
            ))}</tbody>
          </table>
        )}
      </section>
      <form action={addBetaMember} className="card space-y-3 h-fit">
        <h2 className="h2">Adicionar utilizador beta</h2>
        <div><label className="label" htmlFor="b-sw">Software</label>
          <select id="b-sw" name="softwareId" className="input" required>{softwares.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div><label className="label" htmlFor="b-name">Nome</label><input id="b-name" name="name" className="input" required /></div>
        <div><label className="label" htmlFor="b-email">E-mail</label><input id="b-email" name="email" type="email" className="input" /></div>
        <div><label className="label" htmlFor="b-slack">ID de utilizador no Slack</label><input id="b-slack" name="slackUserId" className="input" placeholder="U0123ABC" /></div>
        <button className="btn btn-primary">Adicionar</button>
      </form>
    </div>
  );
}

async function Changelog({ ids, swName }: { ids: string[]; swName: (id: string) => string }) {
  const rels = ids.length ? await db.select().from(schema.releases).where(inArray(schema.releases.softwareId, ids)).orderBy(desc(schema.releases.createdAt)).limit(50) : [];
  if (!rels.length) return <Empty title="Ainda não há versões">As versões publicadas no Pipeline aparecem aqui, com o estado do envio para o Slack.</Empty>;
  return (
    <section className="space-y-3">
      {rels.map((r) => (
        <article key={r.id} className="card">
          <div className="flex flex-wrap gap-2 items-center mb-2"><span className="font-semibold">{swName(r.softwareId)} {r.version}</span>
            <Pill tone={r.publishedAt ? "verde" : "neutro"}>{r.publishedAt ? `Publicada ${fmtDate(r.publishedAt)}` : "Por publicar"}</Pill>
            <Pill tone={r.slackPostedAt ? "accent" : "neutro"}>{r.slackPostedAt ? `No Slack ${fmtDateTime(r.slackPostedAt)}` : "Ainda não enviada para o Slack"}</Pill></div>
          <pre className="whitespace-pre-wrap font-sans text-sm">{r.notes || "Sem notas."}</pre>
        </article>
      ))}
    </section>
  );
}

function Novo({ softwares }: { softwares: { id: string; name: string }[] }) {
  return (
    <form action={newFeedback} className="card space-y-3 max-w-2xl">
      <p className="text-muted text-sm">Para feedback recebido fora do Slack (chamada, e-mail, reunião).</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <div><label className="label" htmlFor="n-sw">Software</label><select id="n-sw" name="softwareId" className="input" required>{softwares.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div><label className="label" htmlFor="n-type">Tipo</label><select id="n-type" name="type" className="input">{Object.entries(LABELS.feedbackType).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div><label className="label" htmlFor="n-sev">Gravidade (só bugs)</label><select id="n-sev" name="severity" className="input"><option value="">–</option>{Object.entries(LABELS.severity).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div><label className="label" htmlFor="n-origin">Origem do autor</label><select id="n-origin" name="origin" className="input"><option value="">–</option>{Object.entries(LABELS.origin).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div><label className="label" htmlFor="n-author">Autor</label><input id="n-author" name="authorName" className="input" /></div>
        <div><label className="label" htmlFor="n-feature">Funcionalidade</label><input id="n-feature" name="feature" className="input" /></div>
      </div>
      <div><label className="label" htmlFor="n-title">Título</label><input id="n-title" name="title" className="input" placeholder="Fica a primeira frase do texto se deixares vazio" /></div>
      <div><label className="label" htmlFor="n-text">Texto</label><textarea id="n-text" name="text" rows={5} className="input" required /></div>
      <button className="btn btn-primary">Registar feedback</button>
    </form>
  );
}
