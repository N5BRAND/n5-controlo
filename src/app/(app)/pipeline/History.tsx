import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { fmtDate, fmtDateTime, LABELS } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import type { TFn } from "@/lib/i18n";
import { Empty } from "@/components/ui";

type Row = typeof schema.auditLog.$inferSelect;
type Snap = Record<string, unknown> | null;

const FIELD_LABELS: Record<string, string> = {
  title: "Título", description: "Descrição", impact: "Impacto", reach: "Alcance", confidence: "Confiança", effort: "Esforço",
  ownerUserId: "Responsável", agent: "Pode ir para um agente de código", acceptanceCriteria: "Critérios de aceitação", productEvents: "Eventos de produto",
  sprint: "Sprint", version: "Versão", dueDate: "Vencimento", priority: "Prioridade", phase: "Fase",
};

const cut = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Texto de um valor de campo, como se mostra no histórico. */
function show(key: string, v: unknown, t: TFn, names: Map<string, string>): string {
  if (v === null || v === undefined || v === "") return "–";
  if (key === "phase") return LABELS.phase[v as keyof typeof LABELS.phase] ?? String(v);
  if (key === "priority") return t(LABELS.priority[v as keyof typeof LABELS.priority] ?? String(v));
  if (key === "ownerUserId") return names.get(String(v)) ?? t("Utilizador removido");
  if (key === "dueDate") return fmtDate(String(v));
  if (typeof v === "boolean") return v ? t("Sim") : t("Não");
  if (Array.isArray(v)) return v.length ? v.join(", ") : "–";
  return cut(String(v));
}

/** O que aconteceu numa linha do histórico: uma frase curta e, se houver, os detalhes. */
function describe(r: Row, t: TFn, names: Map<string, string>): { what: string; details: string[] } {
  const before = (r.before ?? null) as Snap;
  const after = (r.after ?? null) as Snap;
  switch (r.action) {
    case "roadmap.created": return { what: t("criou a tarefa"), details: [] };
    case "roadmap.deleted": return { what: t("apagou a tarefa"), details: [] };
    case "roadmap.moved": return { what: t("mudou o estágio"), details: [`${show("phase", before?.phase, t, names)} → ${show("phase", after?.phase, t, names)}`] };
    case "roadmap.owner": return { what: t("mudou o responsável"), details: [`${show("ownerUserId", before?.ownerUserId, t, names)} → ${show("ownerUserId", after?.ownerUserId, t, names)}`] };
    case "roadmap.due": return { what: t("mudou o vencimento"), details: [`${show("dueDate", before?.dueDate, t, names)} → ${show("dueDate", after?.dueDate, t, names)}`] };
    case "roadmap.priority": return { what: t("mudou a prioridade"), details: [`${show("priority", before?.priority, t, names)} → ${show("priority", after?.priority, t, names)}`] };
    case "roadmap.commented": return { what: t("comentou"), details: after?.body ? [cut(String(after.body), 160)] : [] };
    case "roadmap.updated": {
      const keys = Object.keys(after ?? {});
      return {
        what: t("editou a tarefa"),
        details: keys.map((k) => `${t(FIELD_LABELS[k] ?? k)}: ${show(k, before?.[k], t, names)} → ${show(k, after?.[k], t, names)}`),
      };
    }
    default: return { what: r.action, details: [] };
  }
}

/**
 * Histórico das tarefas do Pipeline: o que se criou, alterou, comentou ou apagou, por quem e quando.
 * Com `itemId` mostra só essa tarefa (lista compacta); sem ele mostra todas, incluindo as já apagadas.
 */
export async function History({ itemId, limit = 200, softwareIds = "all" }: { itemId?: number; limit?: number; softwareIds?: string[] | "all" }) {
  const t = await getT();
  const where = itemId === undefined
    ? eq(schema.auditLog.entity, "roadmap_item")
    : and(eq(schema.auditLog.entity, "roadmap_item"), eq(schema.auditLog.entityId, String(itemId)));
  let rows = await db.select().from(schema.auditLog).where(where).orderBy(desc(schema.auditLog.at), desc(schema.auditLog.id)).limit(softwareIds === "all" ? limit : limit * 4);

  const users = await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users);
  const names = new Map(users.map((u) => [u.id, u.name]));
  const who = (actor: string) => (actor.startsWith("user:") ? names.get(actor.slice(5)) ?? t("Utilizador removido") : actor);

  if (!rows.length) return <Empty title={t("Ainda sem histórico.")} />;

  // Tarefa de cada linha: a que existe agora ou, se foi apagada, o retrato guardado ao criar/apagar
  const ids = [...new Set(rows.map((r) => Number(r.entityId)).filter((n) => Number.isFinite(n)))];
  const items = ids.length ? await db.select({ id: schema.roadmapItems.id, code: schema.roadmapItems.code, title: schema.roadmapItems.title, softwareId: schema.roadmapItems.softwareId }).from(schema.roadmapItems).where(inArray(schema.roadmapItems.id, ids)) : [];
  const live = new Map(items.map((i) => [String(i.id), i]));
  const snapshot = new Map<string, { code: string; title: string; softwareId: string | null }>();
  for (const r of rows) {
    const s = ((r.action === "roadmap.deleted" ? r.before : r.action === "roadmap.created" ? r.after : null) ?? null) as Snap;
    if (s && r.entityId && typeof s.code === "string") snapshot.set(r.entityId, { code: s.code, title: String(s.title ?? ""), softwareId: typeof s.softwareId === "string" ? s.softwareId : null });
  }

  // Quem só vê alguns softwares vê apenas o histórico das tarefas deles (as apagadas contam pelo retrato guardado)
  if (itemId === undefined && softwareIds !== "all") {
    const allowed = new Set(softwareIds);
    rows = rows.filter((r) => {
      const sw = (r.entityId ? live.get(r.entityId)?.softwareId ?? snapshot.get(r.entityId)?.softwareId : null) ?? null;
      return sw !== null && allowed.has(sw);
    }).slice(0, limit);
    if (!rows.length) return <Empty title={t("Ainda sem histórico.")} />;
  }

  if (itemId !== undefined) {
    return (
      <ul className="space-y-3">
        {rows.map((r) => {
          const d = describe(r, t, names);
          return (
            <li key={r.id} className="text-sm">
              <div><span className="font-medium">{who(r.actor)}</span> {d.what} <span className="text-xs text-muted">· {fmtDateTime(r.at)}</span></div>
              {d.details.length ? <ul className="mt-0.5 space-y-0.5 text-xs text-muted">{d.details.map((x, i) => <li key={i}>{x}</li>)}</ul> : null}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <section className="card overflow-x-auto">
      <table className="tbl">
        <thead><tr><th>{t("Quando")}</th><th>{t("Quem")}</th><th>{t("Tarefa")}</th><th>{t("O quê")}</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const d = describe(r, t, names);
            const item = r.entityId ? live.get(r.entityId) : undefined;
            const snap = r.entityId ? snapshot.get(r.entityId) : undefined;
            return (
              <tr key={r.id}>
                <td className="whitespace-nowrap text-muted">{fmtDateTime(r.at)}</td>
                <td className="whitespace-nowrap">{who(r.actor)}</td>
                <td className="max-w-xs">
                  {item ? <Link href={`/pipeline/${item.id}`} className="hover:underline"><span className="num mr-2 text-xs text-muted">{item.code}</span>{item.title}</Link>
                    : snap ? <span><span className="num mr-2 text-xs text-muted">{snap.code}</span>{snap.title} <span className="text-xs text-muted">({t("apagada")})</span></span>
                    : <span className="text-muted">#{r.entityId}</span>}
                </td>
                <td>
                  <div>{d.what}</div>
                  {d.details.length ? <ul className="mt-0.5 space-y-0.5 text-xs text-muted">{d.details.map((x, i) => <li key={i}>{x}</li>)}</ul> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length >= limit ? <p className="mt-3 text-xs text-muted">{t("Mostram-se os últimos {n} registos.", { n: limit })}</p> : null}
    </section>
  );
}
