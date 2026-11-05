import { describe, expect, it } from "vitest";
import {
  applyDecisions, buildStructure, canManage, decideBudgets, levelFromName, pickMetric,
  type AboAdset, type AboDecision, type AdNumbers, type QueuedAd,
} from "../src/lib/abo";

const NAMES = ["CLA · N1 · DIA", "CLA · N2 · CHAMADA", "CLA · N3 · AGENTES", "CLA · N3 · DIA · VÍDEO", "CLA · N4 · COPILOTO", "CLA · N5 · PRIMEIROS"];
const adset = (i: number, budgetCents = 500, effectiveStatus = "ACTIVE"): AboAdset => ({
  id: String(9000000 + i), name: `Conjunto ${i}`, budgetCents,
  ads: [{ id: String(8000000 + i), name: NAMES[i], level: levelFromName(NAMES[i]), creativeId: String(7000000 + i), adsetId: String(9000000 + i), status: "ACTIVE", effectiveStatus }],
});
const six = (b = [500, 500, 500, 500, 500, 500]) => b.map((x, i) => adset(i, x));
const nums = (m: Record<number, Partial<AdNumbers>>) => new Map(Object.entries(m).map(([i, n]) => [String(8000000 + Number(i)),
  { spendCents: 0, clicks: 0, landingViews: 0, leads: 0, purchases: 0, spendTodayCents: 0, landingViewsToday: 0, ...n }]));
const total = (ds: AboDecision[]) => ds.filter((d) => d.action !== "aviso").reduce((v, d) => v + (d.toCents ?? 0), 0);
const QUEUE: QueuedAd[] = [
  { name: "CLA · N1 · CRM", level: 1, creativeId: "7100001" },
  { name: "CLA · N2 · TEMPO", level: 2, creativeId: "7100002" },
  { name: "CLA · N3 · VOZ", level: 3, creativeId: "7100003" },
];

describe("estrutura da campanha", () => {
  it("lê os conjuntos ABO ativos e a fila sem os criativos ativos nem os tirados, um por nome, por nível", () => {
    const adsets = [
      { id: "111111", name: "A", status: "ACTIVE", daily_budget: "500" },
      { id: "222222", name: "B", status: "ACTIVE", daily_budget: "500" },
      { id: "333333", name: "C", status: "PAUSED", daily_budget: "500" },
    ];
    const ads = [
      { id: "500001", name: "CLA · N1 · DIA", status: "ACTIVE", effective_status: "ACTIVE", adset_id: "111111", creative: { id: "600001" } },
      { id: "500002", name: "CLA · N2 · CHAMADA", status: "ACTIVE", effective_status: "PENDING_REVIEW", adset_id: "222222", creative: { id: "600002" } },
      { id: "500003", name: "CLA · N2 · CHAMADA", status: "PAUSED", adset_id: "111111", creative: { id: "600003" } },
      { id: "500004", name: "CLA · N3 · VOZ", status: "PAUSED", adset_id: "111111", creative: { id: "600004" } },
      { id: "500005", name: "CLA · N3 · VOZ", status: "PAUSED", adset_id: "333333", creative: { id: "600005" } },
      { id: "500006", name: "CLA · N1 · CRM", status: "PAUSED", adset_id: "111111", creative: { id: "600006" } },
      { id: "500007", name: "CLA · N2 · TEMPO", status: "PAUSED", adset_id: "111111", creative: { id: "600007" } },
    ];
    const r = buildStructure(adsets, ads, new Set(["CLA · N2 · TEMPO"]));
    expect(r.adsets.map((s) => [s.id, s.budgetCents, s.ads.length])).toEqual([["111111", 500, 5], ["222222", 500, 1]]);
    expect(r.queue.map((q) => q.name)).toEqual(["CLA · N1 · CRM", "CLA · N3 · VOZ"]);
    expect(r.queue[1].creativeId).toBe("600004");
    expect(r.cbo).toBe(false);
    expect(buildStructure([{ id: "111111", status: "ACTIVE" }], []).cbo).toBe(true);
  });
  it("tira o nível do nome do anúncio", () => {
    expect(levelFromName("CLA · N3 · DIA · VÍDEO")).toBe(3);
    expect(levelFromName("Anúncio sem nível")).toBeNull();
  });
  it("compara pelo passo mais avançado com dados", () => {
    const n = { spendCents: 0, clicks: 30, landingViews: 6, leads: 5, purchases: 2, spendTodayCents: 0, landingViewsToday: 0 };
    expect(pickMetric(n)).toBe("leads");
    expect(pickMetric({ ...n, purchases: 3 })).toBe("compras");
    expect(pickMetric({ ...n, leads: 0 })).toBe("visitas");
    expect(pickMetric({ ...n, leads: 0, landingViews: 0 })).toBe("cliques");
  });
});

describe("análise da manhã", () => {
  it("sem 8 € gastos ninguém é avaliado e o total fica em 30 €", () => {
    const { decisions } = decideBudgets({ moment: "manha", adsets: six(), numbers: nums({ 0: { spendCents: 700, landingViews: 5 } }), dailyBudgetCents: 3000 });
    expect(decisions.every((d) => d.action === "manter")).toBe(true);
    expect(total(decisions)).toBe(3000);
    expect(decisions[0].reason).toMatch(/Ainda só gastou 7,00 €/);
  });
  it("passa 20% do pior para o melhor e o total não muda", () => {
    const numbers = nums({ 0: { spendCents: 1000, landingViews: 10, clicks: 20 }, 1: { spendCents: 900, landingViews: 2, clicks: 9 }, 2: { spendCents: 850, landingViews: 5, clicks: 12 } });
    const { decisions, metric } = decideBudgets({ moment: "manha", adsets: six(), numbers, queue: QUEUE, dailyBudgetCents: 3000 });
    expect(metric).toBe("visitas");
    expect([decisions[0].action, decisions[0].toCents]).toEqual(["subir", 600]);
    expect(decisions[0].reason).toMatch(/1,00 € por visita/);
    expect([decisions[1].action, decisions[1].toCents]).toEqual(["descer", 400]);
    expect(decisions[2].action).toBe("manter");
    expect(total(decisions)).toBe(3000);
  });
  it("nunca passa de 10 € nem desce de 3 € por conjunto", () => {
    const numbers = nums({ 0: { spendCents: 2000, landingViews: 40 }, 1: { spendCents: 2000, landingViews: 2, leads: 1 } });
    const { decisions } = decideBudgets({ moment: "manha", adsets: six([1000, 300, 425, 425, 425, 425]), numbers, dailyBudgetCents: 3000 });
    expect(decisions.every((d) => d.toCents! <= 1000 && d.toCents! >= 300)).toBe(true);
    expect([decisions[0].toCents, decisions[1].toCents]).toEqual([1000, 300]);
    expect(total(decisions)).toBe(3000);
  });
  it("traz para os 10 € um conjunto que já esteja acima e reparte o resto", () => {
    const { decisions } = decideBudgets({ moment: "manha", adsets: [adset(0, 500), adset(1, 500), adset(2, 2000)], numbers: nums({}), dailyBudgetCents: 3000 });
    expect(decisions.map((d) => d.toCents)).toEqual([1000, 1000, 1000]);
  });
  it("15 € sem inscrições e visitas a 2× a média: pausa e entra o seguinte da fila do mesmo nível", () => {
    const numbers = nums({ 0: { spendCents: 1200, landingViews: 12 }, 1: { spendCents: 1600, landingViews: 2 }, 2: { spendCents: 1200, landingViews: 10 }, 3: { spendCents: 1000, landingViews: 8 } });
    const { decisions } = decideBudgets({ moment: "manha", adsets: six(), numbers, queue: QUEUE, dailyBudgetCents: 3000 });
    const d = decisions[1];
    expect(d.action).toBe("pausar");
    expect(d.incoming).toEqual({ name: "CLA · N2 · TEMPO", level: 2, creativeId: "7100002" });
    expect(d.toCents).toBe(500);
    expect(d.reason).toBe("Gastou 16,00 € sem inscrições e cada visita custa 8,00 € (5,1× a média). Entra «CLA · N2 · TEMPO» com 5,00 €.");
    expect(total(decisions)).toBe(3000);
  });
  it("com inscrições não se pausa, mesmo com visitas caras", () => {
    const numbers = nums({ 0: { spendCents: 1200, landingViews: 12 }, 1: { spendCents: 1600, landingViews: 2, leads: 1 } });
    const { decisions } = decideBudgets({ moment: "manha", adsets: six(), numbers, queue: QUEUE, dailyBudgetCents: 3000 });
    expect(decisions[1].action).not.toBe("pausar");
  });
  it("com a fila vazia o conjunto pára e os outros ficam com o orçamento, até 10 € cada", () => {
    const numbers = nums({ 0: { spendCents: 1200, landingViews: 12 }, 1: { spendCents: 1600, landingViews: 0 } });
    const { decisions } = decideBudgets({ moment: "manha", adsets: six(), numbers, queue: [], dailyBudgetCents: 3000 });
    expect([decisions[1].action, decisions[1].toCents]).toEqual(["pausar", 0]);
    expect(decisions[1].reason).toMatch(/sem inscrições nem visitas\. A fila está vazia/);
    expect(total(decisions)).toBe(3000);
    expect(decisions.every((d) => d.toCents! <= 1000)).toBe(true);
  });
  it("avisa quando o orçamento passa de 1000 € por mês (regra: passar a CBO)", () => {
    const over = decideBudgets({ moment: "manha", adsets: six([600, 600, 600, 600, 600, 600]), numbers: nums({}), dailyBudgetCents: 3600 }).decisions;
    expect(over.find((d) => d.action === "aviso")?.reason).toMatch(/passa a CBO/);
    const under = decideBudgets({ moment: "manha", adsets: six(), numbers: nums({}), dailyBudgetCents: 3000 }).decisions;
    expect(under.some((d) => d.action === "aviso")).toBe(false);
  });
});

describe("análise da noite", () => {
  it("só corta quem gastou hoje sem visitas e nunca sobe", () => {
    const numbers = nums({ 0: { spendCents: 2000, landingViews: 20, spendTodayCents: 450 }, 1: { spendCents: 900, landingViews: 1, spendTodayCents: 300 } });
    const { decisions } = decideBudgets({ moment: "noite", adsets: six(), numbers, queue: QUEUE, dailyBudgetCents: 3000 });
    expect([decisions[0].action, decisions[0].toCents]).toEqual(["descer", 400]);
    expect(decisions[0].reason).toMatch(/Hoje gastou 4,50 € sem visitas/);
    expect(decisions.slice(1).every((d) => d.action === "manter" && d.toCents === 500)).toBe(true);
  });
  it("troca o anúncio reprovado pela Meta pelo seguinte da fila", () => {
    const adsets = six();
    adsets[2] = adset(2, 500, "DISAPPROVED");
    const { decisions } = decideBudgets({ moment: "noite", adsets, numbers: nums({}), queue: QUEUE, dailyBudgetCents: 3000 });
    expect(decisions[2].action).toBe("pausar");
    expect(decisions[2].incoming?.name).toBe("CLA · N3 · VOZ");
    expect(decisions[2].reason).toMatch(/^A Meta reprovou o anúncio\./);
  });
});

function fakeMeta(fail: (url: string) => boolean = () => false, perms: { permission: string; status: string }[] | null = [{ permission: "ads_management", status: "granted" }]) {
  const calls: { path: string; method: string; body: Record<string, string> | null; auth: string }[] = [];
  const fetchFn = async (url: string, init?: RequestInit) => {
    const path = url.replace(/^https:\/\/graph\.facebook\.com\/v[\d.]+\//, "");
    calls.push({ path, method: init?.method ?? "GET", body: init?.body ? Object.fromEntries(init.body as URLSearchParams) : null,
      auth: (init?.headers as Record<string, string>)?.authorization ?? "" });
    if (path.startsWith("me/permissions")) {
      return perms === null ? new Response(JSON.stringify({ error: { code: 100 } }), { status: 400 }) : new Response(JSON.stringify({ data: perms }));
    }
    if (fail(url)) return new Response(JSON.stringify({ error: { code: 100 } }), { status: 400 });
    return new Response(JSON.stringify({ success: true, id: "1234567" }));
  };
  return { fetchFn, calls };
}

describe("aplicação na Meta", () => {
  const d = (o: Partial<AboDecision>): AboDecision => ({ adsetId: null, adsetName: null, adId: null, adName: null, action: "manter",
    fromCents: 500, toCents: 500, metric: "visitas", costCents: null, reason: "", incoming: null, ...o });

  it("faz as pausas e trocas primeiro, depois as descidas e no fim as subidas, com o token só no cabeçalho", async () => {
    const { fetchFn, calls } = fakeMeta();
    const decisions = [
      d({ action: "subir", adsetId: "9000000", adId: "8000000", toCents: 600 }),
      d({ action: "descer", adsetId: "9000001", adId: "8000001", toCents: 400 }),
      d({ action: "pausar", adsetId: "9000002", adId: "8000002", toCents: 500, incoming: { name: "CLA · N3 · VOZ", level: 3, creativeId: "7100003" } }),
      d({ action: "pausar", adsetId: "9000003", adId: "8000003", toCents: 0 }),
      d({ action: "manter", adsetId: "9000004", adId: "8000004" }),
    ];
    await applyDecisions(fetchFn, "act_1361463075945196", decisions, "EAAgestao");
    expect(calls.map((c) => [c.path, c.body])).toEqual([
      ["8000002", { status: "PAUSED" }],
      ["act_1361463075945196/ads", { name: "CLA · N3 · VOZ", adset_id: "9000002", creative: '{"creative_id":"7100003"}', status: "ACTIVE" }],
      ["9000002", { daily_budget: "500" }],
      ["8000003", { status: "PAUSED" }],
      ["9000003", { status: "PAUSED" }],
      ["9000001", { daily_budget: "400" }],
      ["9000000", { daily_budget: "600" }],
    ]);
    expect(calls.every((c) => c.method === "POST" && c.auth === "Bearer EAAgestao" && !c.path.includes("EAA"))).toBe(true);
    expect(decisions.slice(0, 4).every((x) => x.applied === true)).toBe(true);
    expect(decisions[4].applied).toBeUndefined();
  });
  it("uma falha fica registada nessa decisão e as outras seguem", async () => {
    const { fetchFn } = fakeMeta((url) => url.endsWith("/9000001"));
    const decisions = [d({ action: "descer", adsetId: "9000001", toCents: 400 }), d({ action: "subir", adsetId: "9000000", toCents: 600 })];
    await applyDecisions(fetchFn, "act_1361463075945196", decisions, "EAAgestao");
    expect([decisions[0].applied, decisions[0].errorCode]).toEqual([false, "meta_pedido_invalido"]);
    expect(decisions[1].applied).toBe(true);
  });
  it("só usa o token de gestão se tiver ads_management", async () => {
    expect(await canManage(fakeMeta().fetchFn, "EAAgestao")).toEqual({ ok: true });
    expect(await canManage(fakeMeta(undefined, [{ permission: "ads_read", status: "granted" }, { permission: "ads_management", status: "declined" }]).fetchFn, "EAAgestao"))
      .toEqual({ ok: false, code: "gestao_sem_permissao" });
    expect(await canManage(fakeMeta(undefined, null).fetchFn, "EAAgestao")).toEqual({ ok: false, code: "meta_pedido_invalido" });
  });
});
