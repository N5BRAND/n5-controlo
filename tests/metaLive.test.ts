import { describe, it, expect, vi, afterEach } from "vitest";
import { syncDue, withTimeout, lastByKey, chunks, LIVE_MIN_SECONDS } from "@/lib/metaLive";

afterEach(() => vi.useRealTimers());

describe("leitura da Meta ao abrir a página", () => {
  const agora = new Date("2026-10-31T18:00:00Z");

  it("lê quando nunca leu ou quando a última leitura tem mais de 30 segundos", () => {
    expect(syncDue(null, agora)).toBe(true);
    expect(syncDue(new Date(agora.getTime() - LIVE_MIN_SECONDS * 1000), agora)).toBe(true);
    expect(syncDue(new Date("2026-10-31T12:13:00Z"), agora)).toBe(true);
  });

  it("não volta a perguntar à Meta em duas aberturas seguidas", () => {
    expect(syncDue(new Date(agora.getTime() - 5000), agora)).toBe(false);
  });

  it("devolve o resultado quando a Meta responde a tempo", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 100)).resolves.toBe("ok");
  });

  it("segue sem a Meta quando ela demora", async () => {
    vi.useFakeTimers();
    const lenta = new Promise<string>((resolve) => setTimeout(() => resolve("tarde"), 20_000));
    const r = withTimeout(lenta, 8000);
    vi.advanceTimersByTime(8000);
    await expect(r).resolves.toBeNull();
  });
});

describe("gravação em lote", () => {
  it("linhas com a mesma chave ficam só com a última", () => {
    const linhas = [{ k: "a", v: 1 }, { k: "b", v: 2 }, { k: "a", v: 3 }];
    expect(lastByKey(linhas, (r) => r.k)).toEqual([{ k: "a", v: 3 }, { k: "b", v: 2 }]);
  });

  it("divide em partes de 500", () => {
    const partes = chunks(Array.from({ length: 1201 }, (_, i) => i));
    expect(partes.map((p) => p.length)).toEqual([500, 500, 201]);
    expect(chunks([])).toEqual([]);
  });
});
