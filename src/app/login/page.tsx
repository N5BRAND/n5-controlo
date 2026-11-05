"use client";
import { useActionState } from "react";
import { Simbolo } from "@/components/Simbolo";
import { LangSwitch } from "@/components/LangSwitch";
import { useT } from "@/lib/i18n/client";
import { login } from "./actions";

export default function LoginPage() {
  const t = useT();
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-8 bg-ink px-4 py-10">
      <div className="absolute right-4 top-4"><LangSwitch dark /></div>
      <Simbolo fundo="escuro" largura={96} />
      <form action={action} className="card w-full max-w-sm space-y-4 p-6">
        <div>
          <h1 className="h1">Controlo N5</h1>
          <p className="text-muted text-sm mt-1">{t("Acesso só para a equipa.")}</p>
        </div>
        <div>
          <label className="label" htmlFor="email">{t("E-mail")}</label>
          <input id="email" name="email" type="email" autoComplete="username" required className="input" />
        </div>
        <div>
          <label className="label" htmlFor="password">{t("Palavra-passe")}</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
        </div>
        {state?.error ? <p className="text-bad text-sm" role="alert">{state.error}</p> : null}
        <button className="btn btn-primary w-full justify-center" disabled={pending}>{pending ? t("A entrar…") : t("Entrar")}</button>
      </form>
    </main>
  );
}
