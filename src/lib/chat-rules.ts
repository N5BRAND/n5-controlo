// Regras puras do Chat: códigos do roadmap, menções, perguntas sem resposta, pendentes e arquivo.
// Sem acesso à base de dados, para serem testadas.

export const ARCHIVE_AFTER_DAYS = 90;
export const MAX_MESSAGE_LENGTH = 4000;

/** Códigos de itens do roadmap citados no texto (CLA-12, IMO-3). */
export function extractCodes(text: string): string[] {
  return [...new Set((text.match(/\b[A-Z]{2,5}-\d{1,5}\b/g) ?? []))];
}

/** Menções @Nome a pessoas da equipa (pelo primeiro nome ou nome completo, sem distinguir maiúsculas nem acentos). */
export function extractMentions(text: string, team: { id: string; name: string }[]): string[] {
  const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const t = norm(text);
  const ids = new Set<string>();
  for (const m of team) {
    const full = norm(m.name).replace(/\s*\(.*\)\s*/g, "").trim();
    const first = full.split(/\s+/)[0];
    if (!first) continue;
    const re = (w: string) => new RegExp(`(^|\\s)@${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "u");
    if (re(full.replace(/\s+/g, "\\s?")).test(t) || re(first).test(t)) ids.add(m.id);
  }
  return [...ids];
}

/** Uma mensagem que pede resposta: acaba em "?" ou tem "?" no fim de uma frase. */
export function isQuestion(text: string): boolean {
  return /\?\s*(\n|$)/.test(text.trim()) || /\?\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ]/.test(text);
}

const STOP = new Set(("a o e é de da do das dos em no na nos nas um uma uns umas para por com sem que se não sim mais menos já ainda muito pouco " +
  "isto isso aquilo este esta esse essa aquele aquela eu tu ele ela nós vós eles elas me te lhe nos vos lhes meu minha teu tua seu sua " +
  "como quando onde porque porquê qual quais quem ao aos à às pelo pela pelos pelas foi ser ter tem tens temos está estão estou fazer feito " +
  "falta ficou fica vai vamos pode podes podemos deve devemos bem ok obrigado obrigada hoje amanhã ontem também então só agora depois antes até sobre entre " +
  "the and for with this that from have will").split(/\s+/));

/** Palavras significativas (para temas e para ligar mensagens a itens pelo título). */
export function keywords(text: string): string[] {
  return (text.replace(/@[\p{L}\p{N}]+/gu, " ").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).filter((w) => !STOP.has(w));
}

/** Itens do roadmap a que uma mensagem se refere: pelo código ou por pelo menos 2 palavras significativas do título. */
export function matchItems<T extends { code: string; title: string }>(text: string, items: T[]): T[] {
  const codes = new Set(extractCodes(text));
  const words = new Set(keywords(text));
  return items.filter((i) => {
    if (codes.has(i.code)) return true;
    const tw = [...new Set(keywords(i.title))];
    return tw.length >= 2 && tw.filter((w) => words.has(w)).length >= 2;
  });
}

/** Temas mais falados: palavras significativas mais frequentes, contadas uma vez por mensagem. */
export function topKeywords(texts: string[], n = 8): { word: string; count: number }[] {
  const c = new Map<string, number>();
  for (const t of texts) for (const w of new Set(keywords(t))) c.set(w, (c.get(w) ?? 0) + 1);
  return [...c.entries()].filter(([, v]) => v >= 2).sort((a, b) => b[1] - a[1]).slice(0, n).map(([word, count]) => ({ word, count }));
}

export interface ChatMsg {
  id: string; body: string; kind: "mensagem" | "decisao" | "pendente"; parentId: string | null; userName: string | null;
  createdAt: Date; resolvedAt: Date | null; deletedAt: Date | null;
}
export interface PipelineItem { id: number; code: string; title: string; phase: string; dueDate: string | null; owner: string | null }

export type PendingSource = "marcado" | "pergunta" | "roadmap" | "prazo" | "backlog";
export interface PendingItem {
  source: PendingSource; title: string; detail: string; messageId?: string; itemId?: number; since?: Date;
}

/**
 * Pendentes de um canal, a partir da conversa e do estado do pipeline:
 *  - mensagens marcadas como pendente e não resolvidas;
 *  - perguntas sem nenhuma resposta há mais de 24 h (nos últimos `questionDays` dias);
 *  - itens do roadmap falados no chat que ainda não chegaram a produção (com a fase e o prazo);
 *  - itens com prazo ultrapassado ou a vencer, mesmo que não falados;
 *  - itens do backlog (ideia, descoberta) falados no chat, que ainda não têm dono.
 */
export function detectPending(messages: ChatMsg[], items: PipelineItem[], opts: {
  now?: Date; questionDays?: number; mentionDays?: number; deadline: (due: string | null, phase: string) => string;
}): PendingItem[] {
  const now = opts.now ?? new Date();
  const live = messages.filter((m) => !m.deletedAt);
  const out: PendingItem[] = [];
  for (const m of live.filter((x) => x.kind === "pendente" && !x.resolvedAt)) {
    out.push({ source: "marcado", title: short(m.body), detail: `marcado por ${m.userName ?? "alguém"}`, messageId: m.id, since: m.createdAt });
  }
  const qFrom = now.getTime() - (opts.questionDays ?? 14) * 864e5;
  const replied = new Set(live.filter((x) => x.parentId).map((x) => x.parentId));
  for (const m of live.filter((x) => x.kind === "mensagem" && !x.parentId && x.createdAt.getTime() >= qFrom && x.createdAt.getTime() <= now.getTime() - 864e5)) {
    if (isQuestion(m.body) && !replied.has(m.id)) out.push({ source: "pergunta", title: short(m.body), detail: `pergunta de ${m.userName ?? "alguém"} sem resposta`, messageId: m.id, since: m.createdAt });
  }
  const mFrom = now.getTime() - (opts.mentionDays ?? 30) * 864e5;
  const recent = live.filter((x) => x.createdAt.getTime() >= mFrom);
  const talked = new Map<number, ChatMsg>();
  for (const m of recent) for (const it of matchItems(m.body, items)) if (!talked.has(it.id) || talked.get(it.id)!.createdAt < m.createdAt) talked.set(it.id, m);
  const seen = new Set<number>();
  for (const it of items) {
    const st = opts.deadline(it.dueDate, it.phase);
    if (st === "concluido") continue;
    if (st === "atrasado" || st === "hoje" || st === "a_chegar") {
      out.push({ source: "prazo", title: `${it.code} ${it.title}`, detail: `${st === "atrasado" ? "prazo ultrapassado" : st === "hoje" ? "prazo hoje" : "prazo a chegar"} (${ptDate(it.dueDate!)}), em ${it.phase}${it.owner ? `, ${it.owner}` : ", sem dono"}`, itemId: it.id });
      seen.add(it.id);
    }
  }
  for (const [id, m] of talked) {
    if (seen.has(id)) continue;
    const it = items.find((x) => x.id === id)!;
    if (it.phase === "done" || it.phase === "canceled") continue;
    const backlog = it.phase === "sprint_backlog";
    out.push({
      source: backlog ? "backlog" : "roadmap", title: `${it.code} ${it.title}`, itemId: id, since: m.createdAt, messageId: m.id,
      detail: backlog ? `falado no chat e ainda em ${it.phase}${it.owner ? "" : ", sem dono"}` : `falado no chat, ainda em ${it.phase}${it.dueDate ? `, prazo ${ptDate(it.dueDate)}` : ", sem prazo"}${it.owner ? `, ${it.owner}` : ""}`,
    });
  }
  const order: PendingSource[] = ["prazo", "marcado", "pergunta", "roadmap", "backlog"];
  return out.sort((a, b) => order.indexOf(a.source) - order.indexOf(b.source));
}

/** AAAA-MM-DD → DD/MM/AAAA, como no resto da interface. */
export function ptDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function short(s: string, n = 140) {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}

/** Mês (AAAA-MM, UTC) a que pertence uma data; o arquivo resume por mês. */
export function monthOf(d: Date): string {
  return d.toISOString().slice(0, 7);
}

/** Meses com mensagens anteriores ao limite de arquivo e ainda sem resumo. Só meses completos antes do limite. */
export function monthsToArchive(messages: { createdAt: Date; summaryId: number | null }[], now = new Date(), days = ARCHIVE_AFTER_DAYS): string[] {
  const cutoff = new Date(now.getTime() - days * 864e5);
  const cutoffMonth = monthOf(cutoff);
  const months = new Set<string>();
  for (const m of messages) if (m.summaryId == null && m.createdAt < cutoff && monthOf(m.createdAt) < cutoffMonth) months.add(monthOf(m.createdAt));
  return [...months].sort();
}
