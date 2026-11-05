import Link from "next/link";
import { getT } from "@/lib/i18n/server";

export default async function NoAccess() {
  const t = await getT();
  return (
    <main className="min-h-screen grid place-items-center px-4">
      <div className="card max-w-md text-center space-y-2">
        <h1 className="h1">{t("Sem acesso a este módulo")}</h1>
        <p className="text-muted">{t("A tua função não inclui este módulo. Pede acesso a um sócio ou à direção de operações.")}</p>
        <Link className="btn" href="/pipeline">{t("Ir para Pipeline")}</Link>
      </div>
    </main>
  );
}
