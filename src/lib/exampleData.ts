// Dados de exemplo do seed (src/db/seed.ts): como os reconhecer para os apagar sem tocar no que é real.
// Só regras fixas, que dependem das marcas que o seed deixa: ids com «_ex», emails @exemplo.n5, organizações
// com is_example, e os poucos registos de exemplo sem marca (roadmap, PRs, versões, custos, campanhas, modelos),
// reconhecidos pelo valor exato que o seed escreve. Ficam de fora os softwares e os pressupostos do Impacto.

export interface ExampleRule {
  table: string;
  label: string;
  where: string;
}

const EX = (col: string, prefix: string) => `${col} like '${prefix}\\_ex%'`;

/** Custos por fornecedor que o seed cria (3 meses, valores fixos): software, fornecedor e valor em cêntimos. */
export function seedProviderCosts(): [string, string, number][] {
  const base: [string, number][] = [["sw_clara", 1], ["sw_imobiliario", 0.4]];
  const providers: [string, number][] = [["aws", 32000], ["twilio", 41000], ["deepgram", 4400], ["bedrock", 2800], ["meta_whatsapp", 9000]];
  const out: [string, string, number][] = [];
  for (const [sw, b] of base) for (const back of [2, 1, 0]) for (const [p, v] of providers) out.push([sw, p, Math.round(v * b * (1 + (2 - back) * 0.12))]);
  return out;
}

const SEED_ROADMAP: [string, string, string][] = [
  ["sw_clara", "CLA-1", "Marcar visitas por voz"],
  ["sw_clara", "CLA-2", "Resumo da chamada na ficha da lead"],
  ["sw_clara", "CLA-3", "Vocabulário de moradas para a transcrição"],
  ["sw_clara", "CLA-4", "Relatório semanal por WhatsApp"],
  ["sw_imobiliario", "IMO-1", "Distribuição de leads por zona"],
];
const SEED_CAMPAIGNS = ["csv:clara_trial_consultores_2026-09", "csv:clara_trial_lookalike_2026-10", "csv:imo_demo_brokers_2026-10"];
const SEED_PRS = ["4ImprovementsPortugal/n5-clara#41", "4ImprovementsPortugal/n5-clara#44"];
const SEED_RELEASES: [string, string][] = [
  ["0.8.0", "• Agente responde a leads fora de horas\n• Ficha da lead com histórico do WhatsApp"],
  ["0.9.0", "• Marcar visitas por voz\n• Resumo da chamada na ficha da lead"],
];
export const SEED_USERS = ["socio@exemplo.n5", "colaborador@exemplo.n5"];

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const list = (xs: string[]) => xs.map(q).join(", ");
const ORG = "organization_id like 'org\\_ex%'";
const seedTemplates = "select id from message_templates where cta_url like 'https://exemplo.n5/%'";
const seedRoadmap = `select id from roadmap_items where (software_id, code, title) in (${SEED_ROADMAP.map(([s, c, t]) => `(${q(s)}, ${q(c)}, ${q(t)})`).join(", ")})`;

/** Por ordem de apagar (primeiro o que depende de outras tabelas). */
export const EXAMPLE_RULES: ExampleRule[] = [
  { table: "chat_messages", label: "Mensagens do chat", where: EX("id", "cm") },
  { table: "chat_summaries", label: "Resumos do chat", where: "not exists (select 1 from chat_messages m where m.channel = chat_summaries.channel and m.created_at between chat_summaries.period_start and chat_summaries.period_end and m.id not like 'cm\\_ex%')" },
  // Alertas do seed e os que as regras calcularam sobre os dados de exemplo (MRR a cair, PR de exemplo por rever)
  { table: "alerts", label: "Alertas", where: `dedupe_key ~ '(^ex-[0-9]+$|_ex[0-9])' or dedupe_key like 'mrr-cair:%' or dedupe_key in (${SEED_PRS.map((p) => q(`pr-agente:${p}`)).join(", ")})` },
  { table: "outbound_messages", label: "Comunicações enviadas", where: `${EX("id", "msg")} or person_id like 'per\\_ex%'` },
  { table: "engagement_rules", label: "Regras de reativação", where: `template_id in (${seedTemplates})` },
  { table: "message_templates", label: "Modelos de comunicação", where: "cta_url like 'https://exemplo.n5/%'" },
  { table: "product_events", label: "Eventos de produto", where: `${EX("id", "evt")} or ${EX("id", "evtimp")} or ${ORG} or person_id like 'per\\_ex%'` },
  { table: "usage_records", label: "Consumo", where: `${EX("id", "use")} or ${ORG}` },
  { table: "account_profiles", label: "Perfis das contas", where: ORG },
  { table: "invoices", label: "Faturas", where: `${EX("id", "in")} or ${ORG}` },
  { table: "mrr_monthly", label: "MRR mensal", where: ORG },
  { table: "subscriptions", label: "Subscrições", where: `${EX("id", "sub")} or ${ORG}` },
  { table: "persons", label: "Pessoas", where: `${EX("id", "per")} or email like '%@exemplo.n5' or ${ORG}` },
  { table: "organizations", label: "Contas (clientes)", where: `is_example or ${EX("id", "org")}` },
  { table: "feedback", label: "Feedback", where: EX("id", "fb") },
  { table: "pull_requests", label: "Pull requests", where: `id in (${list(SEED_PRS)})` },
  { table: "roadmap_items", label: "Itens do roadmap", where: `id in (${seedRoadmap})` },
  { table: "deployments", label: "Deploys", where: EX("id", "dep") },
  { table: "releases", label: "Versões", where: `software_id = 'sw_clara' and (version, notes) in (${SEED_RELEASES.map(([v, n]) => `(${q(v)}, ${q(n)})`).join(", ")})` },
  { table: "provider_costs", label: "Custos por fornecedor", where: `(software_id, provider, cost_cents) in (${seedProviderCosts().map(([s, p, c]) => `(${q(s)}, ${q(p)}, ${c})`).join(", ")})` },
  { table: "campaign_daily", label: "Campanhas de exemplo", where: `campaign_id in (${list(SEED_CAMPAIGNS)})` },
  { table: "users", label: "Logins de exemplo", where: `email in (${list(SEED_USERS)})` },
];

/** Antes de apagar: o que é real e aponta para um registo de exemplo deixa de apontar. */
export const UNLINK_STATEMENTS: string[] = [
  `update feedback set roadmap_item_id = null where roadmap_item_id in (${seedRoadmap}) and id not like 'fb\\_ex%'`,
  `update pull_requests set roadmap_item_id = null where roadmap_item_id in (${seedRoadmap})`,
  `update outbound_messages set rule_id = null, template_id = null where template_id in (${seedTemplates}) and id not like 'msg\\_ex%'`,
];
