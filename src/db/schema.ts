import {
  pgTable, pgEnum, text, integer, boolean, timestamp, jsonb, numeric, date, serial, uuid,
  primaryKey, uniqueIndex, index,
} from "drizzle-orm/pg-core";
import { PHASES, DEFAULT_PHASE } from "../lib/phases";

// ---------- Enums ----------
export const softwareStatus = pgEnum("software_status", ["em_construcao", "beta", "lancado", "pausado"]);
export const teamRole = pgEnum("team_role", ["socio", "direcao_operacoes", "colaborador"]);
export const orgType = pgEnum("org_type", ["agencia", "eni", "particular"]);
export const personOrigin = pgEnum("person_origin", ["pagante", "beta", "trial"]);
export const subscriptionStatus = pgEnum("subscription_status", ["trialing", "active", "past_due", "canceled", "incomplete"]);
export const feedbackType = pgEnum("feedback_type", ["sugestao", "bug", "funciona_bem", "funciona_mal"]);
export const feedbackStatus = pgEnum("feedback_status", [
  "recebido", "em_analise", "planeado", "em_desenvolvimento", "lancado", "recusado", "duplicado",
]);
export const severity = pgEnum("severity", ["critico", "alto", "medio", "baixo"]);
export const roadmapPhase = pgEnum("roadmap_phase", PHASES);
export const roadmapPriority = pgEnum("roadmap_priority", ["urgente", "alta", "normal", "baixa"]);
export const roadmapOrigin = pgEnum("roadmap_origin", ["comunidade", "equipa", "cliente", "incidente"]);
export const alertSeverity = pgEnum("alert_severity", ["critico", "aviso", "informacao"]);
export const alertStatus = pgEnum("alert_status", ["novo", "visto", "resolvido"]);
export const alertModule = pgEnum("alert_module", ["comunidades", "pipeline", "campanhas", "receita", "sistema", "impacto", "chat"]);

// ---------- Equipa (quem usa o sistema de controlo) ----------
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: teamRole("role").notNull().default("colaborador"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Softwares a que um colaborador tem acesso (sócios e direção veem todos)
export const userSoftwares = pgTable("user_softwares", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  softwareId: text("software_id").notNull().references(() => softwares.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.userId, t.softwareId] })]);

// ---------- Softwares ----------
export const softwares = pgTable("softwares", {
  id: text("id").primaryKey(), // sw_clara
  name: text("name").notNull(),
  code: text("code").notNull().unique(), // CLA, usado nos códigos do roadmap
  status: softwareStatus("status").notNull().default("em_construcao"),
  metaAdAccountId: text("meta_ad_account_id"),
  metaPixelId: text("meta_pixel_id"),
  githubRepos: text("github_repos").array().notNull().default([]),
  slackPrefix: text("slack_prefix"),
  activationDefinition: text("activation_definition"),
  keyEvents: text("key_events").array().notNull().default([]),
  cplLimitCents: integer("cpl_limit_cents"),
  costPerAccountLimitCents: integer("cost_per_account_limit_cents"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- Clientes dos softwares ----------
export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(), // org_...
  name: text("name").notNull(),
  type: orgType("type").notNull().default("particular"),
  nif: text("nif"),
  stripeCustomerId: text("stripe_customer_id").unique(),
  platformClientId: text("platform_client_id"), // ligação à plataforma 4Improvements
  isExample: boolean("is_example").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const persons = pgTable("persons", {
  id: text("id").primaryKey(), // per_...
  organizationId: text("organization_id").references(() => organizations.id, { onDelete: "set null" }),
  email: text("email"),
  name: text("name"),
  origin: personOrigin("origin").notNull().default("trial"),
  slackUserId: text("slack_user_id"),
  // Módulo Reativação: última utilização e preferências de comunicação
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  emailOptOut: boolean("email_opt_out").notNull().default(false),
  inappOptOut: boolean("inapp_opt_out").notNull().default(false),
  unsubscribeToken: text("unsubscribe_token").unique(),
  attribution: jsonb("attribution").$type<{
    fbclid?: string; utm_source?: string; utm_medium?: string; utm_campaign?: string;
    utm_content?: string; first_campaign?: string; last_campaign?: string;
  }>(),
  signedUpAt: timestamp("signed_up_at", { withTimezone: true }),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  softwareId: text("software_id").references(() => softwares.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("persons_org_idx").on(t.organizationId), index("persons_last_seen_idx").on(t.lastSeenAt)]);

export const subscriptions = pgTable("subscriptions", {
  id: text("id").primaryKey(), // id da subscrição no Stripe
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  softwareId: text("software_id").notNull().references(() => softwares.id),
  plan: text("plan").notNull(),
  status: subscriptionStatus("status").notNull(),
  mrrCents: integer("mrr_cents").notNull().default(0), // sem IVA, já com descontos
  includedMinutes: integer("included_minutes").notNull().default(0),
  includedLeads: integer("included_leads").notNull().default(0),
  extraLimitCents: integer("extra_limit_cents"), // limite de consumo extra definido pelo cliente
  trialEnd: timestamp("trial_end", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  canceledAt: timestamp("canceled_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("subs_org_idx").on(t.organizationId), index("subs_sw_idx").on(t.softwareId)]);

// MRR por conta e por mês, gravado todos os dias (o mês corrente é atualizado até fechar)
export const mrrMonthly = pgTable("mrr_monthly", {
  organizationId: text("organization_id").notNull(),
  softwareId: text("software_id").notNull(),
  month: text("month").notNull(), // YYYY-MM
  mrrCents: integer("mrr_cents").notNull(),
}, (t) => [primaryKey({ columns: [t.organizationId, t.softwareId, t.month] })]);

export const invoices = pgTable("invoices", {
  id: text("id").primaryKey(), // id da fatura no Stripe
  organizationId: text("organization_id").references(() => organizations.id),
  softwareId: text("software_id").references(() => softwares.id),
  amountCents: integer("amount_cents").notNull(),
  vatCents: integer("vat_cents").notNull().default(0),
  status: text("status").notNull(), // paid, open, failed
  certifiedNumber: text("certified_number"), // número da fatura certificada AT
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
});

// ---------- Núcleo: eventos e consumo ----------
export const productEvents = pgTable("product_events", {
  id: text("id").primaryKey(), // evt_..., enviado por quem gera o evento (idempotência)
  softwareId: text("software_id").notNull().references(() => softwares.id),
  name: text("name").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  personId: text("person_id"),
  organizationId: text("organization_id"),
  sessionId: text("session_id"),
  feature: text("feature"),
  properties: jsonb("properties").$type<Record<string, unknown>>(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("events_sw_time_idx").on(t.softwareId, t.occurredAt),
  index("events_person_idx").on(t.personId, t.occurredAt),
]);

export const usageRecords = pgTable("usage_records", {
  id: text("id").primaryKey(), // use_..., idempotência
  softwareId: text("software_id").notNull().references(() => softwares.id),
  organizationId: text("organization_id").notNull(),
  personId: text("person_id"),
  unit: text("unit").notNull(), // ex.: call.forward.minute
  quantity: numeric("quantity", { precision: 14, scale: 4 }).notNull(),
  costUsd: numeric("cost_usd", { precision: 14, scale: 6 }).notNull(),
  provider: text("provider").notNull(),
  providerRef: text("provider_ref"),
  billable: boolean("billable").notNull().default(true),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("usage_org_time_idx").on(t.organizationId, t.occurredAt), index("usage_sw_time_idx").on(t.softwareId, t.occurredAt)]);

// ---------- Módulo 1: Comunidades ----------
export const feedback = pgTable("feedback", {
  id: text("id").primaryKey(), // fb_...
  softwareId: text("software_id").notNull().references(() => softwares.id),
  type: feedbackType("type").notNull(),
  title: text("title").notNull(),
  text: text("text").notNull(),
  authorName: text("author_name"),
  authorSlackId: text("author_slack_id"),
  authorPersonId: text("author_person_id"),
  origin: personOrigin("origin"),
  feature: text("feature"),
  severity: severity("severity"),
  votes: integer("votes").notNull().default(1),
  status: feedbackStatus("status").notNull().default("recebido"),
  ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  refusalReason: text("refusal_reason"),
  roadmapItemId: integer("roadmap_item_id"),
  duplicateOfId: text("duplicate_of_id"),
  slackChannel: text("slack_channel"),
  slackTs: text("slack_ts"),
  firstResponseAt: timestamp("first_response_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("feedback_sw_status_idx").on(t.softwareId, t.status)]);

// ---------- Módulo 2: Pipeline ----------
export const roadmapItems = pgTable("roadmap_items", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(), // CLA-12
  softwareId: text("software_id").notNull().references(() => softwares.id),
  title: text("title").notNull(),
  description: text("description"),
  origin: roadmapOrigin("origin").notNull().default("equipa"),
  phase: roadmapPhase("phase").notNull().default(DEFAULT_PHASE),
  priority: roadmapPriority("priority").notNull().default("normal"),
  impact: integer("impact").notNull().default(1), // 1 a 3
  reach: integer("reach").notNull().default(0), // contas estimadas
  confidence: integer("confidence").notNull().default(50), // %
  effort: integer("effort").notNull().default(1), // pontos
  ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  agent: boolean("agent").notNull().default(false),
  acceptanceCriteria: text("acceptance_criteria"),
  productEvents: text("product_events").array().notNull().default([]),
  sprint: text("sprint"),
  version: text("version"),
  dueDate: date("due_date"), // prazo para chegar a produção (notificações do Pipeline)
  phaseChangedAt: timestamp("phase_changed_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Comentários da equipa numa tarefa do roadmap. Nada se apaga.
export const roadmapComments = pgTable("roadmap_comments", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id").notNull().references(() => roadmapItems.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("roadmap_comments_item_idx").on(t.itemId, t.createdAt)]);

export const pullRequests = pgTable("pull_requests", {
  id: text("id").primaryKey(), // repo#número
  roadmapItemId: integer("roadmap_item_id"),
  softwareId: text("software_id"),
  repo: text("repo").notNull(),
  number: integer("number").notNull(),
  title: text("title").notNull(),
  author: text("author").notNull(),
  isAgent: boolean("is_agent").notNull().default(false),
  state: text("state").notNull(), // open, closed, merged
  url: text("url"),
  firstCommitAt: timestamp("first_commit_at", { withTimezone: true }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  mergedAt: timestamp("merged_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const deployments = pgTable("deployments", {
  id: text("id").primaryKey(),
  softwareId: text("software_id"),
  repo: text("repo").notNull(),
  environment: text("environment").notNull(), // production, staging
  status: text("status").notNull(), // success, failure, error, pending
  sha: text("sha"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const releases = pgTable("releases", {
  id: serial("id").primaryKey(),
  softwareId: text("software_id").notNull().references(() => softwares.id),
  version: text("version").notNull(),
  notes: text("notes").notNull().default(""),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  slackPostedAt: timestamp("slack_posted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("releases_sw_version").on(t.softwareId, t.version)]);

// Custos mensais por fornecedor (AWS Cost Explorer ou faturas importadas)
export const providerCosts = pgTable("provider_costs", {
  softwareId: text("software_id").notNull(),
  month: text("month").notNull(), // YYYY-MM
  provider: text("provider").notNull(), // aws, twilio, meta_whatsapp, deepgram, bedrock, ses...
  costCents: integer("cost_cents").notNull(),
}, (t) => [primaryKey({ columns: [t.softwareId, t.month, t.provider] })]);

// ---------- Módulo 3: Campanhas ----------
export const campaignDaily = pgTable("campaign_daily", {
  id: serial("id").primaryKey(),
  softwareId: text("software_id").notNull().references(() => softwares.id),
  accountId: text("account_id"),
  campaignId: text("campaign_id").notNull(),
  campaignName: text("campaign_name").notNull(),
  adsetName: text("adset_name").notNull().default(""),
  adName: text("ad_name").notNull().default(""),
  adsetId: text("adset_id"),
  adId: text("ad_id"),
  date: date("date").notNull(),
  spendCents: integer("spend_cents").notNull().default(0),
  impressions: integer("impressions").notNull().default(0),
  clicks: integer("clicks").notNull().default(0),
  leads: integer("leads").notNull().default(0),
  landingViews: integer("landing_views").notNull().default(0),
  purchases: integer("purchases").notNull().default(0),
  checkouts: integer("checkouts").notNull().default(0), // foram ao pagamento (InitiateCheckout do píxel)
  frequency: numeric("frequency", { precision: 6, scale: 2 }),
}, (t) => [uniqueIndex("campaign_daily_uniq").on(t.campaignId, t.adsetName, t.adName, t.date)]);

// Estado e formato de cada anúncio, lidos na sincronização da Meta (o que campaign_daily não tem).
export const metaAds = pgTable("meta_ads", {
  adId: text("ad_id").primaryKey(),
  softwareId: text("software_id").notNull().references(() => softwares.id),
  campaignId: text("campaign_id").notNull(),
  name: text("name").notNull(),
  adsetName: text("adset_name"),
  status: text("status"), // effective_status da Meta: ACTIVE, PAUSED, PENDING_REVIEW, DISAPPROVED, ...
  format: text("format"), // imagem | video
  adRef: text("ad_ref"), // utm_content da ligação do anúncio, normalizado (adRef); junta as compras da Stripe ao anúncio
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("meta_ads_campaign_idx").on(t.campaignId)]);

// Compras confirmadas pela Stripe nos Payment Links ligados (pré-reservas), com o email cifrado para as juntar
// à inscrição e ao anúncio de onde a pessoa veio.
export const stripePurchases = pgTable("stripe_purchases", {
  sessionId: text("session_id").primaryKey(),
  softwareId: text("software_id").notNull().references(() => softwares.id),
  emailHash: text("email_hash"),
  amountCents: integer("amount_cents").notNull().default(0),
  currency: text("currency").notNull().default("eur"),
  paymentLink: text("payment_link"),
  paidAt: timestamp("paid_at", { withTimezone: true }).notNull(),
}, (t) => [index("stripe_purchases_sw_idx").on(t.softwareId, t.paidAt)]).enableRLS();

// De que página e de que anúncio veio cada inscrição (a primeira de cada pessoa), para saber que anúncios trazem compras.
// Só o email cifrado, a página e o anúncio (utm_content normalizado); nada vai para fora.
export const signupAttributions = pgTable("signup_attributions", {
  emailHash: text("email_hash").notNull(),
  softwareId: text("software_id").notNull().references(() => softwares.id),
  page: text("page"),
  adRef: text("ad_ref"),
  signedUpAt: timestamp("signed_up_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.emailHash, t.softwareId] })]).enableRLS();

// Totais de cada campanha desde o início (o alcance e a frequência não se somam por dia).
export const metaCampaignTotals = pgTable("meta_campaign_totals", {
  campaignId: text("campaign_id").primaryKey(),
  softwareId: text("software_id").notNull().references(() => softwares.id),
  since: date("since"),
  until: date("until"),
  spendCents: integer("spend_cents").notNull().default(0),
  impressions: integer("impressions").notNull().default(0),
  reach: integer("reach").notNull().default(0),
  frequency: numeric("frequency", { precision: 6, scale: 2 }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// API de Conversões da Meta: quem se inscreveu num site N5 e aceitou os cookies de marketing.
// Serve para enviar à Meta a compra quando a Stripe a confirmar, com os mesmos identificadores do anúncio.
// Sem consentimento não há linha; cada linha apaga-se ao fim de 90 dias (tarefa meta-sync).
export const metaConsents = pgTable("meta_consents", {
  emailHash: text("email_hash").primaryKey(), // SHA-256 do email normalizado, igual ao que vai para a Meta
  softwareId: text("software_id").notNull().references(() => softwares.id),
  leadEventId: text("lead_event_id"),
  fbp: text("fbp"),
  fbc: text("fbc"),
  clientIp: text("client_ip"),
  userAgent: text("user_agent"),
  sourceUrl: text("source_url"),
  consentedAt: timestamp("consented_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  purchaseSentAt: timestamp("purchase_sent_at", { withTimezone: true }),
}, (t) => [index("meta_consents_expires_idx").on(t.expiresAt)]).enableRLS(); // sem acesso fora da aplicação; só o Controlo lhe liga diretamente

// ---------- Orçamentos ABO (campanhas da Meta com orçamento por conjunto) ----------
export const metaAboCampaigns = pgTable("meta_abo_campaigns", {
  campaignId: text("campaign_id").primaryKey(),
  softwareId: text("software_id").notNull().references(() => softwares.id),
  accountId: text("account_id").notNull(), // act_…
  name: text("name").notNull(),
  dailyBudgetCents: integer("daily_budget_cents").notNull(), // o total do dia que as regras repartem
  aboSince: date("abo_since").notNull(), // os números contam a partir deste dia
  auto: boolean("auto").notNull().default(true), // desligado: as regras não correm
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const metaBudgetDecisions = pgTable("meta_budget_decisions", {
  id: serial("id").primaryKey(),
  runId: text("run_id").notNull(),
  moment: text("moment").notNull(), // manha | noite
  campaignId: text("campaign_id").notNull(),
  adsetId: text("adset_id"),
  adsetName: text("adset_name"),
  adName: text("ad_name"),
  action: text("action").notNull(), // manter | subir | descer | pausar | aviso
  fromCents: integer("from_cents"),
  toCents: integer("to_cents"),
  metric: text("metric"), // compras | leads | visitas | cliques
  costCents: integer("cost_cents"),
  reason: text("reason").notNull(),
  incoming: text("incoming"), // o criativo que entra numa troca
  applied: boolean("applied").notNull().default(false),
  errorCode: text("error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("meta_budget_decisions_campaign").on(t.campaignId, t.createdAt)]);

// ---------- Alertas ----------
export const alerts = pgTable("alerts", {
  id: serial("id").primaryKey(),
  module: alertModule("module").notNull(),
  softwareId: text("software_id"),
  severity: alertSeverity("severity").notNull(),
  title: text("title").notNull(),
  detail: text("detail"),
  dedupeKey: text("dedupe_key").notNull(),
  count: integer("count").notNull().default(1),
  status: alertStatus("status").notNull().default("novo"),
  ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  note: text("note"),
  mutedUntil: timestamp("muted_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
}, (t) => [index("alerts_status_idx").on(t.status, t.severity)]);

// ---------- Acesso e auditoria ----------
export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  prefix: text("prefix").notNull().unique(), // primeiros caracteres visíveis
  hash: text("hash").notNull(), // SHA-256 da chave completa
  scopes: text("scopes").array().notNull(),
  softwareId: text("software_id").references(() => softwares.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  actor: text("actor").notNull(), // user:<id> | key:<prefix> | webhook:<origem> | system
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  before: jsonb("before"),
  after: jsonb("after"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

// Todos os webhooks recebidos ficam em bruto 30 dias, para reprocessar
export const webhookInbox = pgTable("webhook_inbox", {
  id: serial("id").primaryKey(),
  source: text("source").notNull(),
  externalId: text("external_id"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  body: text("body").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  error: text("error"),
}, (t) => [uniqueIndex("webhook_inbox_ext").on(t.source, t.externalId)]);

// ---------- Módulo 5: Reativação e comunicações ----------
export const messageChannel = pgEnum("message_channel", ["inapp", "email"]);
export const messageType = pgEnum("message_type", ["lembrete", "dica", "novidade", "oferta", "feedback", "fim_trial", "reativacao"]);
export const messageStatus = pgEnum("message_status", [
  "pendente", "enviada", "entregue", "vista", "clicada", "dispensada", "falhou", "cancelada", "bloqueada",
]);
export const ruleAudience = pgEnum("rule_audience", ["todos", "pagante", "trial", "beta"]);

export const messageTemplates = pgTable("message_templates", {
  id: serial("id").primaryKey(),
  softwareId: text("software_id").references(() => softwares.id, { onDelete: "cascade" }), // null = todos
  name: text("name").notNull(),
  type: messageType("type").notNull(),
  channel: messageChannel("channel").notNull(),
  subject: text("subject").notNull(), // e-mail: assunto; in-app: título
  body: text("body").notNull(), // variáveis: {{nome}}, {{dias}}, {{software}}, {{link}}
  ctaLabel: text("cta_label"),
  ctaUrl: text("cta_url"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const engagementRules = pgTable("engagement_rules", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  softwareId: text("software_id").references(() => softwares.id, { onDelete: "cascade" }), // null = todos
  inactiveDays: integer("inactive_days").notNull(),
  audience: ruleAudience("audience").notNull().default("todos"),
  templateId: integer("template_id").notNull().references(() => messageTemplates.id),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const outboundMessages = pgTable("outbound_messages", {
  id: text("id").primaryKey(), // msg_...
  personId: text("person_id").notNull().references(() => persons.id, { onDelete: "cascade" }),
  softwareId: text("software_id").notNull().references(() => softwares.id),
  ruleId: integer("rule_id").references(() => engagementRules.id, { onDelete: "set null" }),
  templateId: integer("template_id").references(() => messageTemplates.id, { onDelete: "set null" }),
  channel: messageChannel("channel").notNull(),
  type: messageType("type").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  ctaLabel: text("cta_label"),
  ctaUrl: text("cta_url"),
  status: messageStatus("status").notNull().default("pendente"),
  daysInactiveAtSend: integer("days_inactive_at_send"),
  error: text("error"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  seenAt: timestamp("seen_at", { withTimezone: true }),
  clickedAt: timestamp("clicked_at", { withTimezone: true }),
  returnedAt: timestamp("returned_at", { withTimezone: true }), // voltou a usar até 7 dias depois do envio
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("outbound_person_idx").on(t.personId, t.createdAt), index("outbound_rule_idx").on(t.ruleId)]);

// ---------- Módulo 6: Impacto (retorno para o utilizador) ----------
// Catálogo de tarefas que o software faz ou ajuda a fazer, com o tempo de referência de as fazer à mão.
// "manualMinutes" = quanto demora sem o software; "remainingMinutes" = tempo humano que ainda fica quando a IA a faz.
export const impactTasks = pgTable("impact_tasks", {
  id: serial("id").primaryKey(),
  softwareId: text("software_id").notNull().references(() => softwares.id, { onDelete: "cascade" }),
  key: text("key").notNull(), // igual a properties.task do evento task.completed
  label: text("label").notNull(),
  manualMinutes: numeric("manual_minutes", { precision: 8, scale: 2 }).notNull(),
  remainingMinutes: numeric("remaining_minutes", { precision: 8, scale: 2 }).notNull().default("0"),
  basis: text("basis"), // como se chegou ao tempo de referência (cronometragem, entrevistas, estimativa)
  validated: boolean("validated").notNull().default(false),
  active: boolean("active").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("impact_tasks_sw_key").on(t.softwareId, t.key)]);

// Pressupostos de valor por software
export const impactSettings = pgTable("impact_settings", {
  softwareId: text("software_id").primaryKey().references(() => softwares.id, { onDelete: "cascade" }),
  hourValueCents: integer("hour_value_cents").notNull().default(2000), // valor da hora de reserva, para contas sem dados do onboarding
  defaultWeeklyHours: integer("default_weekly_hours").notNull().default(40), // horas por semana quando a conta não as indicou
  fastResponseMinutes: integer("fast_response_minutes").notNull().default(5), // limiar de resposta rápida
  minSample: integer("min_sample").notNull().default(30), // leads mínimas por grupo para comparar conversões
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Perfil da conta recolhido pelo software no onboarding (evento account.profile_updated).
// Dá o valor da hora de cada conta: faturação média mensal ÷ horas de trabalho por mês.
export const accountProfiles = pgTable("account_profiles", {
  organizationId: text("organization_id").notNull(),
  softwareId: text("software_id").notNull().references(() => softwares.id, { onDelete: "cascade" }),
  avgMonthlyRevenueCents: integer("avg_monthly_revenue_cents"),
  weeklyHours: numeric("weekly_hours", { precision: 5, scale: 1 }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.organizationId, t.softwareId] })]);

// ---------- Módulo 7: Chat de trabalho por projeto ----------
// Um canal por software (o id do software) e o canal "geral". Nada se apaga: editar e apagar ficam registados.
export const chatKind = pgEnum("chat_kind", ["mensagem", "decisao", "pendente"]);
export const chatSummaryKind = pgEnum("chat_summary_kind", ["arquivo", "ultimos_dias", "pendentes"]);

export const chatMessages = pgTable("chat_messages", {
  id: text("id").primaryKey(), // cm_...
  channel: text("channel").notNull(), // sw_clara, sw_imobiliario, geral
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  body: text("body").notNull(),
  kind: chatKind("kind").notNull().default("mensagem"),
  parentId: text("parent_id"), // resposta a outra mensagem
  roadmapCodes: text("roadmap_codes").array().notNull().default([]), // CLA-12 citados
  mentions: uuid("mentions").array().notNull().default([]), // pessoas da equipa mencionadas com @
  pinned: boolean("pinned").notNull().default(false),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }), // pendente resolvido
  resolvedBy: uuid("resolved_by"),
  summaryId: integer("summary_id"), // resumo de arquivo que já cobre esta mensagem (> 90 dias)
  editedAt: timestamp("edited_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }), // apagada para a equipa; o texto fica guardado
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("chat_channel_time_idx").on(t.channel, t.createdAt), index("chat_parent_idx").on(t.parentId)]);

export const chatReads = pgTable("chat_reads", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  channel: text("channel").notNull(),
  lastReadAt: timestamp("last_read_at", { withTimezone: true }).notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.channel] })]);

export const chatSummaries = pgTable("chat_summaries", {
  id: serial("id").primaryKey(),
  channel: text("channel").notNull(),
  kind: chatSummaryKind("kind").notNull(),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  content: text("content").notNull(), // texto do resumo
  data: jsonb("data").$type<Record<string, unknown>>(), // pendentes e temas estruturados
  messages: integer("messages").notNull().default(0),
  engine: text("engine").notNull(), // "regras" ou o modelo de IA usado
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("chat_summaries_channel_idx").on(t.channel, t.kind, t.periodStart)]);
