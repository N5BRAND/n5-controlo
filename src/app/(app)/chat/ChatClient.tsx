"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useT } from "@/lib/i18n/client";
import { askSummary, deleteMessage, editMessage, readChannel, sendMessage, setKind, togglePin, toggleResolved } from "./actions";

type Kind = "mensagem" | "decisao" | "pendente";
export interface Msg {
  id: string; userId: string | null; userName: string | null; body: string; kind: Kind; parentId: string | null; pinned: boolean;
  resolved: boolean; edited: boolean; deleted: boolean; mentions: string[]; createdAt: string;
}
interface Props {
  channel: string; channelName: string; me: string; canModerate: boolean; live: boolean;
  team: { id: string; name: string }[]; items: { id: number; code: string; title: string; phase: string }[];
  messages: Msg[]; emptyText: string;
}

const POLL_MS = 15_000;
const TZ = "Europe/Lisbon";
const dayFmt = new Intl.DateTimeFormat("pt-PT", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", timeZone: TZ });
const timeFmt = new Intl.DateTimeFormat("pt-PT", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const KIND_LABEL: Record<Kind, string> = { mensagem: "Mensagem", decisao: "Decisão", pendente: "Pendente" };

export function ChatClient(p: Props) {
  const t = useT();
  const router = useRouter();
  const endRef = useRef<HTMLDivElement>(null);
  const [replyTo, setReplyTo] = useState<Msg | null>(null);

  useEffect(() => {
    if (!p.live) return;
    readChannel(p.channel);
    endRef.current?.scrollIntoView({ block: "end" });
    // Atualização simples: volta a pedir a página a cada 15 s enquanto o separador está visível.
    const t = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, POLL_MS);
    return () => clearInterval(t);
  }, [p.channel, p.live, router]);

  const lastId = p.messages.at(-1)?.id;
  useEffect(() => { if (p.live) { endRef.current?.scrollIntoView({ block: "end" }); readChannel(p.channel); } }, [lastId, p.live, p.channel]);

  const byId = useMemo(() => new Map(p.messages.map((m) => [m.id, m])), [p.messages]);
  const replies = useMemo(() => {
    const r = new Map<string, Msg[]>();
    for (const m of p.messages) if (m.parentId && byId.has(m.parentId)) r.set(m.parentId, [...(r.get(m.parentId) ?? []), m]);
    return r;
  }, [p.messages, byId]);
  const roots = p.messages.filter((m) => !m.parentId || !byId.has(m.parentId));

  let lastDay = "";
  return (
    <div className="card p-0">
      <div className="max-h-[62vh] min-h-[300px] overflow-y-auto px-4 py-3" role="log" aria-label={t("Mensagens de {name}", { name: p.channelName })}>
        {roots.length === 0 ? <p className="text-muted text-sm py-10 text-center">{p.emptyText}</p> : null}
        {roots.map((m) => {
          const day = dayFmt.format(new Date(m.createdAt));
          const sep = day !== lastDay;
          lastDay = day;
          return (
            <Fragment key={m.id}>
              {sep ? <div className="text-xs text-muted text-center my-3 first-letter:uppercase"><span className="bg-surface px-2">{day}</span></div> : null}
              <MessageView m={m} p={p} onReply={() => setReplyTo(m)} />
              {(replies.get(m.id) ?? []).map((r) => (
                <div key={r.id} className="ml-8 border-l-2 border-line pl-3"><MessageView m={r} p={p} /></div>
              ))}
            </Fragment>
          );
        })}
        <div ref={endRef} />
      </div>
      {p.live ? <Composer p={p} replyTo={replyTo} clearReply={() => setReplyTo(null)} /> : null}
    </div>
  );
}

function MessageView({ m, p, onReply }: { m: Msg; p: Props; onReply?: () => void }) {
  const t = useT();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(m.body);
  const [err, setErr] = useState<string | null>(null);
  const mine = m.userId === p.me;
  const mentionsMe = m.mentions.includes(p.me);
  const run = (fn: () => Promise<{ error?: string } | undefined>) => start(async () => { const r = await fn(); setErr(r?.error ?? null); });

  if (m.deleted) return <div id={m.id} className="py-1.5 text-sm text-muted italic">{t("Mensagem apagada.")}</div>;
  const tone = m.kind === "decisao" ? "border-l-4 border-good bg-good/5" : m.kind === "pendente" ? (m.resolved ? "border-l-4 border-line" : "border-l-4 border-warn bg-warn/5") : mentionsMe ? "bg-accent-soft" : "";
  return (
    <article id={m.id} className={`group relative rounded-md px-2 py-1.5 my-0.5 ${tone} ${pending ? "opacity-60" : ""}`}>
      <header className="flex flex-wrap items-baseline gap-2 text-sm">
        <span className="font-semibold">{m.userName ?? t("Ex-membro")}</span>
        <time className="text-xs text-muted" dateTime={m.createdAt}>{timeFmt.format(new Date(m.createdAt))}</time>
        {m.kind !== "mensagem" ? <span className={`pill ${m.kind === "decisao" ? "text-good border-good/40" : m.resolved ? "text-muted border-line line-through" : "text-warn border-warn/40"}`}>{m.kind === "pendente" && m.resolved ? t("Pendente resolvido") : t(KIND_LABEL[m.kind])}</span> : null}
        {m.pinned ? <span className="pill text-accent border-accent/40">{t("fixada")}</span> : null}
        {m.edited ? <span className="text-xs text-muted">{t("(editada)")}</span> : null}
        <span className="absolute right-2 -top-3 z-10 flex flex-wrap gap-2 rounded-md border border-line bg-surface px-2 py-1 text-xs text-muted shadow-sm opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto">
          {onReply ? <button type="button" className="hover:text-ink" onClick={onReply}>{t("Responder")}</button> : null}
          <button type="button" className="hover:text-ink" onClick={() => run(() => togglePin(m.id))}>{m.pinned ? t("Desafixar") : t("Fixar")}</button>
          {m.kind !== "decisao" ? <button type="button" className="hover:text-ink" onClick={() => run(() => setKind(m.id, "decisao"))}>{t("Marcar decisão")}</button> : null}
          {m.kind !== "pendente" ? <button type="button" className="hover:text-ink" onClick={() => run(() => setKind(m.id, "pendente"))}>{t("Marcar pendente")}</button> : null}
          {m.kind === "pendente" ? <button type="button" className="hover:text-ink" onClick={() => run(() => toggleResolved(m.id))}>{m.resolved ? t("Reabrir") : t("Resolver")}</button> : null}
          {m.kind !== "mensagem" ? <button type="button" className="hover:text-ink" onClick={() => run(() => setKind(m.id, "mensagem"))}>{t("Tirar marca")}</button> : null}
          {mine ? <button type="button" className="hover:text-ink" onClick={() => setEditing(true)}>{t("Editar")}</button> : null}
          {mine || p.canModerate ? <button type="button" className="hover:text-bad" onClick={() => { if (window.confirm(t("Apagar esta mensagem? Fica guardada no histórico de auditoria."))) run(() => deleteMessage(m.id)); }}>{t("Apagar")}</button> : null}
        </span>
      </header>
      {editing ? (
        <form className="mt-1 flex gap-2" onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await editMessage(m.id, text); if (!r?.error) setEditing(false); return r; }); }}>
          <textarea className="input" rows={2} value={text} onChange={(e) => setText(e.target.value)} aria-label={t("Editar mensagem")} />
          <div className="flex flex-col gap-1"><button className="btn btn-primary">{t("Guardar")}</button><button type="button" className="btn" onClick={() => { setEditing(false); setText(m.body); }}>{t("Cancelar")}</button></div>
        </form>
      ) : (
        <div className="text-sm whitespace-pre-wrap break-words mt-0.5"><RichText text={m.body} p={p} /></div>
      )}
      {err ? <p className="text-xs text-bad mt-1" role="alert">{err}</p> : null}
    </article>
  );
}

/** Códigos do roadmap viram links para o item; @menções ficam destacadas. */
function RichText({ text, p }: { text: string; p: Props }) {
  const parts = text.split(/(\b[A-Z]{2,5}-\d{1,5}\b|(?:^|(?<=\s))@[\p{L}][\p{L}\p{N}]*)/u);
  return (
    <>
      {parts.map((part, i) => {
        const item = p.items.find((it) => it.code === part);
        if (item) return <Link key={i} href={`/pipeline/${item.id}`} className="num text-accent hover:underline" title={`${item.title} · ${item.phase}`}>{part}</Link>;
        if (part.startsWith("@")) return <span key={i} className="font-semibold text-accent">{part}</span>;
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}

function Composer({ p, replyTo, clearReply }: { p: Props; replyTo: Msg | null; clearReply: () => void }) {
  const t = useT();
  const formRef = useRef<HTMLFormElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [state, action, sending] = useActionState(async (prev: { error?: string; ok?: string } | undefined, form: FormData) => {
    const r = await sendMessage(prev, form);
    if (r?.ok) { formRef.current?.reset(); clearReply(); }
    return r;
  }, undefined);
  useEffect(() => { if (replyTo) taRef.current?.focus(); }, [replyTo]);
  const names = p.team.map((t) => t.name.split(/\s+/)[0]).slice(0, 6).map((n) => `@${n}`).join(", ");
  return (
    <form ref={formRef} action={action} className="border-t border-line p-3 space-y-2">
      <input type="hidden" name="channel" value={p.channel} />
      {replyTo ? (
        <div className="flex items-center gap-2 text-xs bg-canvas rounded px-2 py-1">
          <span className="text-muted">{t("A responder a {name}:", { name: replyTo.userName ?? "" })}</span><span className="truncate">{replyTo.body.slice(0, 90)}</span>
          <input type="hidden" name="parentId" value={replyTo.id} />
          <button type="button" className="ml-auto text-muted hover:text-ink" onClick={clearReply} aria-label={t("Cancelar resposta")}>×</button>
        </div>
      ) : null}
      <label className="sr-only" htmlFor="chat-body">{t("Mensagem para #{name}", { name: p.channelName })}</label>
      <textarea
        id="chat-body" ref={taRef} name="body" rows={2} required maxLength={4000} className="input resize-y"
        placeholder={t("Mensagem para #{channel}. Cita itens pelo código (CLA-12) e pessoas com {names}.", { channel: p.channelName, names: names || t("@nome") })}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); formRef.current?.requestSubmit(); } }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <select name="kind" className="input w-auto" aria-label={t("Tipo de mensagem")} defaultValue="mensagem">
          <option value="mensagem">{t("Mensagem")}</option><option value="decisao">{t("Decisão")}</option><option value="pendente">{t("Pendente")}</option>
        </select>
        <span className="text-xs text-muted">{t("Enter envia · Shift+Enter muda de linha")}</span>
        {state?.error ? <span className="text-xs text-bad" role="alert">{state.error}</span> : null}
        <button className="btn btn-primary ml-auto" disabled={sending}>{sending ? t("A enviar…") : t("Enviar")}</button>
      </div>
    </form>
  );
}

export function SummaryButtons({ channel }: { channel: string }) {
  const t = useT();
  const [pending, start] = useTransition();
  const [which, setWhich] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const go = (mode: "ultimos_dias" | "pendentes") => { setWhich(mode); start(async () => { const r = await askSummary(channel, mode); setErr(r?.error ?? null); }); };
  return (
    <div className="flex flex-col gap-2">
      <button type="button" className="btn btn-primary justify-center" disabled={pending} onClick={() => go("ultimos_dias")}>{pending && which === "ultimos_dias" ? t("A resumir…") : t("O que se falou (7 dias)")}</button>
      <button type="button" className="btn justify-center" disabled={pending} onClick={() => go("pendentes")}>{pending && which === "pendentes" ? t("A procurar…") : t("Que temas estão pendentes?")}</button>
      {err ? <p className="text-xs text-bad" role="alert">{err}</p> : null}
    </div>
  );
}
