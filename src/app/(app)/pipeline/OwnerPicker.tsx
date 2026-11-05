"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n/client";
import { Avatar } from "./taskUi";

/** Avatar do responsável que, ao clicar, abre a lista da equipa para trocar. */
export function OwnerPicker({ owner, team, onPick }: {
  owner: string | null; team: { id: string; name: string }[]; onPick: (userId: string | null) => void;
}) {
  const tr = useT();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { close(); btn.current?.focus(); } };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); window.removeEventListener("keydown", onKey); };
  }, [pos]);

  function toggle() {
    if (pos) return setPos(null);
    const r = btn.current!.getBoundingClientRect();
    setPos({ x: r.left, y: r.bottom + 4 });
  }

  return (
    <>
      <button ref={btn} type="button" onClick={toggle} aria-haspopup="listbox" aria-expanded={!!pos}
        title={owner ? tr("Responsável: {name} (clica para trocar)", { name: owner }) : tr("Sem responsável (clica para atribuir)")}
        className="rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
        <Avatar name={owner} t={tr} />
        <span className="sr-only">{tr("Trocar responsável")}</span>
      </button>
      {pos ? createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setPos(null)} aria-hidden="true" />
          <ul role="listbox" aria-label={tr("Responsável")} style={{ left: pos.x, top: pos.y }}
            className="fixed z-50 max-h-64 w-56 overflow-y-auto rounded-lg border border-line bg-white p-1 shadow-lg">
            <li><button type="button" role="option" aria-selected={!owner} onClick={() => { setPos(null); onPick(null); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-muted hover:bg-canvas">{tr("Sem responsável")}</button></li>
            {team.map((t) => (
              <li key={t.id}>
                <button type="button" role="option" aria-selected={t.name === owner} onClick={() => { setPos(null); onPick(t.id); }}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-canvas ${t.name === owner ? "font-semibold" : ""}`}>
                  <Avatar name={t.name} t={tr} />{t.name}
                </button>
              </li>
            ))}
          </ul>
        </>,
        document.body,
      ) : null}
    </>
  );
}
