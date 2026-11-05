import type { Metadata } from "next";
import "./globals.css";
import { getLang, getT } from "@/lib/i18n/server";
import { I18nProvider } from "@/lib/i18n/client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: "Controlo N5", description: t("Comunidades, pipeline, campanhas e receita dos softwares N5") };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  return (
    <html lang={lang === "en" ? "en" : "pt-PT"}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body className="font-sans antialiased"><I18nProvider lang={lang}>{children}</I18nProvider></body>
    </html>
  );
}
