"use client";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { makeT, type Lang, type TFn } from "./index";

const Ctx = createContext<Lang>("pt");

/** Dá o idioma aos componentes de cliente. Fica no layout de raiz. */
export function I18nProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  return <Ctx.Provider value={lang}>{children}</Ctx.Provider>;
}

export const useLang = (): Lang => useContext(Ctx);

/** Tradução para componentes de cliente: `const t = useT();` */
export function useT(): TFn {
  const lang = useContext(Ctx);
  return useMemo(() => makeT(lang), [lang]);
}
