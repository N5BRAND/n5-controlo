import { describe, expect, it } from "vitest";
import { sectionOrder, siteConclusions, stepFunnel } from "@/lib/metrics";
import { buildSiteQueries, normalizePage, siteFor } from "@/lib/siteQueries";

describe("Monitorização do site", () => {
  it("monta as consultas com o domínio e o dia, e recusa valores estranhos", () => {
    const q = buildSiteQueries("clara.numerocinco.pt", "2026-10-29");
    expect(q.mainFunnel).toContain("'clara.numerocinco.pt'");
    expect(q.pages).toContain("toDateTime('2026-10-29 00:00:00')");
    expect(Object.values(q).every((s) => !s.includes("{{"))).toBe(true);
    expect(() => buildSiteQueries("x' OR 1=1 --", "2026-10-29")).toThrow();
    expect(() => buildSiteQueries("clara.numerocinco.pt", "ontem")).toThrow();
  });

  it("filtra todos os números do site pela página escolhida, menos a lista das páginas", () => {
    const q = buildSiteQueries("clara.numerocinco.pt", "2026-10-29", "/leads/");
    for (const k of ["mainFunnel", "mainDays", "sections", "visitTime", "sectionTimes", "steps", "fieldErrors"] as const) expect(q[k], k).toContain("= '/leads/'");
    expect(q.pages).not.toContain("'/leads/'");
    expect(q.mainFunnel).not.toContain("$pathname = '/'");
    // a comparação dos cliques da Meta usa as visitas da Meta em todo o site
    expect(q.mainDays).toContain("AS aberturas_meta_site");
    // quem paga conta na página onde abriu o pagamento
    expect(q.steps).toContain("event = 'pre_reserva_paga', person_id IN (SELECT person_id");
    expect(buildSiteQueries("clara.numerocinco.pt", "2026-10-29").sections).toContain("= '/'");
    expect(() => buildSiteQueries("clara.numerocinco.pt", "2026-10-29", "/x' OR 1=1 --/")).toThrow();
  });

  it("normaliza a página como o PostHog a guarda e recusa o resto", () => {
    expect(normalizePage("/leads")).toBe("/leads/");
    expect(normalizePage("//Leads//")).toBe("/leads/");
    expect(normalizePage("/")).toBe("/");
    expect(normalizePage("")).toBe("/");
    expect(normalizePage("/a'b/")).toBeNull();
    expect(normalizePage("/a/b/c/d/e/f/")).toBeNull();
  });

  it("sabe o site de cada software", () => {
    expect(siteFor("sw_clara", "")).toBe("clara.numerocinco.pt");
    expect(siteFor("sw_imobiliario", "sw_imobiliario:imo.numerocinco.pt")).toBe("imo.numerocinco.pt");
    expect(siteFor("sw_outro", "")).toBeNull();
  });

  it("conta quem sai em cada passo da inscrição de um ecrã, com o nome dos números antigos a contar como o formulário", () => {
    const s = stepFunnel([{ passo: "dados", chegaram: 15 }, { passo: "nome", chegaram: 5 }, { passo: "email", chegaram: 4 }, { passo: "enviada", chegaram: 15 }, { passo: "pre-reserva", chegaram: 12 }, { passo: "pagamento", chegaram: 6 }, { passo: "paga", chegaram: 3 }]);
    expect(s.map((x) => x.step)).toEqual(["dados", "enviada", "pre-reserva", "pagamento", "paga"]);
    expect(s[0]).toMatchObject({ reached: 20, left: 5, shareLeft: 0.25, shareOfStart: 1, form: true });
    expect(s[2]).toMatchObject({ reached: 12, left: 6, shareLeft: 0.5, form: true });
    expect(s[3].form).toBe(false);
    expect(s[4].left).toBeNull();
    // as prioridades só aparecem quando há quem lá chegue (pré-reservas esgotadas)
    expect(stepFunnel([{ passo: "dados", chegaram: 3 }, { passo: "prioridades", chegaram: 2 }]).map((x) => x.step)).toContain("prioridades");
  });

  it("ordena as secções de cada página pela ordem do site, com as desconhecidas no fim", () => {
    expect(sectionOrder([{ seccao: "lista" }, { seccao: "inicio" }]).map(([id]) => id)).toEqual(["inicio", "lista"]);
    // landing page: topo, exemplos, três passos, reserva
    expect(sectionOrder([{ seccao: "lista" }, { seccao: "passos" }, { seccao: "como" }, { seccao: "inicio" }]).map(([, n]) => n)).toEqual(["Topo", "Exemplos", "Três passos", "Reserva"]);
    // página do CRM: o copiloto vem antes dos exemplos
    expect(sectionOrder([{ seccao: "cenas" }, { seccao: "copiloto" }, { seccao: "inicio" }]).map(([id]) => id)).toEqual(["inicio", "copiloto", "cenas"]);
    expect(sectionOrder([{ seccao: "nova", posicao: 3 }, { seccao: "outra", posicao: 1 }, { seccao: "inicio" }]).map(([id]) => id)).toEqual(["inicio", "outra", "nova"]);
  });

  it("diz onde param pelas secções da página escolhida", () => {
    const base = { metaClicksByDay: [], days: [], errors: [], times: [], visit: null, steps: stepFunnel([]) };
    const funnel = [{ fonte: "Todas", aberturas: 100, qualificadas: 70, iniciadas: 20, enviadas: 15, pagamentos: 0, pagas: 0 }];
    const lp = siteConclusions({ ...base, funnel, sections: [{ seccao: "inicio", alcance: 1 }, { seccao: "como", alcance: 0.9 }, { seccao: "passos", alcance: 0.4 }, { seccao: "lista", alcance: 0.35 }] });
    expect(lp.find((c) => c.topic === "Onde param")?.text).toContain("«Exemplos»: 56% de quem lá chega não passa para «Três passos»");
    expect(JSON.stringify(lp)).not.toContain("lista de espera");
  });

  it("espera por dados antes de concluir e mostra primeiro o que está mal", () => {
    const base = { metaClicksByDay: [], days: [], sections: [], errors: [], times: [], visit: null, steps: stepFunnel([]) };
    const pouco = siteConclusions({ ...base, funnel: [{ fonte: "Todas", aberturas: 26, qualificadas: 17, iniciadas: 0, enviadas: 0, pagamentos: 0, pagas: 0 }] });
    expect(pouco.map((c) => c.topic)).toEqual(["Página", "Cliques da Meta"]);
    expect(pouco.every((c) => c.state === "espera")).toBe(true);
    const muito = siteConclusions({ ...base, funnel: [{ fonte: "Todas", aberturas: 100, qualificadas: 30, iniciadas: 1, enviadas: 0, pagamentos: 0, pagas: 0 }] });
    expect(muito[0]).toMatchObject({ topic: "Primeira impressão", state: "mau" });
  });
});

import { adRef, utmContentOf } from "@/lib/metrics";
describe("Compras da Stripe por anúncio", () => {
  it("junta o utm_content da inscrição ao nome do anúncio", () => {
    expect(adRef("CLA · N3 · LISTA-FSBO · /angariacao/")).toBe("cla_n3_lista_fsbo");
    expect(adRef("cla_n3_lista-fsbo")).toBe("cla_n3_lista_fsbo");
    expect(adRef("CLA · N3 · DIA · VÍDEO")).toBe("cla_n3_dia_video");
    expect(adRef("CLA · N1 · POSICIONAMENTO · /")).toBe("cla_n1_posicionamento");
    expect(adRef(null)).toBe("");
  });

  it("lê o utm_content da ligação do anúncio na Meta", () => {
    const link = "https://clara.numerocinco.pt/leads/?utm_source=meta&utm_medium=paid&utm_campaign=lancamento&utm_content=cla_n2_leads";
    expect(utmContentOf({ object_story_spec: { link_data: { link } } })).toBe("cla_n2_leads");
    expect(utmContentOf({ object_story_spec: { video_data: { call_to_action: { value: { link } } } } })).toBe("cla_n2_leads");
    expect(utmContentOf({ url_tags: "utm_source=meta&utm_content=cla_n4_copiloto" })).toBe("cla_n4_copiloto");
    expect(utmContentOf({ asset_feed_spec: { link_urls: [{ website_url: "https://clara.numerocinco.pt/crm/?utm_content=cla_n4_copiloto" }] } })).toBe("cla_n4_copiloto");
    // parâmetros dinâmicos da Meta e ligações sem utm_content ficam de fora (conta o nome do anúncio)
    expect(utmContentOf({ url_tags: "utm_content={{ad.name}}" })).toBeNull();
    expect(utmContentOf({ object_story_spec: { link_data: { link: "https://clara.numerocinco.pt/" } } })).toBeNull();
    expect(utmContentOf(null)).toBeNull();
  });
});
