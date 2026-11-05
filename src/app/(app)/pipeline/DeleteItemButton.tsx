"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useT } from "@/lib/i18n/client";
import { deleteItem } from "./actions";

/** Apagar a tarefa, com confirmação. Fica registado no histórico. */
export function DeleteItemButton({ id }: { id: number }) {
  const t = useT();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function remove() {
    setError(null);
    start(async () => {
      const res = await deleteItem(id);
      if (res.error) setError(res.error);
      else router.push("/pipeline");
    });
  }

  if (!confirming) {
    return <button type="button" className="btn btn-danger" onClick={() => setConfirming(true)}>{t("Apagar tarefa")}</button>;
  }
  return (
    <div role="alertdialog" aria-label={t("Apagar tarefa")} className="flex flex-wrap items-center gap-2 rounded-md border border-bad/40 bg-bad/5 px-3 py-2 text-sm">
      <span className="text-bad">{t("Tem a certeza? A tarefa e os seus comentários são apagados; fica registado no histórico.")}</span>
      <button type="button" className="btn btn-danger" disabled={pending} onClick={remove}>{pending ? t("A apagar…") : t("Sim, apagar")}</button>
      <button type="button" className="btn" disabled={pending} onClick={() => setConfirming(false)}>{t("Cancelar")}</button>
      {error ? <span role="alert" className="w-full text-bad">{error}</span> : null}
    </div>
  );
}
