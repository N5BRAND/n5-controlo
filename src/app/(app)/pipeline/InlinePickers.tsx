"use client";
import { fmtDate, LABELS } from "@/lib/format";
import { deadlineStatus, PRIORITY_ORDER, type Priority } from "@/lib/metrics";
import { useT } from "@/lib/i18n/client";
import { Popover } from "./Popover";
import { CHIP, CHIP_TONE, dueLabel, PriorityChip } from "./taskUi";

/** Vencimento do cartão: clica para escolher outra data ou tirar a data. */
export function DuePicker({ due, phase, onPick }: { due: string | null; phase: string; onPick: (due: string | null) => void }) {
  const t = useT();
  const st = deadlineStatus(due, phase);
  const tone = !due || st === "concluido" || st === "ok" || st === "sem_prazo" ? "muted" : st === "a_chegar" ? "warn" : "bad";
  const text = !due ? t("Data") : st === "concluido" ? fmtDate(due) : dueLabel(due, t);
  return (
    <Popover label={t("Alterar o vencimento")} title={due ? t("Vencimento {date} (clica para alterar)", { date: fmtDate(due) }) : t("Sem vencimento (clica para definir)")} panelClass="w-56 p-2"
      trigger={
        <span className={`${CHIP} ${CHIP_TONE[tone]} ${due ? "" : "border-dashed"}`}>
          <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="1.5" /><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" strokeLinecap="round" /></svg>
          {text}
        </span>
      }>
      {(close) => (
        <div className="space-y-2">
          <label className="label" htmlFor="pick-due">{t("Data de vencimento")}</label>
          <input id="pick-due" type="date" autoFocus defaultValue={due ?? ""} className="input"
            onKeyDown={(e) => { if (e.key === "Enter") { const v = e.currentTarget.value; if (v) { if (v !== due) onPick(v); close(); } } }} />
          <button type="button" className="btn btn-primary w-full justify-center"
            onClick={() => { const v = (document.getElementById("pick-due") as HTMLInputElement | null)?.value; if (v && v !== due) onPick(v); close(); }}>{t("Guardar")}</button>
          {due ?<button type="button" className="w-full rounded px-2 py-1.5 text-left text-sm text-muted hover:bg-canvas" onClick={() => { onPick(null); close(); }}>{t("Tirar a data")}</button> : null}
        </div>
      )}
    </Popover>
  );
}

/** Prioridade do cartão: clica para escolher outra. */
export function PriorityPicker({ priority, onPick }: { priority: Priority; onPick: (p: Priority) => void }) {
  const t = useT();
  return (
    <Popover label={t("Alterar a prioridade")} title={t("Clica para alterar a prioridade")} panelClass="w-44" trigger={<PriorityChip priority={priority} t={t} />}>
      {(close) => (
        <ul role="listbox" aria-label={t("Prioridade")}>
          {PRIORITY_ORDER.map((p) => (
            <li key={p}>
              <button type="button" role="option" aria-selected={p === priority} onClick={() => { if (p !== priority) onPick(p); close(); }}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-canvas ${p === priority ? "font-semibold" : ""}`}>
                <PriorityChip priority={p} t={t} />
                <span className="sr-only">{t(LABELS.priority[p])}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Popover>
  );
}
