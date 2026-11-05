"use client";
import { useActionState, useEffect, useRef } from "react";
import { useT } from "@/lib/i18n/client";

export function CommentForm({ action }: { action: (prev: { error?: string; ok?: boolean } | undefined, form: FormData) => Promise<{ error?: string; ok?: boolean }> }) {
  const t = useT();
  const [state, formAction, pending] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  return (
    <form ref={ref} action={formAction} className="space-y-2">
      <label className="label" htmlFor="comentario">{t("Novo comentário")}</label>
      <textarea id="comentario" name="body" rows={3} maxLength={4000} required className="input" placeholder={t("Escreve uma atualização ou pergunta para a equipa")} />
      {state?.error ? <p role="alert" className="text-bad text-sm">{state.error}</p> : null}
      <button className="btn btn-primary" disabled={pending}>{pending ? t("A comentar…") : t("Comentar")}</button>
    </form>
  );
}
