"use client";
import Link from "next/link";
import { LABELS } from "@/lib/format";
import { compareTasks } from "@/lib/metrics";
import { DuePicker, PriorityPicker } from "./InlinePickers";
import { OwnerPicker } from "./OwnerPicker";
import { CommentCount, type Phase, type TaskRow } from "./taskUi";
import { useTaskEdits } from "./useTaskEdits";
import { useT } from "@/lib/i18n/client";

const PHASES = Object.keys(LABELS.phase) as Phase[];

/** Lista agrupada por estágio, como no ClickUp. Responsável, vencimento e prioridade mudam-se na própria linha. */
export function ListView({ tasks, team }: { tasks: TaskRow[]; team: { id: string; name: string }[] }) {
  const tr = useT();
  const { items, error, editOwner, editDue, editPriority } = useTaskEdits(tasks, team);
  return (
    <div className="space-y-3">
      {error ? <p role="alert" className="rounded-md border border-bad/40 bg-bad/5 px-3 py-2 text-sm text-bad">{error}</p> : null}
      {PHASES.map((p) => {
        const rows = items.filter((t) => t.phase === p).sort(compareTasks);
        return (
          <details key={p} open={rows.length > 0 && p !== "done" && p !== "canceled"} className="card p-0">
            <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-semibold">
              {LABELS.phase[p]} <span className="num text-xs font-normal text-muted">{rows.length}</span>
            </summary>
            <div className="overflow-x-auto border-t border-line">
              <table className="tbl">
                <thead><tr><th>{tr("Tarefa")}</th><th>{tr("Responsável")}</th><th>{tr("Vencimento")}</th><th>{tr("Prioridade")}</th><th className="hidden md:table-cell">{tr("Software")}</th><th className="hidden text-right md:table-cell">{tr("Comentários")}</th></tr></thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.id}>
                      <td className="max-w-md">
                        <Link href={`/pipeline/${t.id}`} className="font-medium hover:underline"><span className="num mr-2 text-xs text-muted">{t.code}</span>{t.title}</Link>
                        {t.description ? <div className="truncate text-xs text-muted">{t.description}</div> : null}
                      </td>
                      <td>
                        <span className="inline-flex items-center gap-2">
                          <OwnerPicker owner={t.owner} team={team} onPick={(u) => editOwner(t.id, u)} />
                          {t.owner ?? <span className="text-muted">{tr("Sem responsável")}</span>}
                        </span>
                      </td>
                      <td><DuePicker due={t.dueDate} phase={t.phase} onPick={(d) => editDue(t.id, d)} /></td>
                      <td><PriorityPicker priority={t.priority} onPick={(pr) => editPriority(t.id, pr)} /></td>
                      <td className="hidden md:table-cell">{t.software}</td>
                      <td className="hidden text-right md:table-cell"><CommentCount n={t.comments} t={tr} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        );
      })}
    </div>
  );
}
