"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { allowedSoftware, requireUser } from "@/lib/auth";
import { createFeedback, setFeedbackStatus } from "@/lib/core";
import { audit } from "@/lib/audit";
import { postSlackMessage } from "@/lib/slack";
import { getT } from "@/lib/i18n/server";

async function guard(id: string) {
  const t = await getT();
  const user = await requireUser("comunidades");
  const [f] = await db.select().from(schema.feedback).where(eq(schema.feedback.id, id));
  if (!f || !allowedSoftware(user, f.softwareId)) throw new Error(t("Sem acesso a este feedback."));
  return { user, f };
}

export async function updateFeedback(id: string, form: FormData) {
  const { user, f } = await guard(id);
  const status = String(form.get("status")) as typeof f.status;
  const owner = String(form.get("owner") ?? "") || null;
  const feature = String(form.get("feature") ?? "").trim() || null;
  const title = String(form.get("title") ?? "").trim() || f.title;
  const itemRaw = String(form.get("roadmapItemId") ?? "");
  const roadmapItemId = itemRaw ? Number(itemRaw) : null;
  await db.update(schema.feedback).set({ ownerUserId: owner, feature, title, updatedAt: new Date() }).where(eq(schema.feedback.id, id));
  if (status !== f.status || roadmapItemId !== f.roadmapItemId) {
    await setFeedbackStatus(id, status === "recebido" && roadmapItemId ? "planeado" : status, `user:${user.sub}`, {
      refusalReason: String(form.get("refusalReason") ?? "") || undefined,
      duplicateOfId: String(form.get("duplicateOfId") ?? "") || undefined,
      roadmapItemId,
    });
  }
  await audit(`user:${user.sub}`, "feedback.updated", "feedback", id);
  revalidatePath(`/comunidades/${id}`);
}

export async function replyInSlack(id: string, form: FormData) {
  const { user, f } = await guard(id);
  const text = String(form.get("reply") ?? "").trim();
  if (!text || !f.slackChannel) return;
  await postSlackMessage(f.slackChannel, text, f.slackTs ?? undefined);
  await db.update(schema.feedback).set({ firstResponseAt: f.firstResponseAt ?? new Date(), updatedAt: new Date() }).where(eq(schema.feedback.id, id));
  await audit(`user:${user.sub}`, "feedback.reply", "feedback", id, null, { text });
  revalidatePath(`/comunidades/${id}`);
}

export async function newFeedback(form: FormData) {
  const user = await requireUser("comunidades");
  const softwareId = String(form.get("softwareId"));
  if (!allowedSoftware(user, softwareId)) throw new Error((await getT())("Sem acesso a este software."));
  const row = await createFeedback({
    softwareId, type: String(form.get("type")) as "sugestao", text: String(form.get("text") ?? ""),
    title: String(form.get("title") ?? ""), feature: String(form.get("feature") ?? "") || null,
    severity: (String(form.get("severity") ?? "") || null) as "medio" | null, authorName: String(form.get("authorName") ?? "") || null,
    origin: (String(form.get("origin") ?? "") || null) as "pagante" | null,
  }, `user:${user.sub}`);
  redirect(`/comunidades/${row.id}`);
}

export async function addBetaMember(form: FormData) {
  const user = await requireUser("comunidades");
  const softwareId = String(form.get("softwareId"));
  if (!allowedSoftware(user, softwareId)) throw new Error((await getT())("Sem acesso a este software."));
  const { newId } = await import("@/lib/core");
  const id = newId("per");
  await db.insert(schema.persons).values({
    id, softwareId, name: String(form.get("name") ?? ""), email: String(form.get("email") ?? "").toLowerCase() || null,
    slackUserId: String(form.get("slackUserId") ?? "") || null, origin: "beta", signedUpAt: new Date(),
  });
  await audit(`user:${user.sub}`, "member.beta_added", "person", id);
  revalidatePath("/comunidades");
}
