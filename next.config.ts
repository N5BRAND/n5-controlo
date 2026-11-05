import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standalone só para a imagem Docker (o Dockerfile define STANDALONE=1)
  output: process.env.STANDALONE === "1" ? "standalone" : undefined,
  poweredByHeader: false,
  // Só para a demonstração estática no GitHub Pages (scripts/export-demo.py)
  basePath: process.env.NEXT_BASE_PATH || undefined,
  // Cabeçalhos de segurança: sem ser embebida noutros sites, sem adivinhar tipos, só HTTPS
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
      ],
    }];
  },
};

export default nextConfig;
