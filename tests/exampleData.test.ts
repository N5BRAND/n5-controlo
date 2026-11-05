import { describe, expect, it } from "vitest";
import { EXAMPLE_RULES, SEED_USERS, UNLINK_STATEMENTS, seedProviderCosts } from "@/lib/exampleData";

describe("Dados de exemplo", () => {
  it("reconhece os custos por fornecedor que o seed escreve", () => {
    const c = seedProviderCosts();
    expect(c).toHaveLength(30);
    expect(c).toContainEqual(["sw_clara", "aws", 32000]);
    expect(c).toContainEqual(["sw_clara", "aws", 39680]);
    expect(c).toContainEqual(["sw_imobiliario", "twilio", 16400]);
  });

  it("apaga primeiro o que depende de outras tabelas e os logins por último", () => {
    const order = EXAMPLE_RULES.map((r) => r.table);
    expect(new Set(order).size).toBe(order.length);
    const before = (a: string, b: string) => expect(order.indexOf(a)).toBeLessThan(order.indexOf(b));
    before("chat_messages", "users");
    before("engagement_rules", "message_templates");
    before("subscriptions", "organizations");
    before("feedback", "roadmap_items");
    before("pull_requests", "roadmap_items");
    expect(order[order.length - 1]).toBe("users");
  });

  it("só apaga pelas marcas do seed", () => {
    const where = (t: string) => EXAMPLE_RULES.find((r) => r.table === t)!.where;
    expect(where("persons")).toContain("per\\_ex%");
    expect(where("organizations")).toContain("is_example");
    expect(where("campaign_daily")).toContain("csv:clara_trial_consultores_2026-09");
    expect(where("users")).toContain(SEED_USERS[0]);
    for (const r of EXAMPLE_RULES) expect(r.where).not.toMatch(/\b(drop|truncate|;)\b/i);
    for (const s of UNLINK_STATEMENTS) expect(s).toMatch(/^update /);
  });
});
