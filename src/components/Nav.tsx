"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

export function Nav({ items }: { items: { href: string; label: string; badge?: number }[] }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const keep = new URLSearchParams();
  for (const k of ["sw", "periodo"]) { const v = params.get(k); if (v) keep.set(k, v); }
  return (
    <ul className="space-y-0.5">
      {items.map((i) => {
        const [path, query = ""] = i.href.split("?");
        const want = new URLSearchParams(query).get("vista");
        const onNotif = pathname.startsWith("/pipeline") && ["notificacoes", "historico"].includes(params.get("vista") ?? "");
        const active = path === "/" ? pathname === "/" : want ? pathname.startsWith(path) && params.get("vista") === want : path === "/pipeline" ? pathname.startsWith(path) && !onNotif : pathname.startsWith(path);
        const sep = new URLSearchParams(query); keep.forEach((v, k) => sep.set(k, v));
        const href = `${path}${sep.toString() ? `?${sep.toString()}` : ""}`;
        return (
          <li key={i.href}>
            <Link href={href} aria-current={active ? "page" : undefined}
              className={`flex items-center justify-between rounded-md border-l-[3px] px-3 py-2 text-sm transition-colors ${active ? "border-brand bg-white/10 font-semibold text-white" : "border-transparent text-white/70 hover:bg-white/5 hover:text-white"}`}>
              {i.label}
              {i.badge ? <span className="num rounded-full bg-brand px-1.5 text-xs font-semibold text-ink">{i.badge}</span> : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
