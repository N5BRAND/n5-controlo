import "server-only";
import { unstable_cache } from "next/cache";
import { buildSiteQueries, type SiteQuery } from "@/lib/siteQueries";

// Leitura do PostHog (o que acontece dentro do site) pela API de consultas HogQL.
// POSTHOG_PERSONAL_API_KEY: chave pessoal só com «Query: Read». POSTHOG_PROJECT_ID (predefinido 304103, «Default project»)
// e POSTHOG_HOST (predefinido https://eu.posthog.com). As respostas guardam-se 5 minutos: cada consulta demora
// quase um segundo, e os números do site não precisam de ser ao segundo.

const key = () => process.env.POSTHOG_PERSONAL_API_KEY || (process.env.POSTHOG_API_KEY?.startsWith("phx_") ? process.env.POSTHOG_API_KEY : "");
export const posthogConfigured = () => !!key();
/** Na Netlify só está a chave do projeto (phc_…, a do site): serve para enviar eventos, não para ler números. */
export const posthogProjectKeyOnly = () => !key() && !!process.env.POSTHOG_API_KEY?.startsWith("phc_");

type Row = Record<string, string | number | null>;

async function hogql(query: string): Promise<Row[]> {
  const host = (process.env.POSTHOG_HOST || "https://eu.posthog.com").replace(/\/+$/, "");
  const project = process.env.POSTHOG_PROJECT_ID || "304103";
  const res = await fetch(`${host}/api/projects/${project}/query/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key()}` },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { results?: unknown[][]; columns?: string[]; detail?: string; error?: string };
  if (!res.ok) throw new Error(`PostHog ${res.status}: ${json.detail ?? json.error ?? "erro"}`);
  const cols = json.columns ?? [];
  return (json.results ?? []).map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i] as string | number | null])));
}

const cachedQuery = unstable_cache(hogql, ["posthog-hogql"], { revalidate: 300 });

export type SiteData = Record<SiteQuery, Row[]>;

/** Todas as consultas do site em paralelo. Uma que falhe vem vazia, com o erro em `errors`. */
export async function siteAnalytics(host: string, since: string): Promise<{ data: SiteData; errors: string[] } | null> {
  if (!posthogConfigured()) return null;
  const queries = buildSiteQueries(host, since);
  const errors: string[] = [];
  const entries = await Promise.all(Object.entries(queries).map(async ([name, q]) => {
    try { return [name, await cachedQuery(q)] as const; } catch (err) { errors.push(`${name}: ${err instanceof Error ? err.message : err}`); return [name, [] as Row[]] as const; }
  }));
  return { data: Object.fromEntries(entries) as SiteData, errors };
}
