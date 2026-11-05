import { describe, expect, it } from "vitest";
import { detectPending, extractCodes, extractMentions, isQuestion, matchItems, monthsToArchive, topKeywords, type ChatMsg } from "../src/lib/chat-rules";
import { deadlineStatus } from "../src/lib/metrics";

const team = [{ id: "u1", name: "Ana Costa" }, { id: "u2", name: "Júlio" }, { id: "u3", name: "Sócio (exemplo)" }];

describe("texto das mensagens", () => {
  it("encontra códigos do roadmap", () => {
    expect(extractCodes("Fechei o CLA-12 e falta o IMO-3, não o cla-4")).toEqual(["CLA-12", "IMO-3"]);
  });
  it("encontra menções pelo primeiro nome, sem acentos nem maiúsculas", () => {
    expect(extractMentions("@ana podes ver? e @julio também", team).sort()).toEqual(["u1", "u2"]);
    expect(extractMentions("email ana@exemplo.pt", team)).toEqual([]);
    expect(extractMentions("@Sócio decide", team)).toEqual(["u3"]);
  });
  it("reconhece perguntas", () => {
    expect(isQuestion("Já temos o prazo do CLA-2?")).toBe(true);
    expect(isQuestion("Está feito.")).toBe(false);
  });
  it("liga mensagens a itens pelo código ou pelo título", () => {
    const items = [{ code: "CLA-1", title: "Marcar visitas por voz" }, { code: "CLA-3", title: "Vocabulário de moradas para a transcrição" }];
    expect(matchItems("A transcrição continua a trocar moradas", items).map((i) => i.code)).toEqual(["CLA-3"]);
    expect(matchItems("vejam o CLA-1", items).map((i) => i.code)).toEqual(["CLA-1"]);
    expect(matchItems("bom dia a todos", items)).toEqual([]);
  });
  it("resume temas por frequência", () => {
    expect(topKeywords(["o webhook do stripe falhou", "stripe outra vez", "webhook resolvido"])).toEqual([{ word: "webhook", count: 2 }, { word: "stripe", count: 2 }]);
  });
});

describe("pendentes", () => {
  const now = new Date("2026-10-26T12:00:00Z");
  const msg = (id: string, body: string, daysAgo: number, o: Partial<ChatMsg> = {}): ChatMsg =>
    ({ id, body, kind: "mensagem", parentId: null, userName: "Ana", createdAt: new Date(now.getTime() - daysAgo * 864e5), resolvedAt: null, deletedAt: null, ...o });
  const items = [
    { id: 1, code: "CLA-1", title: "Marcar visitas por voz", phase: "in_progress", dueDate: "2026-10-20", owner: "Ana" },
    { id: 2, code: "CLA-2", title: "Resumo da chamada na ficha", phase: "testing_beta", dueDate: null, owner: null },
    { id: 3, code: "CLA-3", title: "Vocabulário de moradas", phase: "sprint_backlog", dueDate: null, owner: null },
    { id: 4, code: "CLA-4", title: "Relatório por WhatsApp", phase: "done", dueDate: "2026-10-01", owner: "Ana" },
  ];
  it("junta conversa e pipeline", () => {
    const messages = [
      msg("m1", "Falta decidir o preço do pack extra", 3, { kind: "pendente" }),
      msg("m2", "Quem testa o CLA-2?", 4),
      msg("m3", "Já resolvido", 2, { kind: "pendente", resolvedAt: now }),
      msg("m4", "E a ideia do CLA-3 para as moradas?", 5),
      msg("m5", "resposta", 4, { parentId: "m4" }),
      msg("m6", "o CLA-4 está ótimo", 1),
    ];
    const p = detectPending(messages, items, { now, deadline: (d, ph) => deadlineStatus(d, ph, now) });
    expect(p.map((x) => x.source)).toEqual(["prazo", "marcado", "pergunta", "roadmap", "backlog"]);
    expect(p[0].title).toContain("CLA-1");
    expect(p.find((x) => x.source === "pergunta")!.messageId).toBe("m2");
    expect(p.some((x) => x.title.includes("CLA-4"))).toBe(false);
  });
});

describe("arquivo", () => {
  it("só resume meses completos com mais de 90 dias e ainda sem resumo", () => {
    const now = new Date("2026-10-26T12:00:00Z"); // limite: 28 jul 2026
    const m = (iso: string, summaryId: number | null = null) => ({ createdAt: new Date(iso), summaryId });
    expect(monthsToArchive([m("2026-05-03"), m("2026-06-10"), m("2026-06-11", 7), m("2026-07-01"), m("2026-08-01")], now)).toEqual(["2026-05", "2026-06"]);
  });
});
