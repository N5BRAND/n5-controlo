import type { Metadata } from "next";
// letras servidas pela própria app: nenhum pedido a terceiros
import "@fontsource/archivo/400.css";
import "@fontsource/archivo/500.css";
import "@fontsource/archivo/600.css";
import "@fontsource/archivo/700.css";
import "@fontsource/bricolage-grotesque/800.css";
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
      <body className="font-sans antialiased"><I18nProvider lang={lang}>{children}</I18nProvider></body>
    </html>
  );
}
