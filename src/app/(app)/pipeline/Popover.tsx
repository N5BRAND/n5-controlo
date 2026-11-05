"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Botão que abre um painel junto dele. O painel é desenhado fora do cartão (portal) para não ser cortado nem mexer com ele. */
export function Popover({ label, title, buttonClass = "", panelClass = "w-56", trigger, children }: {
  label: string; title?: string; buttonClass?: string; panelClass?: string; trigger: ReactNode; children: (close: () => void) => ReactNode;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const close = () => setPos(null);

  useEffect(() => {
    if (!pos) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setPos(null); btn.current?.focus(); } };
    const shut = () => setPos(null);
    window.addEventListener("scroll", shut, true);
    window.addEventListener("resize", shut);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("scroll", shut, true); window.removeEventListener("resize", shut); window.removeEventListener("keydown", onKey); };
  }, [pos]);

  function toggle() {
    if (pos) return setPos(null);
    const r = btn.current!.getBoundingClientRect();
    const x = Math.max(8, Math.min(r.left, window.innerWidth - 240));
    setPos({ x, y: r.bottom + 4 });
  }

  return (
    <>
      <button ref={btn} type="button" onClick={toggle} aria-haspopup="dialog" aria-expanded={!!pos} aria-label={label} title={title}
        className={`rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${buttonClass}`}>
        {trigger}
      </button>
      {pos ? createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={close} aria-hidden="true" />
          <div role="dialog" aria-label={label} style={{ left: pos.x, top: pos.y }}
            className={`fixed z-50 rounded-lg border border-line bg-white p-1 shadow-lg ${panelClass}`}>
            {children(close)}
          </div>
        </>,
        document.body,
      ) : null}
    </>
  );
}
