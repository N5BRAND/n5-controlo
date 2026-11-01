import { describe, expect, it } from "vitest";
import { rangeDays, readFilters, resolveRange } from "@/lib/filters";
import { buildSiteQueries } from "@/lib/siteQueries";

const now = new Date("2026-11-01T18:30:00Z");

describe("Período personalizado", () => {
  it("vai do primeiro dia ao fim do último, os dois incluídos", () => {
    const r = resolveRange("personalizado", now, { de: "2026-10-29", ate: "2026-10-31" });
    expect(r.key).toBe("personalizado");
    expect(r.from.toISOString()).toBe("2026-10-29T00:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-10-31T23:59:59.999Z");
    expect(rangeDays(r)).toEqual({ de: "2026-10-29", ate: "2026-10-31" });
    // o período anterior tem a mesma duração e acaba onde este começa
    expect(r.prevTo.toISOString()).toBe("2026-10-29T00:00:00.000Z");
    expect(r.prevFrom.toISOString()).toBe("2026-10-26T00:00:00.001Z");
  });

  it("um só dia e as datas trocadas também servem", () => {
    expect(rangeDays(resolveRange("personalizado", now, { de: "2026-11-01", ate: "2026-11-01" }))).toEqual({ de: "2026-11-01", ate: "2026-11-01" });
    expect(rangeDays(resolveRange("personalizado", now, { de: "2026-10-31", ate: "2026-10-20" }))).toEqual({ de: "2026-10-20", ate: "2026-10-31" });
  });

  it("sem as duas datas válidas, volta ao mês atual", () => {
    for (const custom of [{}, { de: "2026-10-29" }, { de: "2026-10-29", ate: "ontem" }, { de: "2026-02-30", ate: "2026-03-01" }]) {
      const r = resolveRange("personalizado", now, custom);
      expect(r.key).toBe("mes");
      expect(rangeDays(r)).toEqual({ de: "2026-11-01", ate: "2026-11-01" });
    }
  });

  it("lê o período e as datas do URL", () => {
    const f = readFilters({ periodo: "personalizado", de: "2026-10-29", ate: "2026-11-01", sw: "todos" });
    expect(f.software).toBeNull();
    expect(rangeDays(f.range)).toEqual({ de: "2026-10-29", ate: "2026-11-01" });
  });

  it("os outros períodos dão o último dia certo", () => {
    expect(rangeDays(resolveRange("mes_anterior", now))).toEqual({ de: "2026-10-01", ate: "2026-10-31" });
    expect(rangeDays(resolveRange("mes", now))).toEqual({ de: "2026-11-01", ate: "2026-11-01" });
    expect(rangeDays(resolveRange("7d", now)).ate).toBe("2026-11-01");
  });
});

describe("Números do site num período", () => {
  it("cada consulta ganha o fim do período, e sem ele fica como estava", () => {
    const aberto = buildSiteQueries("clara.numerocinco.pt", "2026-10-29");
    const fechado = buildSiteQueries("clara.numerocinco.pt", "2026-10-29", "/", "2026-11-01");
    for (const [k, q] of Object.entries(fechado)) {
      const desdes = q.match(/timestamp >= toDateTime\('2026-10-29 00:00:00'\)/g)?.length ?? 0;
      expect(desdes, k).toBeGreaterThan(0);
      expect(q.match(/timestamp < toDateTime\('2026-11-01 00:00:00'\)/g)?.length, k).toBe(desdes);
      expect(aberto[k as keyof typeof aberto], k).not.toContain("timestamp <");
    }
    expect(() => buildSiteQueries("clara.numerocinco.pt", "2026-10-29", "/", "amanhã")).toThrow();
  });
});
