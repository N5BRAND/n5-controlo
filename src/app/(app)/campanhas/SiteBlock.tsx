import { FORM_FIELDS, funnelRows, sectionName, sectionOrder, siteConclusions, stepFunnel, type ConclusionState } from "@/lib/metrics";
import type { SiteData } from "@/lib/posthog";
import { fmtNum, fmtPct } from "@/lib/format";
import { Bar } from "@/components/ui";
import { DailyBars } from "@/components/DailyBars";

// O que acontece dentro do site (PostHog), numa página: a principal ou uma landing page, escolhida no seletor (?pagina=).
// Conclusões, funil, secções, tempo, passos da inscrição, visitas por dia, campos com erros e origem das visitas.

const n0 = (v: unknown) => Number(v) || 0;
const secs = (v: unknown) => { const s = Math.round(n0(v)); return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ""}`; };
const DOT: Record<ConclusionState, string> = { ok: "bg-good", aviso: "bg-warn", mau: "bg-bad", espera: "bg-muted" };

export function SiteBlock({ host, page, pageOptions, keep, site, metaClicksByDay }: {
  host: string; page: string; pageOptions: string[]; keep: Record<string, string>; site: SiteData; metaClicksByDay: { date: string; clicks: number }[];
}) {
  const home = page === "/";
  const funnel = site.mainFunnel.map((r) => ({
    fonte: String(r.fonte), aberturas: n0(r.aberturas), qualificadas: n0(r.qualificadas), iniciadas: n0(r.iniciadas), enviadas: n0(r.enviadas),
    pagamentos: n0(r.pagamentos), pagas: n0(r.pagas), taxa_6s: r.taxa_6s as number | null, taxa_inicio: r.taxa_inicio as number | null,
  }));
  const all = funnel.find((r) => r.fonte === "Todas");
  const sections = site.sections.map((r) => ({ seccao: String(r.seccao), vistas: n0(r.vistas), posicao: n0(r.posicao), alcance: n0(r.alcance) }));
  const times = site.sectionTimes.map((r) => ({ seccao: String(r.seccao), visitas: n0(r.visitas), tempo_medio: n0(r.tempo_medio), saidas: n0(r.saidas), parte_saidas: r.parte_saidas as number | null }));
  const visitRow = site.visitTime[0];
  const visit = visitRow ? { visitas: n0(visitRow.visitas), tempo_medio: n0(visitRow.tempo_medio), tempo_mediano: n0(visitRow.tempo_mediano), saidas_sem_seccao: n0(visitRow.saidas_sem_seccao), mais_saidas: visitRow.mais_saidas ? String(visitRow.mais_saidas) : null } : null;
  const steps = stepFunnel(site.steps.map((r) => ({ passo: String(r.passo), chegaram: n0(r.chegaram) })));
  const errors = site.fieldErrors.map((r) => ({ campo: String(r.campo), vezes: n0(r.vezes) }));
  const days = site.mainDays.map((r) => ({ dia: String(r.dia), aberturas: n0(r.aberturas), aberturas_meta: n0(r.aberturas_meta_site) }));
  const conclusions = siteConclusions({ metaClicksByDay, funnel, days, sections, errors, times, visit, steps });

  const pageFunnel = all ? funnelRows([
    { label: "Visitas medidas", n: all.aberturas }, { label: "Ficaram 6 segundos", n: all.qualificadas }, { label: "Começaram a inscrição", n: all.iniciadas },
    { label: "Enviaram a inscrição", n: all.enviadas }, { label: "Foram ao pagamento", n: all.pagamentos }, { label: "Pagaram a pré-reserva", n: all.pagas },
  ]) : [];
  // Quem chegou a uma secção mais abaixo também passou pelas de cima
  const reach = sectionOrder(sections).map(([id, name]) => { const s = sections.find((x) => x.seccao === id); return { id, name, a: s?.alcance ?? 0, v: s?.vistas ?? 0 }; });
  for (let i = reach.length - 2; i >= 0; i--) { reach[i].a = Math.max(reach[i].a, reach[i + 1].a); reach[i].v = Math.max(reach[i].v, reach[i + 1].v); }
  let worstSection = -1, worstLoss = 0;
  reach.forEach((s, i) => { if (i && reach[i - 1].a > 0) { const l = (reach[i - 1].a - s.a) / reach[i - 1].a; if (l > worstLoss) { worstLoss = l; worstSection = i - 1; } } });
  const maxExit = Math.max(0, ...times.map((t) => t.saidas));
  const maxStepLeft = Math.max(0, ...steps.filter((s) => s.form).map((s) => s.shareLeft ?? 0));
  const maxErr = Math.max(1, ...errors.map((e) => e.vezes));

  return (
    <section id="site" className="space-y-4 pt-4 border-t border-line scroll-mt-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl">{home ? "Na página principal" : <>Na página <span className="num">{page}</span></>}: {host}</h2>
          <p className="text-xs text-muted max-w-4xl mt-1">O que as pessoas fazem nesta página, medido pelo PostHog. Troca de página no seletor ou em «Por landing page»: todos os números abaixo passam a ser dessa página, e quem paga conta na página onde abriu o pagamento. Conta quem respondeu ao aviso de cookies e deixa os robôs de fora. Uma visita qualificada é quem fica pelo menos 6 segundos com a página à vista.</p>
        </div>
        <form method="get" action="/campanhas#site" className="flex items-end gap-2">
          {Object.entries(keep).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <div><label className="label" htmlFor="pagina">Página</label>
            <select id="pagina" name="pagina" defaultValue={page} className="input min-w-[12rem]">
              {pageOptions.map((p) => <option key={p} value={p}>{p === "/" ? "/ (página principal)" : p}</option>)}
            </select></div>
          <button className="btn">Ver</button>
        </form>
      </div>

      <section className="card">
        <h2 className="h2">O que os números dizem</h2>
        <p className="text-xs text-muted mb-3">Conclusões tiradas dos números da Meta e da página, cada uma com o que mudar na comunicação. Mudam sozinhas com os números.</p>
        <ul className="space-y-3">{conclusions.map((c) => (
          <li key={c.topic} className="grid grid-cols-[auto_1fr] gap-x-3 items-baseline">
            <span className={`inline-block w-2 h-2 rounded-full ${DOT[c.state]}`} />
            <p className="max-w-3xl"><b>{c.topic}.</b> {c.text}</p>
            <p className="col-start-2 text-xs text-muted">O que fazer: {c.action}</p>
          </li>))}</ul>
      </section>

      {all ? <p className="text-lg max-w-3xl">Das <b className="num">{fmtNum(all.aberturas)}</b> visitas medidas, <b className="num">{fmtPct(all.taxa_6s, 2)}</b> ficaram pelo menos 6 segundos e <b className="num">{fmtNum(all.enviadas)}</b> enviaram a inscrição.</p> : null}

      <div className="grid lg:grid-cols-2 gap-4">
        <section className="card">
          <h2 className="h2">Da visita à pré-reserva</h2>
          <p className="text-xs text-muted mb-3">Ao lado de cada passo, a parte que passou do passo anterior; a maior perda está a vermelho.</p>
          {!pageFunnel.length || !pageFunnel[0].n ? <p className="text-muted text-sm">Ainda sem visitas medidas na página.</p> : (
            <ol className="space-y-2">{pageFunnel.map((s) => (
              <li key={s.label} className="grid grid-cols-[150px_1fr_130px] gap-3 items-center text-sm">
                <span>{s.label}</span><Bar value={s.n} max={pageFunnel[0].n || 1} tone={s.worst ? "bad" : "accent"} />
                <span className="num text-right">{fmtNum(s.n)}{s.fromPrevious !== null ? <span className="text-muted text-xs block">{fmtPct(s.fromPrevious, 2)} do anterior</span> : null}</span>
              </li>))}</ol>
          )}
        </section>
        <section className="card">
          <h2 className="h2">Até onde descem na página</h2>
          <p className="text-xs text-muted mb-3">Parte das visitas que chegou pelo menos até cada secção, pela ordem da página. A vermelho, a secção onde mais gente deixa de descer.</p>
          {!sections.length ? <p className="text-muted text-sm">Ainda sem visitas medidas na página.</p> : (
            <ol className="space-y-2">{reach.map((s, i) => (
              <li key={s.id} className="grid grid-cols-[150px_1fr_110px] gap-3 items-center text-sm">
                <span>{s.name}</span><Bar value={s.a} max={1} tone={i === worstSection ? "bad" : "accent"} />
                <span className="num text-right">{fmtPct(s.a, 2)}<span className="text-muted text-xs block">{fmtNum(s.v)} visitas</span></span>
              </li>))}</ol>
          )}
        </section>
      </div>

      {visit ? (
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="card"><p className="label">Tempo médio por visita</p><p className="font-display text-3xl num">{secs(visit.tempo_medio)}</p><p className="text-xs text-muted">com a página à vista · mediana {secs(visit.tempo_mediano)}</p></div>
          <div className="card"><p className="label">Onde mais saem</p><p className="font-display text-3xl">{visit.mais_saidas ? sectionName(visit.mais_saidas) : "–"}</p><p className="text-xs text-muted">em {fmtNum(visit.visitas)} visitas medidas</p></div>
          <div className="card"><p className="label">Saem antes de ver uma secção</p><p className="font-display text-3xl num">{fmtNum(visit.saidas_sem_seccao)}</p><p className="text-xs text-muted">visitas que saíram nos primeiros instantes</p></div>
        </section>
      ) : null}

      <section className="card overflow-x-auto">
        <h2 className="h2">Tempo e saídas por secção</h2>
        <p className="text-xs text-muted mb-3">Pela ordem da página: o tempo médio com a secção à vista, de quem lá esteve, e a parte das visitas que saiu da página nessa secção. A vermelho, onde mais gente sai.</p>
        {!times.length ? <p className="text-muted text-sm">Ainda sem visitas cronometradas nesta página.{home ? "" : " As landing pages só são cronometradas desde que o site passou a medir o tempo em todas as páginas."}</p> : (
          <table className="tbl"><thead><tr><th>Secção</th><th className="text-right">Tempo médio</th><th className="text-right">Visitas</th><th className="text-right">Saem aqui</th><th className="text-right">Das visitas</th></tr></thead>
            <tbody>{sectionOrder(times.map((t) => ({ seccao: t.seccao }))).map(([id, name]) => { const t = times.find((x) => x.seccao === id); if (!t) return null; return (
              <tr key={id} className={maxExit > 0 && t.saidas === maxExit ? "text-bad font-semibold" : ""}><td>{name}</td><td className="num text-right">{secs(t.tempo_medio)}</td><td className="num text-right">{fmtNum(t.visitas)}</td><td className="num text-right">{fmtNum(t.saidas)}</td><td className="num text-right">{fmtPct(t.parte_saidas, 2)}</td></tr>); })}</tbody></table>
        )}
      </section>

      <section className="card overflow-x-auto">
        <h2 className="h2">Onde desistem na inscrição</h2>
        <p className="text-xs text-muted mb-3">A inscrição tem um ecrã com os dados e outro com o resumo da pré-reserva. Por passo, a começar no formulário: quantas visitas lá chegaram, a parte das que começaram, quantas saíram ali e a parte das que lá chegaram que saiu. Só nesta página; antes de 31/10 o formulário perguntava uma coisa de cada vez e conta a partir do nome.</p>
        {!steps[0]?.reached ? <p className="text-muted text-sm">Ainda ninguém começou a inscrição nesta página.</p> : (
          <table className="tbl"><thead><tr><th>Passo</th><th className="text-right">Chegaram</th><th className="text-right">Das que começaram</th><th className="text-right">Saíram aqui</th><th className="text-right">Saíram (%)</th></tr></thead>
            <tbody>{steps.map((s) => (
              <tr key={s.step} className={s.form && maxStepLeft > 0 && s.shareLeft === maxStepLeft ? "text-bad font-semibold" : ""}><td>{s.name}</td><td className="num text-right">{fmtNum(s.reached)}</td><td className="num text-right">{fmtPct(s.shareOfStart, 2)}</td><td className="num text-right">{fmtNum(s.left)}</td><td className="num text-right">{fmtPct(s.shareLeft, 2)}</td></tr>))}</tbody></table>
        )}
      </section>

      <div className="grid lg:grid-cols-2 gap-4">
        <section className="card">
          <h2 className="h2">Visitas medidas por dia</h2>
          <p className="text-xs text-muted mb-2">Visitas a esta página por dia, em hora UTC.</p>
          <DailyBars days={days.map((d) => ({ date: d.dia, value: d.aberturas }))} format={(v) => fmtNum(v)} />
        </section>
        <section className="card">
          <h2 className="h2">Campos que mais falham</h2>
          <p className="text-xs text-muted mb-3">Vezes que cada campo do formulário não passou ao enviar, nesta página.</p>
          {!errors.length ? <p className="text-muted text-sm">Ainda nenhum campo falhou.</p> : (
            <ol className="space-y-2">{errors.map((e) => (
              <li key={e.campo} className="grid grid-cols-[150px_1fr_60px] gap-3 items-center text-sm"><span>{FORM_FIELDS[e.campo] ?? e.campo}</span><Bar value={e.vezes} max={maxErr} tone="warn" /><span className="num text-right">{fmtNum(e.vezes)}</span></li>))}</ol>
          )}
        </section>
      </div>

      <section className="card overflow-x-auto">
        <h2 className="h2">De onde vêm</h2>
        <p className="text-xs text-muted mb-3">Visitas a esta página. Meta é quem chega por um anúncio da campanha (utm_source=meta, ou com o clique da Meta e sem outra origem). Partilhas é quem chega pelo botão de partilha do site.</p>
        <table className="tbl"><thead><tr><th>Origem</th><th className="text-right">Visitas</th><th className="text-right">Ficam 6 s</th><th className="text-right">Começam a inscrição</th><th className="text-right">Enviam</th><th className="text-right">Pagam</th></tr></thead>
          <tbody>{funnel.map((r) => (
            <tr key={r.fonte}><td>{r.fonte}</td><td className="num text-right">{fmtNum(r.aberturas)}</td><td className="num text-right">{fmtPct(r.taxa_6s, 2)}</td><td className="num text-right">{fmtPct(r.taxa_inicio, 2)}</td><td className="num text-right">{fmtNum(r.enviadas)}</td><td className="num text-right">{fmtNum(r.pagas)}</td></tr>))}</tbody></table>
      </section>
    </section>
  );
}
