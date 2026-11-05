import { describe, expect, it } from "vitest";
import { clientIp, fingerprint, loginBlocked, MAX_FAILS_PER_ACCOUNT, MAX_FAILS_PER_IP, normalizeEmail } from "../src/lib/login-rules";

const hdrs = (o: Record<string, string>) => ({ get: (n: string) => o[n] ?? null });

describe("travão às tentativas de entrada", () => {
  it("bloqueia à 5.ª falha na mesma conta ou à 20.ª no mesmo IP", () => {
    expect(loginBlocked({ account: MAX_FAILS_PER_ACCOUNT - 1, ip: 0 })).toBe(false);
    expect(loginBlocked({ account: MAX_FAILS_PER_ACCOUNT, ip: 0 })).toBe(true);
    expect(loginBlocked({ account: 0, ip: MAX_FAILS_PER_IP - 1 })).toBe(false);
    expect(loginBlocked({ account: 0, ip: MAX_FAILS_PER_IP })).toBe(true);
  });
  it("trata o e-mail sem maiúsculas nem espaços, e guarda-o só em hash", () => {
    expect(normalizeEmail("  Pedro@Exemplo.PT ")).toBe("pedro@exemplo.pt");
    const h = fingerprint(normalizeEmail("Pedro@Exemplo.PT"));
    expect(h).toBe(fingerprint("pedro@exemplo.pt"));
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    expect(h).not.toContain("pedro");
  });
  it("lê o IP da Netlify primeiro e depois o primeiro de x-forwarded-for", () => {
    expect(clientIp(hdrs({ "x-nf-client-connection-ip": "203.0.113.7", "x-forwarded-for": "10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientIp(hdrs({ "x-forwarded-for": "198.51.100.2, 10.0.0.1" }))).toBe("198.51.100.2");
    expect(clientIp(hdrs({}))).toBe("desconhecido");
  });
});
