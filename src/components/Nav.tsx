"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { KEEP_PARAMS } from "@/lib/filters";

export function Nav({ items }: { items: { href: string; label: string; badge?: number }[] }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const keep = new URLSearchParams();
  for (const k of KEEP_PARAMS) { const v = params.get(k); if (v) keep.set(k, v); }
  return (
    <ul className="space-y-0.5">
      {items.map((i) => {
        const [path, query = ""] = i.href.split("?");
        const want = new URLSearchParams(query).get("vista");
        const onSide = pathname.startsWith("/pipeline") && ["notificacoes", "historico"].includes(params.get("vista") ?? "");
        const active = path === "/" ? pathname === "/" : want ? pathname.startsWith(path) && params.get("vista") === want : path === "/pipeline" ? pathname.startsWith(path) && !onSide : pathname.startsWith(path);
        const merged = new URLSearchParams(query); keep.forEach((v, k) => merged.set(k, v));
        const href = `${path}${merged.toString() ? `?${merged.toString()}` : ""}`;
        return (
          <li key={i.href}>
            <Link href={href} aria-current={active ? "page" : undefined}
              className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${active ? "bg-white/10 text-cream font-semibold shadow-[inset_3px_0_0_theme(colors.gold.DEFAULT)]" : "text-cream/75 hover:bg-white/5 hover:text-cream"}`}>
              {i.label}
              {i.badge ? <span className="num text-xs rounded-full bg-bad text-white px-1.5">{i.badge}</span> : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
