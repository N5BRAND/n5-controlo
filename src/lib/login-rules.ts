import { createHash } from "node:crypto";

// Travão às tentativas de entrada (regras puras; testes em tests/login-rules.test.ts): em 15 minutos, no máximo 5 falhas
// por conta e 20 por endereço IP. O e-mail e o IP guardam-se só em hash, nunca em claro.

export const LOGIN_WINDOW_MINUTES = 15;
export const MAX_FAILS_PER_ACCOUNT = 5;
export const MAX_FAILS_PER_IP = 20;

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** Hash curto e estável para identificar uma conta ou um IP sem os guardar. */
export const fingerprint = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 32);

export function loginBlocked(fails: { account: number; ip: number }) {
  return fails.account >= MAX_FAILS_PER_ACCOUNT || fails.ip >= MAX_FAILS_PER_IP;
}

/** O IP de quem pede: o da Netlify primeiro, depois o primeiro de x-forwarded-for. */
export function clientIp(h: { get(name: string): string | null }): string {
  const ip = h.get("x-nf-client-connection-ip") ?? h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "";
  return ip.trim() || "desconhecido";
}
