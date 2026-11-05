import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  consentExpiry, emailHash, isPaidCheckout, leadEvent, normEmail, normPhone, paymentLinks, purchaseEvent, userData,
} from "@/lib/conversions";

const sha = (v: string) => createHash("sha256").update(v).digest("hex");

describe("API de Conversões da Meta", () => {
  it("normaliza o email e o telefone como a Meta pede", () => {
    expect(normEmail("  Rui@Rede.PT ")).toBe("rui@rede.pt");
    expect(normPhone("912 345 678")).toBe("351912345678");
    expect(normPhone("+351 912345678")).toBe("351912345678");
    expect(normPhone("00351912345678")).toBe("351912345678");
    expect(normPhone("+55 11 98765 4321")).toBe("5511987654321");
    expect(normPhone("")).toBe("");
    expect(emailHash(" ")).toBeNull();
  });

  it("cifra o que identifica a pessoa e deixa de fora o que vem vazio", () => {
    const u = userData({ email: "Rui@rede.pt", phone: "912345678", name: "Rui  Costa Silva", clientIp: "1.2.3.4", userAgent: "UA", fbp: "fb.1.1.1", fbc: "" });
    expect(u.em).toEqual([sha("rui@rede.pt")]);
    expect(u.external_id).toEqual([sha("rui@rede.pt")]);
    expect(u.ph).toEqual([sha("351912345678")]);
    expect(u.fn).toEqual([sha("rui")]);
    expect(u.ln).toEqual([sha("silva")]);
    expect(u.country).toEqual([sha("pt")]);
    expect(u.client_ip_address).toBe("1.2.3.4");
    expect(u.fbp).toBe("fb.1.1.1");
    expect(u).not.toHaveProperty("fbc");
    expect(JSON.stringify(u)).not.toContain("rui@rede.pt");
  });

  it("monta o Lead com o event_id do píxel", () => {
    const e = leadEvent({ eventId: "lead-123456", sourceUrl: "https://clara.numerocinco.pt/leads/", person: { email: "a@b.pt" }, contentName: "N5 Clara", now: new Date("2026-10-31T10:00:00Z") });
    expect(e).toMatchObject({ event_name: "Lead", event_id: "lead-123456", action_source: "website", event_time: 1793440800, event_source_url: "https://clara.numerocinco.pt/leads/" });
    expect(e.custom_data).toEqual({ content_name: "N5 Clara" });
  });

  it("monta o Purchase com o valor pago e a sessão como event_id", () => {
    const e = purchaseEvent({
      session: { id: "cs_test_1", amount_total: 2700, currency: "eur", customer_details: { email: "a@b.pt", phone: "+351912345678", name: "Ana" } },
      consent: { fbp: "fb.1.2.3", fbc: "fb.1.2.abc", clientIp: "1.2.3.4", userAgent: "UA", sourceUrl: "https://clara.numerocinco.pt/" },
      contentName: "N5 Clara",
    });
    expect(e.event_name).toBe("Purchase");
    expect(e.event_id).toBe("cs_test_1");
    expect(e.custom_data).toEqual({ value: 27, currency: "EUR", content_name: "N5 Clara" });
    expect(e.user_data.fbc).toBe("fb.1.2.abc");
    expect(e.user_data.em).toEqual([sha("a@b.pt")]);
  });

  it("só conta a compra quando o dinheiro entrou", () => {
    expect(isPaidCheckout("checkout.session.completed", { id: "1", payment_status: "paid" })).toBe(true);
    expect(isPaidCheckout("checkout.session.completed", { id: "1", payment_status: "unpaid" })).toBe(false); // Multibanco por pagar
    expect(isPaidCheckout("checkout.session.async_payment_succeeded", { id: "1", payment_status: "paid" })).toBe(true);
    expect(isPaidCheckout("checkout.session.async_payment_failed", { id: "1" })).toBe(false);
  });

  it("lê os Payment Links ligados, com a pré-reserva da Clara predefinida", () => {
    expect(paymentLinks(undefined).get("plink_1UVEbARxjA6FBfLNUUGWxa0b")).toBe("sw_clara");
    const m = paymentLinks(" plink_x:sw_imobiliario , mal ");
    expect(m.get("plink_x")).toBe("sw_imobiliario");
    expect(m.has("mal")).toBe(false);
  });

  it("guarda o consentimento 90 dias", () => {
    expect(consentExpiry(new Date("2026-10-31T00:00:00Z")).toISOString()).toBe("2027-01-29T00:00:00.000Z");
  });
});
