"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { KEEP_PARAMS } from "@/lib/filters";

export function Nav({ items }: { items: { href: string; label: string; badge?: number }[] }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const keep = new URLSearchParams();
  for (const k of KEEP_PARAMS) { const v = params.get(k); if (v) keep.set(k, v); }
  const qs = keep.toString() ? `?${keep.toString()}` : "";
  return (
    <ul className="space-y-0.5">
      {items.map((i) => {
        const active = i.href === "/" ? pathname === "/" : pathname.startsWith(i.href);
        return (
          <li key={i.href}>
            <Link href={`${i.href}${qs}`} aria-current={active ? "page" : undefined}
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
