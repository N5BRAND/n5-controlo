import { compareTasks, PRIORITY_ORDER } from "@/lib/metrics";
import { Board } from "./Board";
import type { TaskRow } from "./taskUi";

type SP = Record<string, string | string[] | undefined>;

/** Aplica os filtros de responsável (`resp`: id, "meus" ou "sem") e de prioridade (`prio`) do URL. */
export function filterTasks(tasks: TaskRow[], sp: SP, userId: string): TaskRow[] {
  const resp = typeof sp.resp === "string" ? sp.resp : "";
  const prio = typeof sp.prio === "string" ? sp.prio : "";
  return tasks.filter((t) => {
    if (resp === "meus" && t.ownerUserId !== userId) return false;
    if (resp === "sem" && t.ownerUserId) return false;
    if (resp && resp !== "meus" && resp !== "sem" && t.ownerUserId !== resp) return false;
    if (prio && (PRIORITY_ORDER as readonly string[]).includes(prio) && t.priority !== prio) return false;
    return true;
  });
}

export function KanbanView({ tasks, team }: { tasks: TaskRow[]; team: { id: string; name: string }[] }) {
  return <Board tasks={[...tasks].sort(compareTasks)} team={team} />;
}

export { ListView } from "./ListView";
