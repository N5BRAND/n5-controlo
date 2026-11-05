"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { LANG_COOKIE, normalizeLang } from "./index";

/** Guarda o idioma escolhido num cookie e atualiza as páginas. */
export async function setLang(lang: string): Promise<void> {
  (await cookies()).set(LANG_COOKIE, normalizeLang(lang), { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidatePath("/", "layout");
}
