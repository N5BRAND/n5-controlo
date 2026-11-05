"use client";
import Link from "next/link";
import { useState } from "react";
import { LABELS } from "@/lib/format";
import { moveItem } from "./actions";
import { useTaskEdits } from "./useTaskEdits";
import { useT } from "@/lib/i18n/client";
import { OwnerPicker } from "./OwnerPicker";
import { DuePicker, PriorityPicker } from "./InlinePickers";
import { CommentCount, type Phase, type TaskRow } from "./taskUi";

const PHASES = Object.keys(LABELS.phase) as Phase[];

/** Cor de cada estágio, por grupo: base, BETA, STAGING, PROD e fechados. */
function phaseColor(p: Phase): string {
  if (p === "sprint_backlog") return "#6b7280";
  if (p === "in_progress") return "#2563eb";
  if (p === "paused") return "#b45309";
  if (p.endsWith("_beta")) return "#7c3aed";
  if (p.endsWith("_staging")) return "#0d9488";
  if (p.endsWith("_prod")) return "#be185d";
  if (p === "done") return "#16a34a";
  return "#b0281f";
}

/** Quadro Kanban: uma coluna por fase. Arrastar um cartão muda a fase, com as regras do Pipeline. */
export function Board({ tasks, team }: { tasks: TaskRow[]; team: { id: string; name: string }[] }) {
  const tr = useT();
  const { items, setItems, error, setError, startTransition, editOwner, editDue, editPriority } = useTaskEdits(tasks, team);
  const [dragId, setDragId] = useState<number | null>(null);
  const [over, setOver] = useState<Phase | null>(null);

  function move(id: number, to: Phase) {
    const task = items.find((t) => t.id === id);
    if (!task || task.phase === to) return;
    setError(null);
    setItems((cur) => cur.map((t) => (t.id === id ? { ...t, phase: to } : t)));
    startTransition(async () => {
      const res = await moveItem(id, to);
      if (res.error) {
        setItems((cur) => cur.map((t) => (t.id === id ? { ...t, phase: task.phase } : t)));
        setError(`${task.code}: ${res.error}`);
      }
    });
  }

  return (
    <div className="board-wide">
      {error ? <p role="alert" className="mb-3 rounded-md border border-bad/40 bg-bad/5 px-3 py-2 text-sm text-bad">{error}</p> : null}
      <div className="-mx-4 snap-x snap-mandatory overflow-x-auto px-4 pb-4 sm:snap-none md:-mx-8 md:px-8">
        <div className="grid w-max grid-flow-col auto-cols-[min(82vw,300px)] gap-3 sm:gap-4">
          {PHASES.map((p) => {
            const col = items.filter((t) => t.phase === p);
            return (
              <section
                key={p} aria-label={LABELS.phase[p]}
                onDragOver={(e) => { if (dragId !== null) { e.preventDefault(); setOver(p); } }}
                onDragLeave={() => setOver((cur) => (cur === p ? null : cur))}
                onDrop={(e) => { e.preventDefault(); setOver(null); if (dragId !== null) move(dragId, p); setDragId(null); }}
                style={{ borderTopColor: phaseColor(p) }}
                className={`flex h-[calc(100dvh-17.5rem)] min-h-[22rem] snap-start flex-col rounded-xl border border-t-4 p-2.5 transition-colors ${over === p ? "border-accent bg-accent-soft" : "border-line bg-white/60"}`}
              >
                <h2 className="mb-3 flex items-center gap-2 px-0.5">
                  <span className="inline-flex max-w-full items-center gap-1.5 truncate rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-wide" style={{ color: phaseColor(p), backgroundColor: `${phaseColor(p)}1a` }}>
                    <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: phaseColor(p) }} />{LABELS.phase[p]}
                  </span>
                  <span className="num text-xs font-normal text-muted">{col.length}</span>
                </h2>
                <ul className="-mr-1 flex-1 space-y-2.5 overflow-y-auto pr-1">
                  {col.map((t) => (
                    <li
                      key={t.id} draggable
                      onDragStart={(e) => { setDragId(t.id); e.dataTransfer.effectAllowed = "move"; }}
                      onDragEnd={() => { setDragId(null); setOver(null); }}
                      className={`group relative cursor-grab rounded-xl border border-line bg-white p-3 shadow-[0_1px_2px_rgba(16,24,20,0.06)] transition-shadow hover:shadow-md active:cursor-grabbing ${dragId === t.id ? "opacity-40" : ""}`}
                    >
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="num text-[11px] tracking-wide text-muted">{t.code}</span>
                        {t.description ? <svg viewBox="0 0 16 16" className="size-3.5 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-label={tr("Tem descrição")}><title>{t.description}</title><path d="M3 5h10M3 8h10M3 11h6" /></svg> : null}
                      </div>
                      <Link href={`/pipeline/${t.id}`} draggable={false} title={t.title} className="line-clamp-2 text-sm font-semibold leading-snug hover:underline">{t.title}</Link>
                      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-line/70 pt-2">
                        <OwnerPicker owner={t.owner} team={team} onPick={(u) => editOwner(t.id, u)} />
                        <DuePicker due={t.dueDate} phase={t.phase} onPick={(d) => editDue(t.id, d)} />
                        <PriorityPicker priority={t.priority} onPick={(p) => editPriority(t.id, p)} />
                        <span className="ml-auto"><CommentCount n={t.comments} t={tr} /></span>
                      </div>
                    </li>
                  ))}
                  {col.length === 0 ? <li className="rounded-xl border border-dashed border-line px-3 py-5 text-center text-xs text-muted">{tr("Sem tarefas")}</li> : null}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
