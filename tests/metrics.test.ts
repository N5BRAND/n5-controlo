import { describe, expect, it } from "vitest";
import {
  accountHealth, acvCents, compareTasks, activeSeconds, arpaCents, businessHoursBetween, cacCents, churnRate, ltvCents,
  mrrMovements, nrr, paybackMonths, previousMonthKey, riceScore,
} from "@/lib/metrics";

const m = (o: Record<string, number>) => new Map(Object.entries(o));

describe("MRR", () => {
  it("decompõe novo, expansão, contração e churn", () => {
    const prev = m({ a: 3821, b: 3821, c: 29900, d: 3821 });
    const curr = m({ a: 3821, b: 7642, c: 20000, e: 29900 });
    const r = mrrMovements(prev, curr);
    expect(r.newCents).toBe(29900);
    expect(r.expansionCents).toBe(3821);
    expect(r.contractionCents).toBe(9900);
    expect(r.churnCents).toBe(3821);
    expect(r.startCents + r.newCents + r.expansionCents - r.contractionCents - r.churnCents).toBe(r.endCents);
    expect(r.startAccounts).toBe(4);
    expect(r.churnedAccounts).toBe(1);
  });
  it("conta a passar a zero é churn, não contração", () => {
    const r = mrrMovements(m({ a: 1000 }), m({ a: 0 }));
    expect(r.churnCents).toBe(1000);
    expect(r.contractionCents).toBe(0);
  });
  it("churn e NRR", () => {
    expect(churnRate(m({ a: 1, b: 1, c: 1, d: 1 }), m({ a: 1, b: 1, c: 1 }))).toBe(0.25);
    expect(nrr(m({ a: 100, b: 100 }), m({ a: 150, b: 0, c: 999 }))).toBe(0.75);
    expect(nrr(new Map(), m({ a: 1 }))).toBeNull();
  });
});

describe("Valores por conta", () => {
  it("ACV anualiza o consumo extra de contas com menos de 12 meses", () => {
    expect(acvCents(3821, 0, 12)).toBe(45852);
    expect(acvCents(3821, 1000, 4)).toBe(45852 + 3000);
    expect(acvCents(3821, 1000, 0)).toBe(45852 + 12000);
  });
  it("ARPA, CAC, payback e LTV", () => {
    expect(arpaCents(10000, 4)).toBe(2500);
    expect(arpaCents(10000, 0)).toBe(0);
    expect(cacCents(48000, 12)).toBe(4000);
    expect(cacCents(48000, 0)).toBeNull();
    expect(paybackMonths(4000, 2000)).toBe(2);
    expect(paybackMonths(null, 2000)).toBeNull();
    expect(ltvCents(3821, 0.7, 0.05)).toBe(53494);
    expect(ltvCents(3821, 0.7, 0)).toBeNull();
  });
});

describe("Backlog", () => {
  it("pontuação = alcance × impacto × confiança ÷ esforço", () => {
    expect(riceScore(120, 3, 80, 5)).toBe(57.6);
    expect(riceScore(10, 1, 50, 0)).toBe(0);
  });
});

describe("Tempo na app", () => {
  it("cada sinal vale até 60 s e um intervalo de 30 min abre nova sessão", () => {
    const t0 = Date.UTC(2026, 9, 24, 10, 0, 0);
    const beats = [0, 60, 120, 3600, 3630].map((s) => ({ personId: "p", at: new Date(t0 + s * 1000) }));
    const r = activeSeconds(beats).get("p")!;
    expect(r.sessions).toBe(2);
    expect(r.seconds).toBe(60 + 60 + 60 + 60 + 30);
  });
});

describe("Saúde da conta", () => {
  it("pagamento falhado ou 10 dias sem entrar é vermelho", () => {
    expect(accountHealth({ usageChangePct: 0, daysSinceLastLogin: 1, failedPayments: 1, negativeFeedback: 0 })).toBe("vermelho");
    expect(accountHealth({ usageChangePct: 0, daysSinceLastLogin: 10, failedPayments: 0, negativeFeedback: 0 })).toBe("vermelho");
    expect(accountHealth({ usageChangePct: -30, daysSinceLastLogin: 1, failedPayments: 0, negativeFeedback: 0 })).toBe("amarelo");
    expect(accountHealth({ usageChangePct: 5, daysSinceLastLogin: 1, failedPayments: 0, negativeFeedback: 0 })).toBe("verde");
  });
});

describe("Datas", () => {
  it("horas úteis ignoram fins de semana e noites", () => {
    const fri17 = new Date(Date.UTC(2026, 9, 23, 17, 0));
    const mon10 = new Date(Date.UTC(2026, 9, 26, 10, 0));
    expect(businessHoursBetween(fri17, mon10)).toBe(2);
  });
  it("mês anterior atravessa o ano", () => {
    expect(previousMonthKey("2026-01")).toBe("2025-12");
    expect(previousMonthKey("2026-10")).toBe("2026-09");
  });
});

import { daysUntil, deadlineStatus } from "@/lib/metrics";

describe("prazos do pipeline", () => {
  const now = new Date("2026-10-26T10:00:00Z");
  it("conta os dias em Lisboa", () => {
    expect(daysUntil("2026-10-26", now)).toBe(0);
    expect(daysUntil("2026-10-29", now)).toBe(3);
    expect(daysUntil("2026-10-20", now)).toBe(-6);
  });
  it("classifica o prazo", () => {
    expect(deadlineStatus("2026-10-20", "in_progress", now)).toBe("atrasado");
    expect(deadlineStatus("2026-10-26", "testing_beta", now)).toBe("hoje");
    expect(deadlineStatus("2026-10-28", "sprint_backlog", now)).toBe("a_chegar");
    expect(deadlineStatus("2026-11-20", "sprint_backlog", now)).toBe("ok");
    expect(deadlineStatus(null, "sprint_backlog", now)).toBe("sem_prazo");
    expect(deadlineStatus("2026-10-20", "done", now)).toBe("concluido");
  });
});

describe("ordenação das tarefas do pipeline", () => {
  const t = (priority: "urgente" | "alta" | "normal" | "baixa", dueDate: string | null, score = 0) => ({ priority, dueDate, score });
  it("ordena por prioridade, depois prazo (sem prazo no fim) e pontuação", () => {
    const list = [t("baixa", "2026-01-01"), t("normal", null, 5), t("normal", "2026-03-01"), t("urgente", null), t("normal", "2026-02-01"), t("normal", null, 9)];
    expect([...list].sort(compareTasks)).toEqual([
      t("urgente", null), t("normal", "2026-02-01"), t("normal", "2026-03-01"), t("normal", null, 9), t("normal", null, 5), t("baixa", "2026-01-01"),
    ]);
  });
});
