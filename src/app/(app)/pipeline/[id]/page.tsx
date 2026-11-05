import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { allowedSoftware, requireUser } from "@/lib/auth";
import { riceScore } from "@/lib/metrics";
import { fmtDate, fmtDateTime, LABELS } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { addComment, updateItem } from "../actions";
import { ItemForm } from "./ItemForm";
import { CommentForm } from "./CommentForm";
import { Avatar } from "../taskUi";
import { getT } from "@/lib/i18n/server";
import { History } from "../History";
import { DeleteItemButton } from "../DeleteItemButton";

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getT();
  const user = await requireUser("pipeline");
  const id = Number((await params).id);
  const [item] = await db.select().from(schema.roadmapItems).where(eq(schema.roadmapItems.id, id));
  if (!item || !allowedSoftware(user, item.softwareId)) notFound();
  const team = await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(eq(schema.users.active, true));
  const comments = await db.select({ c: schema.roadmapComments, author: schema.users.name })
    .from(schema.roadmapComments).leftJoin(schema.users, eq(schema.users.id, schema.roadmapComments.userId))
    .where(eq(schema.roadmapComments.itemId, id)).orderBy(schema.roadmapComments.createdAt);
  const action = updateItem.bind(null, id);
  return (
    <>
      <p className="mb-2"><Link className="text-sm text-muted hover:underline" href="/pipeline">← {t("Pipeline")}</Link></p>
      <PageHeader title={`${item.code} · ${item.title}`} lead={t("{phase} · prioridade {priority} · pontuação {score} · criado {date}", { phase: LABELS.phase[item.phase], priority: t(LABELS.priority[item.priority]).toLowerCase(), score: riceScore(item.reach, item.impact, item.confidence, item.effort), date: fmtDate(item.createdAt) })} />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(340px,440px)]">
        <div className="min-w-0 space-y-4">
          <ItemForm item={item} team={team} phases={Object.entries(LABELS.phase)} priorities={Object.entries(LABELS.priority)} action={action} />
          <DeleteItemButton id={id} />
        </div>
        <div className="min-w-0 space-y-4 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto">
          <section className="card" aria-labelledby="comentarios">
            <h2 id="comentarios" className="h2">{t("Comentários")} ({comments.length})</h2>
            {comments.length === 0 ? <p className="text-muted text-sm mb-3">{t("Ainda sem comentários.")}</p> : (
              <ul className="space-y-3 mb-4">
                {comments.map(({ c, author }) => (
                  <li key={c.id} className="flex gap-3">
                    <Avatar name={author} t={t} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm"><span className="font-medium">{author ?? t("Utilizador removido")}</span> <span className="text-xs text-muted">{fmtDateTime(c.createdAt)}</span></div>
                      <p className="whitespace-pre-wrap break-words text-sm">{c.body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <CommentForm action={addComment.bind(null, id)} />
          </section>
          <section className="card" aria-labelledby="historico">
            <h2 id="historico" className="h2">{t("Histórico")}</h2>
            <History itemId={id} limit={100} />
          </section>
        </div>
      </div>
    </>
  );
}
