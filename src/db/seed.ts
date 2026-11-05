// Dados de EXEMPLO para desenvolvimento e demonstração. Não correr em produção.
// Cria os dois softwares reais (N5 Clara e N5 Imobiliário) com a sua configuração base e,
// à volta deles, contas, feedback, campanhas e eventos inventados, marcados como exemplo.
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { db, schema, sql } from "./index";

// Nunca em produção: nem com NODE_ENV=production nem no deploy de produção da Netlify (CONTEXT=production).
// No build (--if-empty) sai sem erro, para não partir o deploy; corrido à mão, falha.
if ((process.env.NODE_ENV === "production" || process.env.CONTEXT === "production") && !process.argv.includes("--force")) {
  console.error("Recusado: o seed cria dados de exemplo. Em produção usa só scripts/create-user.ts.");
  process.exit(process.argv.includes("--if-empty") ? 0 : 1);
}

// Palavra-passe dos logins de exemplo: DEMO_PASSWORD (12+ caracteres) ou uma gerada agora. Nunca fica escrita no código.
const demoPassword = (process.env.DEMO_PASSWORD ?? "").length >= 12 ? process.env.DEMO_PASSWORD! : randomBytes(12).toString("base64url");

const day = 864e5;
const now = Date.now();
const ago = (d: number) => new Date(now - d * day);
let n = 0;
const id = (p: string) => `${p}_ex${(++n).toString().padStart(4, "0")}`;
const rnd = (() => { let s = 42; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];

async function main() {
  // --if-empty: usado no arranque da demonstração; não apaga nada se já houver utilizadores
  if (process.argv.includes("--if-empty")) {
    if (process.env.DEMO_DATA !== "true") { console.log("DEMO_DATA não está ativo: sem dados de exemplo."); await sql.end(); return; }
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from users`;
    if (n > 0) {
      const [{ t }] = await sql<{ t: number }[]>`select count(*)::int as t from product_events where name = 'task.completed'`;
      if (t === 0) { await seedImpact(); console.log("Dados de exemplo do Impacto criados."); }
      const [{ c }] = await sql<{ c: number }[]>`select count(*)::int as c from chat_messages`;
      if (c === 0) { await seedChat(); console.log("Conversas de exemplo do Chat criadas."); }
      if (t > 0 && c > 0) console.log("A base de dados já tem utilizadores: seed ignorado.");
      await sql.end(); return;
    }
  }
  await sql`truncate table chat_reads, chat_summaries, chat_messages, account_profiles, impact_tasks, impact_settings, outbound_messages, engagement_rules, message_templates, audit_log, webhook_inbox, alerts, campaign_daily, provider_costs, releases, deployments, pull_requests,
    roadmap_items, feedback, usage_records, product_events, invoices, mrr_monthly, subscriptions, persons, organizations,
    api_keys, user_softwares, users, softwares restart identity cascade`;

  await db.insert(schema.softwares).values([
    {
      id: "sw_clara", name: "N5 Clara", code: "CLA", status: "beta", slackPrefix: "clara", githubRepos: ["4ImprovementsPortugal/n5-clara"],
      activationDefinition: "Primeiro número WhatsApp ligado e primeira lead respondida pelo agente",
      keyEvents: ["whatsapp.number_connected", "lead.received", "lead.replied_by_agent", "lead.status_changed", "voice.command", "call.completed", "call.analysis_viewed", "contact.created", "report.weekly_viewed"],
      cplLimitCents: 1500, costPerAccountLimitCents: 2000,
    },
    {
      id: "sw_imobiliario", name: "N5 Imobiliário", code: "IMO", status: "em_construcao", slackPrefix: "imobiliario", githubRepos: ["4ImprovementsPortugal/n5-imobiliario"],
      activationDefinition: "Três consultores ativos na mesma semana",
      keyEvents: ["whatsapp.number_connected", "lead.received", "lead.replied_by_agent", "lead.assigned", "consultant.added", "voice.command", "call.completed", "team_report.viewed", "pipeline.viewed"],
      cplLimitCents: 4000, costPerAccountLimitCents: 15000,
    },
  ]);

  const pass = await bcrypt.hash(demoPassword, 12);
  const [socio] = await db.insert(schema.users).values({ email: "socio@exemplo.n5", name: "Sócio (exemplo)", role: "socio", passwordHash: pass }).returning();
  const [colab] = await db.insert(schema.users).values({ email: "colaborador@exemplo.n5", name: "Colaborador (exemplo)", role: "colaborador", passwordHash: pass }).returning();
  await db.insert(schema.userSoftwares).values({ userId: colab.id, softwareId: "sw_clara" });

  // ---- Contas, pessoas, subscrições, faturas, MRR mensal
  const firstNames = ["Ana", "Rui", "Marta", "João", "Inês", "Tiago", "Sofia", "Pedro", "Carla", "Nuno", "Rita", "Hugo"];
  const campaignsClara = ["clara_trial_consultores_2026-09", "clara_trial_lookalike_2026-10"];
  const campaignsImo = ["imo_demo_brokers_2026-10"];
  const monthKey = (d: Date) => d.toISOString().slice(0, 7);
  for (let i = 0; i < 26; i++) {
    const isImo = i >= 20;
    const sw = isImo ? "sw_imobiliario" : "sw_clara";
    const orgId = id("org");
    const started = ago(10 + Math.floor(rnd() * 150));
    const name = isImo ? `Agência Exemplo ${i - 19}` : `${pick(firstNames)} ${["Silva", "Costa", "Santos", "Ferreira"][i % 4]} (exemplo)`;
    await db.insert(schema.organizations).values({ id: orgId, name, type: isImo ? "agencia" : i % 3 === 0 ? "eni" : "particular", isExample: true, createdAt: started });
    const status = i % 9 === 0 ? "canceled" : i % 7 === 0 ? "trialing" : i % 13 === 0 ? "past_due" : "active";
    const mrr = isImo ? 29900 : 3821; // 47 € com IVA = 38,21 € sem IVA
    await db.insert(schema.subscriptions).values({
      id: id("sub"), organizationId: orgId, softwareId: sw, plan: isImo ? "Imobiliário Base" : "Clara Mensal", status,
      mrrCents: status === "trialing" ? 0 : mrr, includedMinutes: isImo ? 1000 : 100, includedLeads: isImo ? 400 : 80,
      trialEnd: status === "trialing" ? new Date(now + (1 + (i % 5)) * day) : null, startedAt: started,
      canceledAt: status === "canceled" ? ago(5) : null,
    });
    const people = isImo ? 3 + (i % 4) : 1;
    for (let p = 0; p < people; p++) {
      const pid = id("per");
      await db.insert(schema.persons).values({
        id: pid, organizationId: orgId, softwareId: sw, email: `${pid}@exemplo.n5`, name: `${pick(firstNames)} (exemplo)`, origin: status === "trialing" ? "trial" : i % 5 === 0 ? "beta" : "pagante",
        signedUpAt: started, activatedAt: i % 6 === 0 ? null : new Date(started.getTime() + 2 * day),
        attribution: i % 8 === 0 ? {} : { utm_source: "facebook", utm_campaign: pick(isImo ? campaignsImo : campaignsClara), last_campaign: pick(isImo ? campaignsImo : campaignsClara) },
      });
      // Eventos de uso nos últimos 30 dias
      if (status !== "canceled") {
        const evs = [];
        // Algumas pessoas deixaram de usar há algum tempo (para o módulo Reativação)
        const quietDays = (i + p) % 4 === 1 ? 3 + ((i * 7 + p * 5) % 38) : 0;
        for (let d = quietDays; d < 30; d++) {
          if (rnd() < (i % 11 === 0 ? 0.1 : 0.6)) {
            const at = new Date(now - d * day - Math.floor(rnd() * 8) * 36e5);
            for (let h = 0; h < 3 + Math.floor(rnd() * 15); h++) evs.push({ id: id("evt"), softwareId: sw, name: "session.heartbeat", occurredAt: new Date(at.getTime() + h * 60000), personId: pid, organizationId: orgId });
            const feats = isImo ? ["lead.assigned", "team_report.viewed", "pipeline.viewed", "lead.replied_by_agent"] : ["lead.replied_by_agent", "voice.command", "call.completed", "contact.created", "report.weekly_viewed"];
            for (let k = 0; k < 1 + Math.floor(rnd() * 4); k++) {
              const f = pick(feats);
              evs.push({ id: id("evt"), softwareId: sw, name: "feature.used", feature: f, occurredAt: at, personId: pid, organizationId: orgId });
            }
          }
        }
        for (let c = 0; c < evs.length; c += 500) await db.insert(schema.productEvents).values(evs.slice(c, c + 500));
      }
    }
    // Faturas pagas e MRR mensal desde o início
    if (status !== "trialing") {
      const months = Math.max(1, Math.round((now - started.getTime()) / (30 * day)));
      for (let mth = 0; mth < months; mth++) {
        const issued = new Date(started.getTime() + mth * 30 * day);
        if (issued.getTime() > now) break;
        const failed = status === "past_due" && mth === months - 1;
        await db.insert(schema.invoices).values({ id: id("in"), organizationId: orgId, softwareId: sw, amountCents: Math.round(mrr * 1.23), vatCents: Math.round(mrr * 0.23), status: failed ? "failed" : "paid", issuedAt: issued });
        const mk = monthKey(issued);
        const cents = status === "canceled" && mth === months - 1 ? 0 : mrr;
        await db.insert(schema.mrrMonthly).values({ organizationId: orgId, softwareId: sw, month: mk, mrrCents: cents })
          .onConflictDoUpdate({ target: [schema.mrrMonthly.organizationId, schema.mrrMonthly.softwareId, schema.mrrMonthly.month], set: { mrrCents: cents } });
      }
    }
    // Consumo do mês (chamadas, IA, WhatsApp)
    if (status === "active" || status === "past_due") {
      const minutes = (isImo ? 1300 : 120) * (0.6 + rnd());
      const usage = [
        { unit: "call.forward.minute", quantity: minutes, cost: minutes * 0.04, provider: "twilio" },
        { unit: "stt.call.minute", quantity: minutes, cost: minutes * 0.0043, provider: "deepgram" },
        { unit: "lead.conversation", quantity: Math.round((isImo ? 450 : 70) * (0.6 + rnd())), cost: 0, provider: "n5" },
        { unit: "llm.tokens_in", quantity: (isImo ? 15e6 : 2e6) * (0.6 + rnd()), cost: (isImo ? 3.3 : 0.44), provider: "bedrock" },
        { unit: "wa.message.marketing", quantity: isImo ? 250 : 30, cost: (isImo ? 250 : 30) * 0.049 / 0.87, provider: "meta_whatsapp" },
      ];
      for (const u of usage) {
        await db.insert(schema.usageRecords).values({ id: id("use"), softwareId: sw, organizationId: orgId, unit: u.unit, quantity: u.quantity.toFixed(4),
          costUsd: u.cost.toFixed(6), provider: u.provider, occurredAt: ago(Math.floor(rnd() * 10)) });
      }
    }
  }

  await seedImpact();


  // Última utilização a partir dos eventos; quem não tem eventos fica com a data de registo
  await sql`update persons set last_seen_at = (select max(occurred_at) from product_events e where e.person_id = persons.id)`;

  // ---- Reativação: modelos, regras e envios de exemplo
  const [tInapp, tEmail7, tFeedback, tOffer] = await db.insert(schema.messageTemplates).values([
    { name: "Lembrete na app (3 dias)", type: "lembrete", channel: "inapp", subject: "Tem leads à sua espera",
      body: "Olá {{nome}}, o agente respondeu a novas leads enquanto esteve fora. Veja quem está pronto para visita.", ctaLabel: "Ver leads", ctaUrl: "https://exemplo.n5/leads" },
    { name: "E-mail de reativação (7 dias)", type: "reativacao", channel: "email", subject: "{{nome}}, as suas leads continuam a chegar",
      body: "Olá {{nome}},\n\nHá {{dias}} dias que não entra no {{software}}. Nesse tempo, o agente continuou a responder às suas leads.\n\nEntre para ver quem está mais perto de fechar.", ctaLabel: "Abrir o {{software}}", ctaUrl: "https://exemplo.n5/entrar" },
    { name: "Pedido de feedback (14 dias)", type: "feedback", channel: "email", subject: "O que podemos melhorar no {{software}}?",
      body: "Olá {{nome}},\n\nReparámos que não usa o {{software}} há {{dias}} dias. Conte-nos em dois minutos o que falhou: lemos todas as respostas.", ctaLabel: "Responder", ctaUrl: "https://exemplo.n5/feedback" },
    { name: "Oferta de regresso (30 dias)", type: "oferta", channel: "email", subject: "Um mês grátis para voltar ao {{software}}",
      body: "Olá {{nome}},\n\nSe quiser voltar a experimentar, o próximo mês é por nossa conta.", ctaLabel: "Voltar", ctaUrl: "https://exemplo.n5/voltar" },
  ]).returning();
  const rules = await db.insert(schema.engagementRules).values([
    { name: "3 dias sem usar: lembrete na app", inactiveDays: 3, audience: "todos", templateId: tInapp.id },
    { name: "7 dias sem usar: e-mail", inactiveDays: 7, audience: "todos", templateId: tEmail7.id },
    { name: "14 dias sem usar: pedir feedback", inactiveDays: 14, audience: "pagante", templateId: tFeedback.id },
    { name: "30 dias sem usar: oferta", inactiveDays: 30, audience: "pagante", templateId: tOffer.id, active: false },
  ]).returning();
  const persons = await db.select().from(schema.persons);
  for (const p of persons.filter((x) => x.lastSeenAt)) {
    const days = Math.floor((now - p.lastSeenAt!.getTime()) / day);
    for (const [r, t] of [[rules[0], tInapp], [rules[1], tEmail7], [rules[2], tFeedback]] as const) {
      if (days < r.inactiveDays + 1) continue;
      const sentAt = new Date(p.lastSeenAt!.getTime() + (r.inactiveDays + 0.5) * day);
      const roll = rnd();
      await db.insert(schema.outboundMessages).values({
        id: id("msg"), personId: p.id, softwareId: p.softwareId!, ruleId: r.id, templateId: t.id, channel: t.channel, type: t.type,
        subject: t.subject.replace("{{nome}}", (p.name ?? "").split(" ")[0]).replace("{{software}}", "N5"), body: t.body.replace("{{nome}}", (p.name ?? "").split(" ")[0]).replace("{{dias}}", String(r.inactiveDays)).replace(/\{\{software\}\}/g, "N5"),
        ctaLabel: t.ctaLabel, ctaUrl: t.ctaUrl, daysInactiveAtSend: r.inactiveDays, createdAt: sentAt, sentAt,
        status: t.channel === "inapp" ? (roll < 0.5 ? "vista" : "entregue") : roll < 0.25 ? "clicada" : "enviada",
        seenAt: t.channel === "inapp" && roll < 0.5 ? sentAt : null, clickedAt: roll < 0.25 ? sentAt : null,
      });
    }
  }
  // Algumas comunicações recentes resultaram em regresso (a pessoa voltou nos 7 dias seguintes)
  await sql`update outbound_messages m set returned_at = m.sent_at + interval '2 days', status = 'clicada'
    where m.id in (select id from outbound_messages where channel = 'inapp' order by id limit 4)`;

  // ---- Feedback
  const fb: { sw: string; type: "sugestao" | "bug" | "funciona_bem" | "funciona_mal"; title: string; feature: string; severity?: "critico" | "alto" | "medio"; status?: "recebido" | "em_analise" | "planeado" | "lancado" | "recusado"; daysAgo: number; votes: number }[] = [
    { sw: "sw_clara", type: "sugestao", title: "Poder marcar visitas por voz diretamente no calendário", feature: "voice.command", status: "planeado", daysAgo: 12, votes: 9 },
    { sw: "sw_clara", type: "bug", title: "O resumo da chamada não aparece na ficha da lead", feature: "call.completed", severity: "alto", status: "em_analise", daysAgo: 4, votes: 4 },
    { sw: "sw_clara", type: "funciona_bem", title: "O agente respondeu a uma lead às 23h e marcou visita", feature: "lead.replied_by_agent", status: "recebido", daysAgo: 2, votes: 6 },
    { sw: "sw_clara", type: "funciona_mal", title: "A transcrição troca nomes de ruas", feature: "call.completed", status: "recebido", daysAgo: 6, votes: 3 },
    { sw: "sw_clara", type: "sugestao", title: "Relatório semanal também por WhatsApp", feature: "report.weekly_viewed", status: "recebido", daysAgo: 5, votes: 2 },
    { sw: "sw_clara", type: "bug", title: "Agente deixou de responder depois de mudar o número", feature: "whatsapp.number_connected", severity: "critico", status: "recebido", daysAgo: 1, votes: 1 },
    { sw: "sw_imobiliario", type: "sugestao", title: "Distribuir leads por zona do consultor", feature: "lead.assigned", status: "planeado", daysAgo: 9, votes: 5 },
    { sw: "sw_imobiliario", type: "sugestao", title: "Exportar relatório da equipa em PDF", feature: "team_report.viewed", status: "recusado", daysAgo: 20, votes: 1 },
  ];
  for (const f of fb) {
    const created = ago(f.daysAgo);
    await db.insert(schema.feedback).values({
      id: id("fb"), softwareId: f.sw, type: f.type, title: f.title, text: `${f.title}. (exemplo)`, feature: f.feature, severity: f.type === "bug" ? f.severity ?? "medio" : null,
      votes: f.votes, status: f.status ?? "recebido", authorName: `${pick(firstNames)} (exemplo)`, origin: pick(["pagante", "beta", "trial"] as const),
      refusalReason: f.status === "recusado" ? "Os relatórios já se partilham por link; um PDF não acrescenta valor agora." : null,
      firstResponseAt: f.status && f.status !== "recebido" ? new Date(created.getTime() + 5 * 36e5) : null, createdAt: created, updatedAt: created,
    });
  }

  // ---- Roadmap, PRs, deploys, versões
  const items = [
    { sw: "sw_clara", code: "CLA-1", title: "Marcar visitas por voz", phase: "in_progress" as const, impact: 3, reach: 120, confidence: 80, effort: 5, agent: false, sprint: "S44", version: "0.9.0", due: -2 },
    { sw: "sw_clara", code: "CLA-2", title: "Resumo da chamada na ficha da lead", phase: "testing_beta" as const, impact: 2, reach: 150, confidence: 90, effort: 2, agent: true, sprint: "S44", version: "0.9.0", due: 2 },
    { sw: "sw_clara", code: "CLA-3", title: "Vocabulário de moradas para a transcrição", phase: "sprint_backlog" as const, impact: 2, reach: 80, confidence: 50, effort: 3, agent: false, sprint: null, version: null, due: null },
    { sw: "sw_clara", code: "CLA-4", title: "Relatório semanal por WhatsApp", phase: "sprint_backlog" as const, impact: 1, reach: 60, confidence: 60, effort: 3, agent: true, sprint: null, version: null, due: 0 },
    { sw: "sw_imobiliario", code: "IMO-1", title: "Distribuição de leads por zona", phase: "sprint_backlog" as const, impact: 3, reach: 15, confidence: 70, effort: 8, agent: false, sprint: null, version: null, due: 10 },
  ];
  for (const it of items) {
    const [row] = await db.insert(schema.roadmapItems).values({
      code: it.code, softwareId: it.sw, title: it.title, phase: it.phase, impact: it.impact, reach: it.reach, confidence: it.confidence, effort: it.effort,
      agent: it.agent, sprint: it.sprint, version: it.version, ownerUserId: ["in_progress", "testing_beta"].includes(it.phase) ? socio.id : null,
      acceptanceCriteria: ["in_progress", "testing_beta"].includes(it.phase) ? "- Funciona em telemóvel\n- Regista o evento de produto" : null,
      productEvents: it.phase === "testing_beta" ? ["call.completed", "call.analysis_viewed"] : [], origin: "comunidade",
      dueDate: it.due == null ? null : new Date(now + it.due * day).toISOString().slice(0, 10),
    }).returning();
    if (it.code === "CLA-1") await sql`update feedback set roadmap_item_id = ${row.id} where title like 'Poder marcar visitas%'`;
    if (it.code === "IMO-1") await sql`update feedback set roadmap_item_id = ${row.id} where title like 'Distribuir leads%'`;
    if (it.code === "CLA-2") {
      await db.insert(schema.pullRequests).values({ id: "4ImprovementsPortugal/n5-clara#41", roadmapItemId: row.id, softwareId: "sw_clara", repo: "4ImprovementsPortugal/n5-clara", number: 41,
        title: "CLA-2 resumo da chamada na ficha", author: "n5-agent[bot]", isAgent: true, state: "merged", createdAt: ago(3), reviewedAt: ago(2.5), mergedAt: ago(2) });
    }
  }
  await db.insert(schema.pullRequests).values({ id: "4ImprovementsPortugal/n5-clara#44", softwareId: "sw_clara", repo: "4ImprovementsPortugal/n5-clara", number: 44,
    title: "CLA-4 rascunho do relatório por WhatsApp", author: "n5-agent[bot]", isAgent: true, state: "open", createdAt: ago(4) });
  for (let d = 0; d < 20; d++) {
    await db.insert(schema.deployments).values({ id: `dep_ex${d}`, softwareId: "sw_clara", repo: "4ImprovementsPortugal/n5-clara", environment: d % 3 === 0 ? "staging" : "production",
      status: d === 7 ? "failure" : "success", sha: Math.floor(rnd() * 1e9).toString(16).padStart(7, "0"), createdAt: ago(d * 1.4) });
  }
  await db.insert(schema.releases).values([
    { softwareId: "sw_clara", version: "0.8.0", notes: "• Agente responde a leads fora de horas\n• Ficha da lead com histórico do WhatsApp", publishedAt: ago(14), slackPostedAt: ago(14) },
    { softwareId: "sw_clara", version: "0.9.0", notes: "• Marcar visitas por voz\n• Resumo da chamada na ficha da lead" },
  ]);

  // ---- Custos por fornecedor (3 meses)
  const mk = (back: number) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - back); return monthKey(d); };
  for (const [sw, base] of [["sw_clara", 1] as const, ["sw_imobiliario", 0.4] as const]) {
    for (const back of [2, 1, 0]) {
      for (const [prov, v] of [["aws", 32000], ["twilio", 41000], ["deepgram", 4400], ["bedrock", 2800], ["meta_whatsapp", 9000]] as const) {
        await db.insert(schema.providerCosts).values({ softwareId: sw, month: mk(back), provider: prov, costCents: Math.round(v * base * (1 + (2 - back) * 0.12)) });
      }
    }
  }

  // ---- Campanhas (28 dias)
  const camps = [
    { sw: "sw_clara", id: "csv:clara_trial_consultores_2026-09", name: "clara_trial_consultores_2026-09", spend: 2800, cpl: 900 },
    { sw: "sw_clara", id: "csv:clara_trial_lookalike_2026-10", name: "clara_trial_lookalike_2026-10", spend: 2000, cpl: 1400 },
    { sw: "sw_imobiliario", id: "csv:imo_demo_brokers_2026-10", name: "imo_demo_brokers_2026-10", spend: 3500, cpl: 3200 },
  ];
  for (const c of camps) {
    for (let d = 0; d < 28; d++) {
      const spend = Math.round(c.spend * (0.7 + rnd() * 0.6));
      const impressions = Math.round(spend * (1.8 + rnd()));
      await db.insert(schema.campaignDaily).values({
        softwareId: c.sw, campaignId: c.id, campaignName: c.name, adsetName: "Conjunto A", adName: "Vídeo 1", date: ago(d).toISOString().slice(0, 10),
        spendCents: spend, impressions, clicks: Math.round(impressions * (0.009 + rnd() * 0.01)), leads: Math.round(spend / c.cpl),
        frequency: (1.2 + d / 14 + rnd() * 0.3).toFixed(2),
      });
    }
  }

  await seedChat();

  // ---- Alguns alertas de exemplo
  await db.insert(schema.alerts).values([
    { module: "comunidades", softwareId: "sw_clara", severity: "critico", title: "Bug crítico: Agente deixou de responder depois de mudar o número", dedupeKey: "ex-1" },
    { module: "receita", softwareId: "sw_clara", severity: "critico", title: "Pagamento falhado: conta de exemplo", dedupeKey: "ex-2" },
    { module: "campanhas", softwareId: "sw_imobiliario", severity: "aviso", title: "Custo por registo alto: N5 Imobiliário", detail: "Acima de 40,00 € nos últimos dois dias", dedupeKey: "ex-3" },
  ]);

  console.log(`Dados de exemplo criados. Entra com socio@exemplo.n5 (ou colaborador@exemplo.n5) e ${process.env.DEMO_PASSWORD ? "a palavra-passe de DEMO_PASSWORD" : `a palavra-passe ${demoPassword}, gerada agora (define DEMO_PASSWORD para a fixar)`}.`);
  await sql.end();
}

// Impacto: pressupostos, catálogo de tarefas, perfis de onboarding e eventos de exemplo.
// Também corre com --if-empty quando a base já tem dados mas ainda não tem impacto (bases criadas antes do módulo).
async function seedImpact() {
  await db.insert(schema.impactSettings).values([
    { softwareId: "sw_clara", hourValueCents: 2000, fastResponseMinutes: 5, minSample: 30 },
    { softwareId: "sw_imobiliario", hourValueCents: 2500, fastResponseMinutes: 5, minSample: 30 },
  ]).onConflictDoNothing();
  const basis = "Estimativa inicial da equipa: validar com cronometragem a 5 utilizadores";
  const common: [string, string, number, number][] = [
    ["lead.first_reply", "Primeira resposta a uma lead", 4, 0],
    ["lead.qualification", "Qualificação da lead (orçamento, zona, prazo)", 8, 0.5],
    ["followup.sent", "Follow-up a uma lead que não respondeu", 3, 0],
    ["visit.scheduled", "Marcação de visita", 6, 0.5],
    ["crm.update", "Registo da lead e do estado no CRM", 3, 0],
    ["call.summary", "Resumo e notas de uma chamada", 6, 0.5],
    ["call.classification", "Classificação da chamada e próximo passo", 2, 0],
    ["contact.saved", "Gravar um contacto (por voz)", 2, 0.3],
  ];
  await db.insert(schema.impactTasks).values([
    ...common.map(([key, label, m, r]) => ({ softwareId: "sw_clara", key, label, manualMinutes: m.toFixed(2), remainingMinutes: r.toFixed(2), basis, validated: key === "lead.first_reply" })),
    { softwareId: "sw_clara", key: "weekly.report", label: "Relatório semanal de atividade", manualMinutes: "45.00", remainingMinutes: "2.00", basis },
    ...common.map(([key, label, m, r]) => ({ softwareId: "sw_imobiliario", key, label, manualMinutes: m.toFixed(2), remainingMinutes: r.toFixed(2), basis })),
    { softwareId: "sw_imobiliario", key: "lead.assignment", label: "Distribuir a lead pelo consultor certo", manualMinutes: "3.00", remainingMinutes: "0.00", basis },
    { softwareId: "sw_imobiliario", key: "team.report", label: "Relatório semanal da equipa para o broker", manualMinutes: "90.00", remainingMinutes: "5.00", basis },
  ]).onConflictDoNothing();
  {
    const live = (await db.select().from(schema.subscriptions)).filter((x) => x.status !== "canceled");
    let li = 0;
    for (const [ix, sub] of live.entries()) {
      const isImo = sub.softwareId === "sw_imobiliario";
      const aiOffAfterHours = ix % 5 === 0; // algumas contas desligam a IA fora de horas: dão o grupo de comparação
      const lowUse = ix % 7 === 3; // contas que quase não usam: aparecem como risco
      const evs: (typeof schema.productEvents.$inferInsert)[] = [];
      // Prefixo próprio: estes eventos podem ser criados numa base que já tem os eventos do resto do seed
      const ev = (name: string, at: Date, properties: Record<string, unknown>) => evs.push({ id: id("evtimp"), softwareId: sub.softwareId, name, occurredAt: at, organizationId: sub.organizationId, properties });
      const task = (t: string, at: Date, by = "ai", extra: Record<string, unknown> = {}) => ev("task.completed", at, { task: t, by, ...extra });
      // Perfil do onboarding (a maioria das contas respondeu): faturação média mensal e horas por semana
      if (ix % 6 !== 1) {
        const revenue = isImo ? 3500 + Math.round(rnd() * 3500) : 2000 + Math.round(rnd() * 4000);
        const hours = 35 + Math.round(rnd() * 20);
        ev("account.profile_updated", new Date(sub.startedAt.getTime() + day), { avg_monthly_revenue_eur: revenue, weekly_hours: hours });
        await db.insert(schema.accountProfiles).values({ organizationId: sub.organizationId, softwareId: sub.softwareId, avgMonthlyRevenueCents: revenue * 100, weeklyHours: hours.toFixed(1) }).onConflictDoNothing();
      }
      for (let d = 44; d >= 0; d--) {
        const dayStart = new Date(now - d * day); dayStart.setUTCHours(0, 0, 0, 0);
        const weekend = [0, 6].includes(dayStart.getUTCDay());
        const nLeads = lowUse ? (rnd() < 0.15 ? 1 : 0) : Math.round((isImo ? 5 : 2) * (0.5 + rnd()));
        for (let k = 0; k < nLeads; k++) {
          const at = new Date(dayStart.getTime() + Math.floor(rnd() * 24 * 60) * 60000);
          if (at.getTime() > now) continue;
          const h = at.getUTCHours();
          const afterHours = weekend || h < 9 || h >= 20;
          const lead = `lead_ex${++li}`;
          ev("lead.received", at, { lead, after_hours: afterHours, channel: "whatsapp" });
          let seconds: number, by: "ai" | "human";
          if (afterHours && aiOffAfterHours) { by = "human"; const next = new Date(at); if (h >= 9) next.setUTCDate(next.getUTCDate() + 1); next.setUTCHours(9, Math.floor(rnd() * 120), 0, 0); seconds = (next.getTime() - at.getTime()) / 1000; }
          else if (!afterHours && rnd() < 0.15) { by = "human"; seconds = 300 + rnd() * 5400; }
          else { by = "ai"; seconds = 8 + rnd() * 110; }
          const respAt = new Date(at.getTime() + seconds * 1000);
          if (respAt.getTime() > now) continue;
          ev("lead.first_response", respAt, { lead, seconds: Math.round(seconds), by });
          if (by === "ai") task("lead.first_reply", respAt, "ai");
          else {
            // Feito à mão no software: o tempo gasto alimenta a medição automática do tempo à mão
            task("lead.first_reply", respAt, "human", { human_seconds: Math.round(150 + rnd() * 300) });
            task("lead.qualification", new Date(respAt.getTime() + 6e5), "human", { human_seconds: Math.round(360 + rnd() * 480) });
            task("crm.update", respAt, "human", { human_seconds: Math.round(100 + rnd() * 200) });
          }
          if (by === "ai") {
            if (rnd() < 0.8) task("lead.qualification", new Date(respAt.getTime() + 6e5));
            task("crm.update", respAt);
            for (let f = 0; f < Math.floor(rnd() * 3); f++) task("followup.sent", new Date(respAt.getTime() + (f + 1) * day));
            if (isImo) task("lead.assignment", respAt);
          }
          const pVisit = seconds <= 300 ? 0.32 : seconds <= 3600 ? 0.22 : 0.13;
          if (rnd() < pVisit) {
            const vAt = new Date(respAt.getTime() + (1 + rnd() * 3) * day);
            if (vAt.getTime() <= now) {
              const vBy = by === "ai" && rnd() < 0.7 ? "ai" : "human";
              ev("visit.scheduled", vAt, { lead, by: vBy });
              task("visit.scheduled", vAt, vBy);
              const dealAt = new Date(vAt.getTime() + (8 + rnd() * 20) * day);
              if (rnd() < 0.2 && dealAt.getTime() <= now) ev("deal.closed", dealAt, { lead, commission_eur: Math.round((isImo ? 3000 : 2500) + rnd() * (isImo ? 6000 : 4500)) });
            }
          }
        }
        const calls = lowUse ? 0 : Math.round((isImo ? 10 : 1.5) * (0.5 + rnd()));
        for (let c = 0; c < calls; c++) { const at = new Date(dayStart.getTime() + (9 + rnd() * 9) * 36e5); if (at.getTime() > now) continue; task("call.summary", at); task("call.classification", at); }
        if (!lowUse && rnd() < (isImo ? 0.9 : 0.6)) { const at = new Date(dayStart.getTime() + (10 + rnd() * 8) * 36e5); if (at.getTime() <= now) task("contact.saved", at, "assisted", { human_seconds: 15 + Math.round(rnd() * 20) }); }
        if (dayStart.getUTCDay() === 1 && !lowUse) {
          const at = new Date(dayStart.getTime() + 8 * 36e5);
          if (at.getTime() <= now) { if (isImo) { task("team.report", at); for (let c = 0; c < 4; c++) task("weekly.report", at); } else task("weekly.report", at); }
        }
      }
      for (let c = 0; c < evs.length; c += 1000) await db.insert(schema.productEvents).values(evs.slice(c, c + 1000)).onConflictDoNothing();
    }
  }
}

main().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });

// Chat: conversas de exemplo por canal. Inclui meses com mais de 90 dias para o arquivo (o resumo faz-se em /api/cron/chat).
async function seedChat() {
  const users = await sql<{ id: string; name: string; role: string }[]>`select id, name, role from users order by created_at`;
  const socio = users.find((u) => u.role === "socio") ?? users[0];
  const colab = users.find((u) => u.role === "colaborador") ?? users[0];
  if (!socio) return;
  const codes = (t: string) => [...new Set(t.match(/\b[A-Z]{2,5}-\d{1,5}\b/g) ?? [])];
  const at = (daysAgo: number, hour: number) => { const d = new Date(now - daysAgo * day); d.setUTCHours(hour, (daysAgo * 7) % 60, 0, 0); return d; };
  type M = { key?: string; ch: string; who: typeof socio; body: string; d: number; h: number; kind?: "mensagem" | "decisao" | "pendente"; reply?: string; pinned?: boolean; resolved?: boolean; mention?: typeof socio };
  const msgs: M[] = [
    // Arquivo (mais de 90 dias)
    { ch: "sw_clara", who: socio, body: "Arranque do piloto da Clara com 20 consultores. Objetivo: 3 consultores ativos por agência na mesma semana.", d: 160, h: 9, kind: "decisao" },
    { ch: "sw_clara", who: colab, body: "A transcrição falha em moradas com números de porta. Vou juntar exemplos.", d: 158, h: 14 },
    { ch: "sw_clara", who: socio, body: "Preço do piloto fica em 29 € por consultor sem IVA.", d: 152, h: 10, kind: "decisao" },
    { ch: "sw_clara", who: colab, body: "Falta decidir se o relatório semanal vai por e-mail ou WhatsApp.", d: 150, h: 16, kind: "pendente" },
    { ch: "sw_clara", who: socio, body: "Primeiras 5 agências com o número de WhatsApp ligado.", d: 128, h: 11 },
    { ch: "sw_clara", who: colab, body: "O webhook da Meta caiu durante a noite, já repus.", d: 125, h: 8 },
    { ch: "sw_clara", who: socio, body: "Vamos usar o Bedrock na UE para os resumos das chamadas.", d: 121, h: 15, kind: "decisao" },
    { ch: "geral", who: socio, body: "Reunião mensal passa para a primeira segunda-feira de cada mês.", d: 140, h: 9, kind: "decisao" },
    { ch: "geral", who: colab, body: "Atualizei o guia de onboarding das agências.", d: 135, h: 17 },
    // Últimos 90 dias
    { ch: "sw_clara", who: socio, body: "Ficou combinado: o CLA-2 entra na versão 0.9.0 com o resumo da chamada na ficha.", d: 40, h: 10, kind: "decisao" },
    { ch: "sw_clara", who: colab, body: "Comecei o CLA-1. A marcação por voz já reconhece dia e hora.", d: 20, h: 11 },
    { ch: "sw_clara", who: socio, body: "Ótimo. Lembra-te que o prazo do CLA-1 é curto, as agências pediram para a feira.", d: 19, h: 9 },
    { key: "q1", ch: "sw_clara", who: socio, body: "@Colaborador consegues ver porque é que o resumo da chamada não aparece na ficha da lead em algumas contas?", d: 6, h: 10, mention: colab },
    { ch: "sw_clara", who: colab, body: "Vi: só acontece quando a chamada dura menos de 20 s. Corrijo no CLA-2.", d: 6, h: 12, reply: "q1" },
    { ch: "sw_clara", who: colab, body: "A transcrição continua a trocar moradas (Rua de Cedofeita saiu \"Rua dos Feitos\"). Precisamos do vocabulário de moradas.", d: 5, h: 15 },
    { ch: "sw_clara", who: socio, body: "Quem pode fazer a lista de moradas do Porto para o CLA-3?", d: 5, h: 16 },
    { ch: "sw_clara", who: socio, body: "Falta definir o preço do pack extra de minutos de chamadas.", d: 4, h: 10, kind: "pendente", pinned: true },
    { ch: "sw_clara", who: colab, body: "Testes do CLA-2 em 3 contas: tudo bem em telemóvel.", d: 3, h: 14 },
    { ch: "sw_clara", who: socio, body: "Relatório semanal vai por WhatsApp e por e-mail, quem preferir escolhe.", d: 3, h: 17, kind: "decisao" },
    { ch: "sw_clara", who: colab, body: "Tenho de pedir à Meta a aprovação do modelo do relatório semanal por WhatsApp (CLA-4).", d: 2, h: 9, kind: "pendente" },
    { ch: "sw_clara", who: socio, body: "Já resolvemos o acesso dos consultores novos à app.", d: 2, h: 11, kind: "pendente", resolved: true },
    { ch: "sw_clara", who: colab, body: "Hoje vou fechar o CLA-1. Falta só o caso de \"amanhã de manhã\".", d: 1, h: 9 },
    { ch: "sw_clara", who: socio, body: "@Colaborador avisa quando estiver em testes, quero experimentar com a agência de Braga.", d: 0, h: 8, mention: colab },
    { ch: "sw_imobiliario", who: socio, body: "Os brokers pedem a distribuição de leads por zona (IMO-1). Prioridade para o próximo trimestre.", d: 12, h: 10, kind: "decisao" },
    { ch: "sw_imobiliario", who: socio, body: "Temos de escolher se a zona vem do código postal ou do mapa. Alguém tem opinião?", d: 4, h: 15 },
    { ch: "sw_imobiliario", who: socio, body: "Falta a lista de zonas da agência piloto em Lisboa.", d: 3, h: 11, kind: "pendente" },
    { ch: "geral", who: socio, body: "Bem-vindos ao chat do N5. Cada software tem o seu canal; aqui ficam os temas de todos.", d: 30, h: 9, pinned: true },
    { ch: "geral", who: colab, body: "O módulo de Impacto já mostra o tempo poupado por tarefa.", d: 8, h: 16 },
    { ch: "geral", who: socio, body: "Revisão de custos da AWS na sexta-feira. Tragam números de uso.", d: 2, h: 10 },
  ];
  const ids = new Map<string, string>();
  let k = 0;
  for (const m of msgs) {
    const mid = `cm_ex${(++k).toString().padStart(4, "0")}`;
    if (m.key) ids.set(m.key, mid);
    const created = at(m.d, m.h);
    await db.insert(schema.chatMessages).values({
      id: mid, channel: m.ch, userId: m.who.id, body: m.body, kind: m.kind ?? "mensagem", parentId: m.reply ? ids.get(m.reply)! : null,
      roadmapCodes: codes(m.body), mentions: m.mention ? [m.mention.id] : [], pinned: !!m.pinned,
      resolvedAt: m.resolved ? new Date(created.getTime() + 3600e3) : null, resolvedBy: m.resolved ? m.who.id : null, createdAt: created,
    }).onConflictDoNothing();
  }
}
