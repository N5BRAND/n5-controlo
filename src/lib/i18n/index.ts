// Idiomas da interface. O texto original (a chave) está em português de Portugal; o inglês vem dos dicionários em ./en.
// Sem tradução, mostra-se o português. Funciona no servidor e no cliente (não tem dependências de Next).
import { shell } from "./en/shell";
import { pipeline } from "./en/pipeline";
import { comunidades } from "./en/comunidades";
import { chat } from "./en/chat";
import { campanhas } from "./en/campanhas";
import { receita } from "./en/receita";
import { painel } from "./en/painel";
import { reativacao } from "./en/reativacao";
import { impacto } from "./en/impacto";
import { alertas } from "./en/alertas";
import { definicoes } from "./en/definicoes";

export type Lang = "pt" | "en";
export const LANGS: readonly Lang[] = ["pt", "en"];
export const LANG_COOKIE = "n5_lang";
export const DEFAULT_LANG: Lang = "pt";

export const normalizeLang = (v: string | null | undefined): Lang => (v === "en" ? "en" : DEFAULT_LANG);

// Cada módulo tem o seu ficheiro em ./en e entra aqui.
const EN: Record<string, string> = { ...shell, ...pipeline, ...comunidades, ...chat, ...campanhas, ...receita, ...painel, ...reativacao, ...impacto, ...alertas, ...definicoes };

export type TFn = (text: string, vars?: Record<string, string | number>) => string;

/** Devolve a função de tradução. Os marcadores {nome} do texto são substituídos pelos valores de `vars`. */
export function makeT(lang: Lang): TFn {
  return (text, vars) => {
    const s = lang === "en" ? EN[text] ?? text : text;
    return vars ? s.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`)) : s;
  };
}

/** Quantos textos têm versão inglesa (para os testes e para saber o que falta). */
export const EN_KEYS: readonly string[] = Object.keys(EN);
