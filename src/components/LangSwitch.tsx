"use client";
import { useTransition } from "react";
import { setLang } from "@/lib/i18n/actions";
import { useLang } from "@/lib/i18n/client";
import type { Lang } from "@/lib/i18n";

const OPTIONS: { lang: Lang; label: string; name: string }[] = [
  { lang: "pt", label: "PT", name: "Português" },
  { lang: "en", label: "EN", name: "English" },
];

/** Seletor de idioma. `dark` para fundos escuros (barra lateral). */
export function LangSwitch({ dark = false }: { dark?: boolean }) {
  const current = useLang();
  const [pending, start] = useTransition();
  return (
    <div role="group" aria-label="Language / Idioma" className={`inline-flex overflow-hidden rounded-md border text-xs font-semibold ${dark ? "border-white/20" : "border-line"}`}>
      {OPTIONS.map((o) => {
        const active = o.lang === current;
        return (
          <button key={o.lang} type="button" disabled={pending} lang={o.lang} title={o.name} aria-pressed={active}
            onClick={() => { if (!active) start(() => setLang(o.lang)); }}
            className={`px-2.5 py-1 transition-colors ${active ? "bg-brand text-ink" : dark ? "text-white/70 hover:bg-white/10" : "text-muted hover:bg-canvas"}`}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
