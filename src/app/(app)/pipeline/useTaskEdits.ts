"use client";
import { useState, useTransition } from "react";
import type { Priority } from "@/lib/metrics";
import { setDueDate, setOwner, setPriority } from "./actions";
import type { TaskRow } from "./taskUi";

/**
 * Estado das tarefas no ecrã e edição de responsável, data e prioridade, partilhado pelo Quadro e pela Lista.
 * A mudança aparece logo e é desfeita se o servidor a recusar.
 */
export function useTaskEdits(tasks: TaskRow[], team: { id: string; name: string }[]) {
  const [items, setItems] = useState(tasks);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Os dados do servidor mudaram (filtros, tarefa nova): voltar a usá-los
  const [seen, setSeen] = useState(tasks);
  if (seen !== tasks) { setSeen(tasks); setItems(tasks); }

  function patch(id: number, change: Partial<TaskRow>, save: () => Promise<{ error?: string }>) {
    const task = items.find((t) => t.id === id);
    if (!task) return;
    setError(null);
    setItems((cur) => cur.map((t) => (t.id === id ? { ...t, ...change } : t)));
    startTransition(async () => {
      const res = await save();
      if (res.error) {
        const back = Object.fromEntries(Object.keys(change).map((k) => [k, task[k as keyof TaskRow]]));
        setItems((cur) => cur.map((t) => (t.id === id ? { ...t, ...back } : t)));
        setError(`${task.code}: ${res.error}`);
      }
    });
  }

  return {
    items, setItems, error, setError, startTransition,
    editOwner: (id: number, userId: string | null) =>
      patch(id, { ownerUserId: userId, owner: userId ? team.find((m) => m.id === userId)?.name ?? null : null }, () => setOwner(id, userId)),
    editDue: (id: number, due: string | null) => patch(id, { dueDate: due }, () => setDueDate(id, due)),
    editPriority: (id: number, priority: Priority) => patch(id, { priority }, () => setPriority(id, priority)),
  };
}
