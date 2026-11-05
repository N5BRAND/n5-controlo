import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { archiveSummaries, canUseChannel, channelsFor, GENERAL, lastSummary, listMessages, pipelineFor, teamList, unreadCounts } from "@/lib/chat";
import { ARCHIVE_AFTER_DAYS } from "@/lib/chat-rules";
import { llmConfigured } from "@/lib/llm";
import { fmtDateTime } from "@/lib/format";
import { Empty, PageHeader, Pill } from "@/components/ui";
import { getT } from "@/lib/i18n/server";
import { ChatClient, SummaryButtons } from "./ChatClient";

type SP = Record<string, string | string[] | undefined>;
const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

const FILTERS = [
  { key: "todas", label: "Todas" }, { key: "decisoes", label: "Decisões" }, { key: "pendentes", label: "Pendentes" },
  { key: "fixadas", label: "Fixadas" }, { key: "mencoes", label: "Menções a mim" },
];
const monthName = (d: Date) => new Intl.DateTimeFormat("pt-PT", { month: "long", year: "numeric", timeZone: "UTC" }).format(d);

export default async function Chat({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser("chat");
  const t = await getT();
  const sp = await searchParams;
  const channels = await channelsFor(user);
  const wanted = str(sp.canal) ?? GENERAL;
  const channel = channels.find((c) => c.id === wanted && canUseChannel(user, c.id)) ?? channels[0];
  const filter = str(sp.filtro) ?? "todas";
  const q = str(sp.q)?.trim().slice(0, 100) || undefined;
  const month = str(sp.mes);
  const allowed = channels.filter((c) => c.id !== GENERAL).map((c) => c.id);

  const [messages, unread, archive, summary, team, items] = await Promise.all([
    listMessages(channel.id, { q, month, filter, userId: user.sub }),
    unreadCounts(user.sub, channels.map((c) => c.id)),
    archiveSummaries(channel.id),
    lastSummary(channel.id),
    teamList(),
    pipelineFor(channel.id, allowed),
  ]);
  const href = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ canal: channel.id, ...extra })) if (v) p.set(k, v);
    return `/chat?${p}`;
  };
  const pinned = messages.filter((m) => m.pinned && !m.deletedAt);
  const openPending = messages.filter((m) => m.kind === "pendente" && !m.resolvedAt && !m.deletedAt).length;
  const browsing = q ? t("Resultados da pesquisa \"{q}\" em todo o histórico", { q }) : month ? t("Mensagens originais de {month} (arquivo)", { month: monthName(new Date(`${month}-01T00:00:00Z`)) }) : null;

  return (
    <>
      <PageHeader title="Chat" lead={t("Conversa de trabalho por projeto. Todo o histórico fica guardado; o que tem mais de {days} dias é resumido automaticamente por mês, e as mensagens originais continuam a um clique.", { days: ARCHIVE_AFTER_DAYS })} />
      <div className="grid gap-4 lg:grid-cols-[200px_minmax(0,1fr)_300px]">
        <nav aria-label={t("Canais")} className="card p-2 h-fit">
          <div className="text-xs font-semibold text-muted px-2 py-1">{t("Canais")}</div>
          <ul>
            {channels.map((c) => {
              const u = unread.get(c.id);
              return (
                <li key={c.id}>
                  <Link href={`/chat?canal=${c.id}`} className={`flex items-center justify-between rounded-md px-2 py-1.5 text-sm ${c.id === channel.id ? "bg-accent-soft text-accent font-semibold" : "hover:bg-canvas"}`} aria-current={c.id === channel.id ? "page" : undefined}>
                    <span># {c.name}</span>
                    {u?.mentions ? <span className="pill text-white bg-bad border-bad">@{u.mentions}</span> : u?.unread && c.id !== channel.id ? <span className="pill text-accent border-accent/40 bg-accent-soft">{u.unread}</span> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted px-2 mt-2">{t("Cada software tem o seu canal; o Geral é para assuntos de todos.")}</p>
        </nav>

        <section className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <nav className="flex flex-wrap gap-1" aria-label={t("Filtros")}>
              {FILTERS.map((f) => (
                <Link key={f.key} href={href({ filtro: f.key === "todas" ? undefined : f.key })} className={`tab ${f.key === filter && !q && !month ? "tab-active" : ""}`}>
                  {t(f.label)}{f.key === "pendentes" && openPending && filter !== "pendentes" ? ` (${openPending})` : ""}
                </Link>
              ))}
            </nav>
            <form action="/chat" className="ml-auto flex gap-1" role="search">
              <input type="hidden" name="canal" value={channel.id} />
              <input name="q" defaultValue={q} placeholder={t("Pesquisar em todo o histórico")} className="input w-56" aria-label={t("Pesquisar mensagens")} />
              <button className="btn">{t("Pesquisar")}</button>
            </form>
          </div>
          {browsing ? (
            <div className="card mb-3 flex items-center justify-between text-sm bg-accent-soft border-accent/30">
              <span>{browsing} · {t("{n} mensagem(ns)", { n: messages.length })}</span>
              <Link href={href({})} className="btn">{t("Voltar à conversa")}</Link>
            </div>
          ) : null}

          {!browsing && archive.length && filter === "todas" ? (
            <details className="card mb-3">
              <summary className="cursor-pointer text-sm font-semibold">{archive.length === 1 ? t("Arquivo resumido · {n} mês com mais de {days} dias", { n: archive.length, days: ARCHIVE_AFTER_DAYS }) : t("Arquivo resumido · {n} meses com mais de {days} dias", { n: archive.length, days: ARCHIVE_AFTER_DAYS })}</summary>
              <ul className="mt-3 space-y-3">
                {archive.map((a) => {
                  const m = a.periodStart.toISOString().slice(0, 7);
                  return (
                    <li key={a.id} className="border-t border-line pt-3">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        <span className="capitalize">{monthName(a.periodStart)}</span>
                        <span className="text-muted text-xs">{a.engine === "regras" ? t("{n} mensagens · resumo por regras", { n: a.messages }) : t("{n} mensagens · resumo por IA", { n: a.messages })}</span>
                        <Link href={href({ mes: m })} className="text-accent text-xs hover:underline ml-auto">{t("Ver mensagens originais")}</Link>
                      </div>
                      <div className="text-sm whitespace-pre-wrap mt-1">{a.content}</div>
                    </li>
                  );
                })}
              </ul>
            </details>
          ) : null}

          <ChatClient
            key={`${channel.id}:${filter}:${q ?? ""}:${month ?? ""}`}
            channel={channel.id}
            channelName={channel.name}
            me={user.sub}
            canModerate={user.role !== "colaborador"}
            live={!browsing}
            team={team.map((t) => ({ id: t.id, name: t.name }))}
            items={items.map((i) => ({ id: i.id, code: i.code, title: i.title, phase: i.phase }))}
            messages={messages.map((m) => ({
              id: m.id, userId: m.userId, userName: m.userName, body: m.body, kind: m.kind, parentId: m.parentId, pinned: m.pinned,
              resolved: !!m.resolvedAt, edited: !!m.editedAt, deleted: !!m.deletedAt, mentions: m.mentions, createdAt: m.createdAt.toISOString(),
            }))}
            emptyText={browsing ? t("Nada encontrado.") : filter !== "todas" ? t("Nenhuma mensagem com este filtro.") : t("Ainda não há mensagens neste canal. Começa a conversa.")}
          />
        </section>

        <aside className="space-y-4">
          <section className="card">
            <h2 className="h2">{t("Pôr-me a par")}</h2>
            <p className="text-xs text-muted mb-3">{channel.id === GENERAL ? t("Resume a conversa e cruza-a com o pipeline, o roadmap e o backlog de todos os softwares.") : t("Resume a conversa e cruza-a com o pipeline, o roadmap e o backlog do {name}.", { name: channel.name })}</p>
            <SummaryButtons channel={channel.id} />
            {!llmConfigured() ? <p className="text-xs text-muted mt-2">{t("Sem modelo de IA ligado: o resumo é feito por regras (temas, decisões e pendentes). Liga o Bedrock em LLM_PROVIDER para um texto corrido.")}</p> : null}
          </section>
          {summary ? (
            <section className="card" aria-live="polite">
              <div className="flex items-center gap-2 mb-2">
                <h2 className="h2 mb-0">{summary.kind === "pendentes" ? t("Pendentes") : t("O que se falou")}</h2>
                <Pill tone={summary.engine === "regras" ? "neutro" : "accent"}>{summary.engine === "regras" ? t("regras") : t("IA")}</Pill>
              </div>
              <div className="text-xs text-muted mb-2">{t("Pedido a {date} · {n} mensagens analisadas", { date: fmtDateTime(summary.createdAt), n: summary.messages })}</div>
              <div className="text-sm whitespace-pre-wrap leading-relaxed">{summary.content}</div>
            </section>
          ) : (
            <Empty title={t("Sem resumos ainda")}>{t("Carrega num dos botões acima.")}</Empty>
          )}
          {pinned.length ? (
            <section className="card">
              <h2 className="h2">{t("Fixadas")}</h2>
              <ul className="space-y-2 text-sm">
                {pinned.map((p) => <li key={p.id}><a href={`#${p.id}`} className="hover:underline">{p.body.slice(0, 120)}</a> <span className="text-xs text-muted">— {p.userName}</span></li>)}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>
    </>
  );
}
