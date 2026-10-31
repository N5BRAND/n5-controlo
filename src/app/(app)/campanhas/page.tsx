import { requireUser, scopeSoftwares } from "@/lib/auth";
import { readFilters } from "@/lib/filters";
import { campaignMonitor, monitoredCampaigns, softwaresFor } from "@/lib/queries";
import { adRef, awarenessLevel, funnelRows, groupAds, landingPageOf } from "@/lib/metrics";
import { siteAnalytics, posthogConfigured, posthogProjectKeyOnly, type SiteData } from "@/lib/posthog";
import { siteFor } from "@/lib/siteQueries";
import { syncMetaLive } from "@/lib/meta";
import { fmtDate, fmtEur, fmtNum, fmtPct } from "@/lib/format";
import { Bar, Empty, Kpi, PageHeader, Pill, Tabs, withParams } from "@/components/ui";
import { DailyBars } from "@/components/DailyBars";
import { SiteBlock } from "./SiteBlock";
import { MetaLida } from "./MetaLida";
import { syncNow } from "./actions";

// Monitorização de uma campanha da Meta desde o início, como o painel da campanha: indicadores, funil do anúncio
// à pré-reserva, gasto e leads por dia, por landing page (com os números do site), por nível de consciência, por anúncio
// e, do PostHog, o que acontece na página principal. O nível e a página vêm do nome do anúncio («CLA · N3 · TEMA · /pasta/»).

const ratio = (a: number, b: number) => (b ? a / b : null);
const perUnit = (cents: number, n: number) => (n ? Math.round(cents / n) : null);
const n0 = (v: unknown) => Number(v) || 0;
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(new Date());
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1;

const STATUS: Record<string, string> = {
  ACTIVE: "Ativo", PAUSED: "Pausado", CAMPAIGN_PAUSED: "Pausado", ADSET_PAUSED: "Pausado", PENDING_REVIEW: "Em revisão", IN_PROCESS: "Em revisão",
  DISAPPROVED: "Reprovado", WITH_ISSUES: "Com problemas", ARCHIVED: "Arquivado", DELETED: "Apagado",
};
const REVIEW = new Set(["PENDING_REVIEW", "IN_PROCESS"]);
const PAGE_TONE: Record<string, string> = { Ativa: "verde", "Em revisão": "aviso", Parada: "vermelho", "Sem anúncios": "neutro" };

export default async function Campanhas({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser("campanhas");
  const sp = await searchParams;
  const filters = readFilters(sp);
  const sws = await softwaresFor(user);
  const ids = scopeSoftwares(user, filters.software, sws);
  // números da Meta ao vivo: cada abertura lê os últimos dias antes de mostrar
  const live = await syncMetaLive();
  const list = await monitoredCampaigns(ids);
  const asked = typeof sp.campanha === "string" ? sp.campanha : null;
  const chosen = list.find((c) => c.campaignId === asked) ?? list[0];
  const m = chosen ? await campaignMonitor(chosen.campaignId, ids) : null;
  const host = m?.softwareId ? siteFor(m.softwareId) : null;
  const site = host && m?.first ? await siteAnalytics(host, m.first) : null;
  const tabs = [
    { key: "monitorizacao", label: "Monitorização", href: withParams("/campanhas", sp) },
    { key: "todas", label: "Todas as campanhas", href: withParams("/campanhas/todas", sp) },
  ];

  return (
    <>
      <PageHeader title="Campanhas e funil" lead="Uma campanha da Meta desde o início: do anúncio à pré-reserva, por landing page, nível e anúncio, e o que acontece no site.">
        <MetaLida live={live} action={syncNow} />
      </PageHeader>
      <Tabs items={tabs} active="monitorizacao" />
      {!chosen || !m ? (
        <Empty title="Sem campanhas sincronizadas">Liga a conta de anúncios do software em Definições › Softwares e carrega em «Sincronizar Meta agora».</Empty>
      ) : (
        <Monitor m={m} chosen={chosen} list={list} sp={sp} host={host} site={site?.data ?? null} siteErrors={site?.errors ?? []} />
      )}
    </>
  );
}

type Monitor = NonNullable<Awaited<ReturnType<typeof campaignMonitor>>>;
type Campaign = Awaited<ReturnType<typeof monitoredCampaigns>>[number];

function Monitor({ m, chosen, list, sp, host, site, siteErrors }: {
  m: Monitor; chosen: Campaign; list: Campaign[]; sp: Record<string, string | string[] | undefined>; host: string | null; site: SiteData | null; siteErrors: string[];
}) {
  const t = m.totals;
  const days = m.first ? daysBetween(m.first, today()) : 0;
  const budgetToDate = m.dailyBudgetCents ? m.dailyBudgetCents * days : null;
  const funnel = funnelRows([
    { label: "Impressões", n: t.impressions }, { label: "Cliques", n: t.clicks }, { label: "Visitas à página", n: t.landingViews },
    { label: "Leads", n: t.leads }, { label: "Foram ao pagamento", n: t.checkouts }, { label: "Pré-reservas pagas", n: t.purchases },
  ]);

  // Anúncios: os que têm números e os que ainda não gastaram (por exemplo, em revisão), com estado e formato
  const infoById = new Map(m.adInfo.map((a) => [a.adId, a]));
  const infoByName = new Map(m.adInfo.map((a) => [a.name, a]));
  const zero = { spendCents: 0, impressions: 0, clicks: 0, leads: 0, landingViews: 0, purchases: 0, checkouts: 0, maxFrequency: null, lastSpend: null };
  const ads = [
    ...m.ads.map((a) => ({ ...a, info: (a.adId ? infoById.get(a.adId) : undefined) ?? infoByName.get(a.adName) })),
    ...m.adInfo.filter((i) => !m.ads.some((a) => a.adId === i.adId || a.adName === i.name)).map((i) => ({ ...zero, adName: i.name, adsetName: i.adsetName ?? "", adId: i.adId, sw: i.softwareId, info: i })),
  ];

  // Compras da Stripe por anúncio: pelo utm_content da ligação do anúncio (ou pelo nome, se a Meta não o deu).
  // Cada utm_content conta uma vez, no anúncio que mais gastou, para o total da coluna bater com a Stripe.
  const stripeOf = new Map<string, number>();
  const usedRefs = new Set<string>();
  for (const a of ads) {
    const ref = a.info?.adRef || adRef(a.adName);
    if (!ref || usedRefs.has(ref)) continue;
    usedRefs.add(ref);
    stripeOf.set(a.adId ?? a.adName, m.stripeByAd.get(ref) ?? 0);
  }
  const stripeUnlinked = m.stripeTotal - [...stripeOf.values()].reduce((s, n) => s + n, 0);

  // Por landing page: números da Meta pelos anúncios que levam lá, estado pelos anúncios, e o site (PostHog) nessa página
  const metaPages = new Map(groupAds(ads, (r) => landingPageOf(r.adName)).map((g) => [g.key, g]));
  const statusPages = new Map<string, { active: number; review: number; total: number }>();
  for (const i of m.adInfo) {
    const k = landingPageOf(i.name);
    const s = statusPages.get(k) ?? { active: 0, review: 0, total: 0 };
    s.total++; if (i.status === "ACTIVE") s.active++; if (REVIEW.has(i.status ?? "")) s.review++;
    statusPages.set(k, s);
  }
  const sitePages = new Map((site?.pages ?? []).map((r) => [String(r.pagina), r]));
  const pageKeys = [...new Set(["/", ...metaPages.keys(), ...statusPages.keys()])];
  const pages = pageKeys.map((key) => {
    const g = metaPages.get(key), s = statusPages.get(key), p = sitePages.get(key);
    const state = s?.active ? "Ativa" : s?.review ? "Em revisão" : s?.total ? "Parada" : "Sem anúncios";
    const visits = n0(p?.aberturas);
    return { key, state, active: s?.active ?? 0, spendCents: g?.spendCents ?? 0, clicks: g?.clicks ?? 0, leads: g?.leads ?? 0,
      visits, fromMeta: n0(p?.aberturas_meta), stay: visits ? n0(p?.qualificadas) / visits : null, sent: n0(p?.enviadas), paid: n0(p?.pagas) };
  }).sort((a, b) => (a.key === "/" ? -1 : b.key === "/" ? 1 : b.spendCents - a.spendCents || a.key.localeCompare(b.key)));
  const activePages = pages.filter((p) => p.state === "Ativa").length;

  const levels = groupAds(ads, (r) => { const n = awarenessLevel(r.adName); return n ? `N${n}` : "Sem nível"; })
    .sort((a, b) => a.key.localeCompare(b.key, "pt"));
  const maxLevel = Math.max(...levels.map((l) => l.spendCents), 1);
  const keep = Object.fromEntries(Object.entries(sp).filter(([k, v]) => k !== "campanha" && typeof v === "string")) as Record<string, string>;

  return (
    <div className="space-y-4">
      <form method="get" className="flex flex-wrap items-end gap-3">
        {Object.entries(keep).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <div><label className="label" htmlFor="campanha">Campanha</label>
          <select id="campanha" name="campanha" defaultValue={chosen.campaignId} className="input min-w-[18rem]">
            {list.map((c) => <option key={c.campaignId} value={c.campaignId}>{c.name}</option>)}
          </select></div>
        <button className="btn">Ver</button>
      </form>

      <p className="text-lg max-w-3xl">
        Em <b className="num">{fmtNum(days)}</b> dias, desde {fmtDate(m.first)}, <b className="num">{fmtEur(t.spendCents)}</b> de anúncios trouxeram{" "}
        <b className="num">{fmtNum(t.leads)}</b> leads{t.leads ? <>, a <b className="num">{fmtEur(perUnit(t.spendCents, t.leads))}</b> cada,</> : ""} e{" "}
        <b className="num">{fmtNum(t.purchases)}</b> pré-reservas pagas.
      </p>

      <section className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <Kpi label="Gasto" value={fmtEur(t.spendCents)} note={budgetToDate ? `de ${fmtEur(budgetToDate)} de orçamento até hoje` : "desde o início"} />
        <Kpi label="Leads" value={fmtNum(t.leads)} note={`${fmtNum(t.landingViews)} visitas à página`} />
        <Kpi label="Custo por lead" value={fmtEur(perUnit(t.spendCents, t.leads))} note="gasto a dividir pelas leads" />
        <Kpi label="Pré-reservas pagas" value={fmtNum(m.stripeTotal)} note={`na Stripe · ${fmtNum(t.purchases)} no píxel · ${fmtNum(t.checkouts)} foram ao pagamento`} />
        <Kpi label="CTR" value={fmtPct(ratio(t.clicks, t.impressions), 2)} note={`${fmtNum(t.clicks)} cliques em ${fmtNum(t.impressions)} impressões`} />
        {m.frequency !== null ? (
          <Kpi label="Frequência" value={m.frequency.toFixed(2).replace(".", ",")} note={`vezes por pessoa · ${fmtNum(m.reach)} pessoas alcançadas`} />
        ) : (
          <Kpi label="Custo por clique" value={fmtEur(perUnit(t.spendCents, t.clicks))} note={`CPM ${fmtEur(t.impressions ? Math.round((t.spendCents / t.impressions) * 1000) : null)}`} />
        )}
      </section>

      <section className="card">
        <h2 className="h2">Do anúncio à pré-reserva</h2>
        <p className="text-xs text-muted mb-3">Desde o início. Ao lado de cada passo, a parte que passou do passo anterior; a maior perda está a vermelho.</p>
        <ol className="space-y-2">
          {funnel.map((s) => (
            <li key={s.label} className="grid grid-cols-[150px_1fr_170px] gap-3 items-center text-sm">
              <span>{s.label}</span><Bar value={s.n} max={funnel[0].n || 1} tone={s.worst ? "bad" : "accent"} />
              <span className="num text-right">{fmtNum(s.n)}{s.fromPrevious !== null ? <span className="text-muted text-xs"> · {fmtPct(s.fromPrevious, 2)} do anterior</span> : null}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="card overflow-x-auto">
        <h2 className="h2">Por landing page</h2>
        <p className="text-base mb-1">Com anúncios a correr: <b className="num">{fmtNum(activePages)}</b> de <b className="num">{fmtNum(pages.length)}</b> landing pages.</p>
        <p className="text-xs text-muted mb-3">Cada página para onde os anúncios levam, desde o início. Está ativa quando tem pelo menos um anúncio a correr. Gasto, cliques e leads são da Meta, somados pelos anúncios que levam a essa página (o endereço no fim do nome do anúncio; sem endereço, a página principal). Visitas, 6 segundos e inscrições são do site, contadas nessa página; quem paga conta na página onde abriu o pagamento.</p>
        <table className="tbl">
          <thead><tr><th>Página</th><th>Estado</th><th className="text-right">Anúncios a correr</th><th className="text-right">Gasto</th><th className="text-right">Cliques</th><th className="text-right">Leads</th><th className="text-right">Custo/lead</th><th className="text-right">Visitas</th><th className="text-right">Da Meta</th><th className="text-right">Ficam 6 s</th><th className="text-right">Inscrições</th><th className="text-right">Pagam</th></tr></thead>
          <tbody>{pages.map((p) => (
            <tr key={p.key}><td className="num">{p.key}</td><td><Pill tone={PAGE_TONE[p.state]}>{p.state}</Pill></td><td className="num text-right">{fmtNum(p.active)}</td>
              <td className="num text-right">{fmtEur(p.spendCents)}</td><td className="num text-right">{fmtNum(p.clicks)}</td><td className="num text-right">{fmtNum(p.leads)}</td>
              <td className="num text-right">{fmtEur(perUnit(p.spendCents, p.leads))}</td>
              <td className="num text-right">{site ? fmtNum(p.visits) : "–"}</td><td className="num text-right">{site ? fmtNum(p.fromMeta) : "–"}</td>
              <td className="num text-right">{site ? fmtPct(p.stay, 2) : "–"}</td><td className="num text-right">{site ? fmtNum(p.sent) : "–"}</td><td className="num text-right">{site ? fmtNum(p.paid) : "–"}</td></tr>
          ))}</tbody>
        </table>
      </section>

      <div className="grid lg:grid-cols-2 gap-4">
        <section className="card">
          <h2 className="h2">Gasto por dia</h2>
          <p className="text-xs text-muted mb-2">Em euros.{m.dailyBudgetCents ? " A linha tracejada é o orçamento diário." : ""}</p>
          <DailyBars days={m.days.map((d) => ({ date: d.date, value: d.spendCents }))} format={(v) => fmtEur(v)} reference={m.dailyBudgetCents} referenceLabel="orçamento" />
        </section>
        <section className="card">
          <h2 className="h2">Leads por dia</h2>
          <p className="text-xs text-muted mb-2">Inscrições no site com o evento Lead do píxel.</p>
          <DailyBars days={m.days.map((d) => ({ date: d.date, value: d.leads }))} format={(v) => fmtNum(v)} />
        </section>
      </div>

      <section className="card">
        <h2 className="h2">Por nível de consciência</h2>
        <p className="text-xs text-muted mb-3">N1 é quem ainda não sabe que tem o problema; N5 quem já está pronto para a pré-reserva. A barra é o gasto desde o início; ao lado, as leads e o custo por lead.</p>
        <ol className="space-y-2">
          {levels.map((l) => (
            <li key={l.key} className="grid grid-cols-[150px_1fr_220px] gap-3 items-center text-sm">
              <span>{l.key} · {fmtNum(l.ads)} anúncios</span><Bar value={l.spendCents} max={maxLevel} />
              <span className="num text-right">{fmtEur(l.spendCents)}<span className="text-muted text-xs"> · {fmtNum(l.leads)} leads{l.leads ? ` · ${fmtEur(perUnit(l.spendCents, l.leads))} por lead` : " · sem custo por lead"}</span></span>
            </li>
          ))}
        </ol>
      </section>

      <section className="card overflow-x-auto">
        <h2 className="h2">Anúncios</h2>
        <p className="text-xs text-muted mb-3">Todos os anúncios da campanha, desde o início, do que gastou mais para o que gastou menos. «Pré-reservas (píxel)» é o que a Meta conta; «Compras Stripe» são os pagamentos confirmados pela Stripe, ligados ao anúncio pela inscrição da pessoa (o utm_content com que chegou ao site).{stripeUnlinked > 0 ? ` ${fmtNum(stripeUnlinked)} ${stripeUnlinked === 1 ? "compra" : "compras"} sem anúncio ligado (sem inscrição no site com o mesmo email, ou vinda de fora dos anúncios).` : ""}</p>
        <div className="max-h-[34rem] overflow-auto">
          <table className="tbl">
            <thead><tr><th>Anúncio</th><th>Nível</th><th>Formato</th><th>Estado</th><th className="text-right">Gasto</th><th className="text-right">Impressões</th><th className="text-right">CTR</th><th className="text-right">Leads</th><th className="text-right">Custo/lead</th><th className="text-right">Pré-reservas (píxel)</th><th className="text-right">Compras Stripe</th></tr></thead>
            <tbody>{ads.map((a) => (
              <tr key={a.adId ?? a.adName}><td className="max-w-xs">{a.adName}</td><td>{awarenessLevel(a.adName) ? `N${awarenessLevel(a.adName)}` : "–"}</td>
                <td>{a.info?.format === "video" ? "Vídeo" : a.info ? "Imagem" : "–"}</td><td>{a.info?.status ? STATUS[a.info.status] ?? a.info.status : "–"}</td>
                <td className="num text-right">{fmtEur(a.spendCents)}</td><td className="num text-right">{fmtNum(a.impressions)}</td><td className="num text-right">{fmtPct(ratio(a.clicks, a.impressions), 2)}</td>
                <td className="num text-right">{fmtNum(a.leads)}</td><td className="num text-right">{fmtEur(perUnit(a.spendCents, a.leads))}</td><td className="num text-right">{fmtNum(a.purchases)}</td>
                <td className="num text-right">{fmtNum(stripeOf.get(a.adId ?? a.adName) ?? 0)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      {host && site ? <SiteBlock host={host} site={site} metaClicksByDay={m.days.map((d) => ({ date: d.date, clicks: d.clicks }))} /> : (
        <section className="card">
          <h2 className="h2">O que acontece no site</h2>
          <p className="text-sm text-muted">{!host ? "Este software ainda não tem um site ligado ao PostHog." : posthogProjectKeyOnly()
            ? "A POSTHOG_API_KEY que está na Netlify é a chave do projeto (começa por phc_): é a do site, serve para enviar eventos e não deixa ler números. Cria no PostHog uma chave pessoal (Settings › Personal API keys, começa por phx_) só com «Query: Read» e põe-na em POSTHOG_PERSONAL_API_KEY. Com ela, aparecem aqui as conclusões, o funil da página, as secções, o tempo, os passos da inscrição, os campos com erros e de onde vêm as visitas."
            : !posthogConfigured()
            ? "Falta a chave pessoal do PostHog (POSTHOG_PERSONAL_API_KEY, só com «Query: Read») nas variáveis da Netlify. Com ela, aparecem aqui as conclusões, o funil da página, as secções, o tempo, os passos da inscrição, os campos com erros e de onde vêm as visitas, e as colunas do site em «Por landing page»."
            : "Não foi possível ler o PostHog."}</p>
        </section>
      )}
      {siteErrors.length ? <p className="text-xs text-warn">Algumas leituras do PostHog falharam: {siteErrors.join(" · ")}</p> : null}

      <p className="text-xs text-muted max-w-3xl">Números da Meta lidos ao abrir a página (hoje e ontem; os 28 dias são recalculados de 6 em 6 horas e no botão). Leads e pré-reservas são os eventos Lead e Purchase do píxel: só contam quem aceita os cookies de marketing, por isso o site e a Stripe têm sempre mais. A Meta ainda corrige os últimos dias. Os números do site vêm do PostHog e guardam-se 5 minutos.</p>
    </div>
  );
}
