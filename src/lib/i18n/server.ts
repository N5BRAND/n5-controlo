import "server-only";
import { cookies } from "next/headers";
import { LANG_COOKIE, makeT, normalizeLang, type Lang, type TFn } from "./index";

/** Idioma escolhido por quem está a usar a app (cookie). Por omissão, português. */
export async function getLang(): Promise<Lang> {
  return normalizeLang((await cookies()).get(LANG_COOKIE)?.value);
}

/** Tradução para componentes de servidor: `const t = await getT();` */
export async function getT(): Promise<TFn> {
  return makeT(await getLang());
}
