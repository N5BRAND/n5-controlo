import { describe, expect, it } from "vitest";
import { awarenessLevel, funnelRows, groupAds, landingPageOf } from "@/lib/metrics";

describe("Monitorização de campanhas", () => {
  it("lê o nível de consciência e a landing page do nome do anúncio", () => {
    expect(awarenessLevel("CLA · N2 · LEADS · /leads/")).toBe(2);
    expect(awarenessLevel("CLA · N5 · PRIMEIROS")).toBe(5);
    expect(awarenessLevel("Anúncio sem nível")).toBeNull();
    expect(landingPageOf("CLA · N2 · LEADS · /leads/")).toBe("/leads/");
    expect(landingPageOf("CLA · N4 · X · /crm")).toBe("/crm/");
    expect(landingPageOf("CLA · N1 · POSICIONAMENTO · /")).toBe("/");
    expect(landingPageOf("CLA · N3 · DIA · VÍDEO")).toBe("/");
  });

  it("marca a maior perda do funil", () => {
    const f = funnelRows([{ label: "Impressões", n: 1000 }, { label: "Cliques", n: 50 }, { label: "Visitas", n: 40 }, { label: "Leads", n: 0 }]);
    expect(f.map((r) => r.fromPrevious)).toEqual([null, 0.05, 0.8, 0]);
    expect(f.find((r) => r.worst)?.label).toBe("Leads");
    expect(f[1].share).toBe(0.05);
  });

  it("soma por grupo e conta os anúncios", () => {
    const base = { impressions: 10, clicks: 1, leads: 0, landingViews: 1, purchases: 0 };
    const g = groupAds([
      { adName: "A · N1 · x", spendCents: 100, ...base }, { adName: "A · N1 · x", spendCents: 50, ...base }, { adName: "B · N2 · y", spendCents: 70, ...base },
    ], (r) => `N${awarenessLevel(r.adName)}`);
    expect(g.find((x) => x.key === "N1")).toMatchObject({ spendCents: 150, ads: 1, clicks: 2 });
    expect(g.find((x) => x.key === "N2")).toMatchObject({ spendCents: 70, ads: 1 });
  });
});
