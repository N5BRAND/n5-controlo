import Link from "next/link";
import { fmtPct } from "@/lib/format";
import { KEEP_PARAMS } from "@/lib/filters";

export function Kpi({ label, value, note, tone }: { label: string; value: React.ReactNode; note?: React.ReactNode; tone?: "good" | "warn" | "bad" }) {
  const color = tone === "good" ? "text-good" : tone === "warn" ? "text-warn" : tone === "bad" ? "text-bad" : "text-data";
  return (
    <div className="card min-w-0">
      <div className="rotulo">{label}</div>
      <div className={`num font-display text-2xl sm:text-[28px] font-extrabold leading-tight tracking-[-0.03em] mt-1.5 ${color}`}>{value}</div>
      {note ? <div className="text-xs text-muted mt-1">{note}</div> : null}
    </div>
  );
}

export function Delta({ value, invert = false, neutral = false }: { value: number | null; invert?: boolean; neutral?: boolean }) {
  if (value === null) return <span className="text-muted">sem comparação</span>;
  const good = invert ? value < 0 : value > 0;
  const tone = value === 0 || neutral ? "text-muted" : good ? "text-good" : "text-bad";
  return <span className={tone}>{value > 0 ? "+" : ""}{fmtPct(value)} vs período anterior</span>;
}

const PILL_TONES: Record<string, string> = {
  critico: "text-bad border-bad/40 bg-bad/5", aviso: "text-warn border-warn/40 bg-warn/5", informacao: "text-muted border-line",
  verde: "text-good border-good/40 bg-good/5", amarelo: "text-warn border-warn/40 bg-warn/5", vermelho: "text-bad border-bad/40 bg-bad/5",
  neutro: "text-muted border-line", accent: "text-accent border-accent/40 bg-accent-soft",
};

export function Pill({ tone = "neutro", children }: { tone?: string; children: React.ReactNode }) {
  return <span className={`pill ${PILL_TONES[tone] ?? PILL_TONES.neutro}`}>{children}</span>;
}

export function Tabs({ items, active }: { items: { key: string; label: string; href: string }[]; active: string }) {
  return (
    <nav className="flex flex-wrap gap-1 mb-4" aria-label="Vistas">
      {items.map((t) => (
        <Link key={t.key} href={t.href} className={`tab ${t.key === active ? "tab-active" : ""}`} aria-current={t.key === active ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="card text-center py-10">
      <div className="font-display font-extrabold tracking-[-0.01em]">{title}</div>
      {children ? <div className="text-muted mt-1 max-w-prose mx-auto">{children}</div> : null}
    </div>
  );
}

export function Bar({ value, max, tone = "accent" }: { value: number; max: number; tone?: "accent" | "warn" | "bad" }) {
  const color = tone === "warn" ? "bg-warn" : tone === "bad" ? "bg-bad" : "bg-data";
  const w = max > 0 ? Math.max(1, (value / max) * 100) : 0;
  return <div className="h-2.5 rounded bg-canvas border border-line overflow-hidden"><div className={`h-full ${color}`} style={{ width: `${w}%` }} /></div>;
}

export function PageHeader({ title, lead, children }: { title: string; lead?: string; children?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 mb-5">
      <div>
        <h1 className="h1">{title}</h1>
        {lead ? <p className="text-muted mt-1 max-w-3xl">{lead}</p> : null}
      </div>
      {children}
    </header>
  );
}

/** Mantém software e período ao construir links entre vistas. */
export function withParams(path: string, sp: Record<string, string | string[] | undefined>, extra: Record<string, string> = {}) {
  const p = new URLSearchParams();
  for (const k of KEEP_PARAMS) { const v = sp[k]; if (typeof v === "string") p.set(k, v); }
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  const s = p.toString();
  return s ? `${path}?${s}` : path;
}
