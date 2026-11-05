import { desc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { SCOPES } from "@/lib/apikeys";
import { fmtDate, LABELS } from "@/lib/format";
import { PageHeader, Pill, Tabs } from "@/components/ui";
import { getT } from "@/lib/i18n/server";
import { ApiKeyForm, SoftwareForm, UserForm } from "./forms";
import { revokeApiKey, toggleUser } from "./actions";

export default async function Definicoes({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser("definicoes");
  const t = await getT();
  const sp = await searchParams;
  const vista = typeof sp.vista === "string" ? sp.vista : "softwares";
  const sws = await db.select().from(schema.softwares).orderBy(schema.softwares.createdAt);
  const tabs = [{ key: "softwares", label: t("Softwares") }, { key: "utilizadores", label: t("Utilizadores") }, { key: "chaves", label: t("Chaves de API") }, { key: "ligacoes", label: t("Ligações") }]
    .map((tb) => ({ ...tb, href: `/definicoes?vista=${tb.key}` }));
  return (
    <>
      <PageHeader title={t("Definições")} />
      <Tabs items={tabs} active={vista} />
      {vista === "softwares" ? (
        <div className="space-y-4">
          {sws.map((s) => <details key={s.id} className="card"><summary className="cursor-pointer font-semibold">{s.name} <span className="num text-muted text-xs">{s.id}</span></summary><div className="mt-3"><SoftwareForm sw={s} /></div></details>)}
          <section className="card"><h2 className="h2">{t("Novo software")}</h2><SoftwareForm /></section>
        </div>
      ) : null}
      {vista === "utilizadores" ? <Users softwares={sws} /> : null}
      {vista === "chaves" ? <Keys softwares={sws} /> : null}
      {vista === "ligacoes" ? <Connections /> : null}
    </>
  );
}

async function Users({ softwares }: { softwares: { id: string; name: string }[] }) {
  const t = await getT();
  const users = await db.select().from(schema.users).orderBy(schema.users.name);
  const links = await db.select().from(schema.userSoftwares);
  return (
    <div className="grid lg:grid-cols-[1fr_420px] gap-4">
      <section className="card overflow-x-auto">
        <table className="tbl"><thead><tr><th>{t("Nome")}</th><th>{t("E-mail")}</th><th>{t("Função")}</th><th>{t("Softwares")}</th><th>{t("Estado")}</th><th /></tr></thead>
          <tbody>{users.map((u) => (
            <tr key={u.id}><td>{u.name}</td><td>{u.email}</td><td>{t(LABELS.role[u.role])}</td>
              <td>{u.role === "colaborador" ? links.filter((l) => l.userId === u.id).map((l) => softwares.find((s) => s.id === l.softwareId)?.name).join(", ") || t("nenhum") : t("todos")}</td>
              <td>{u.active ? <Pill tone="verde">{t("ativo")}</Pill> : <Pill>{t("desativado")}</Pill>}</td>
              <td><form action={toggleUser}><input type="hidden" name="id" value={u.id} /><button className="text-sm underline">{u.active ? t("Desativar") : t("Ativar")}</button></form></td></tr>))}</tbody></table>
      </section>
      <section className="card h-fit"><h2 className="h2">{t("Criar ou atualizar utilizador")}</h2><UserForm softwares={softwares} /></section>
    </div>
  );
}

async function Keys({ softwares }: { softwares: { id: string; name: string }[] }) {
  const t = await getT();
  const keys = await db.select().from(schema.apiKeys).orderBy(desc(schema.apiKeys.createdAt));
  return (
    <div className="space-y-4">
      <section className="card overflow-x-auto">
        <table className="tbl"><thead><tr><th>{t("Nome")}</th><th>{t("Prefixo")}</th><th>{t("Permissões")}</th><th>{t("Software")}</th><th>{t("Expira")}</th><th>{t("Último uso")}</th><th /></tr></thead>
          <tbody>{keys.map((k) => (
            <tr key={k.id}><td>{k.name}</td><td className="num">{k.prefix}</td><td className="num text-xs">{k.scopes.join(", ")}</td>
              <td>{k.softwareId ? softwares.find((s) => s.id === k.softwareId)?.name : t("todos")}</td><td>{fmtDate(k.expiresAt)}</td><td>{fmtDate(k.lastUsedAt)}</td>
              <td>{k.revokedAt ? <Pill>{t("revogada")}</Pill> : <form action={revokeApiKey}><input type="hidden" name="id" value={k.id} /><button className="text-sm underline text-bad">{t("Revogar")}</button></form>}</td></tr>))}</tbody></table>
      </section>
      <section className="card"><h2 className="h2">{t("Nova chave")}</h2><ApiKeyForm softwares={softwares} scopes={SCOPES} /></section>
    </div>
  );
}

async function Connections() {
  const t = await getT();
  const inbox = await db.select().from(schema.webhookInbox).orderBy(desc(schema.webhookInbox.receivedAt)).limit(200);
  const last = (src: string) => inbox.find((i) => i.source === src);
  const items = [
    { name: "Stripe", env: "STRIPE_WEBHOOK_SECRET", src: "stripe", path: "/api/webhooks/stripe" },
    { name: "GitHub", env: "GITHUB_WEBHOOK_SECRET", src: "github", path: "/api/webhooks/github" },
    { name: "Slack", env: "SLACK_SIGNING_SECRET", src: "slack", path: "/api/webhooks/slack" },
    { name: "Meta Insights", env: "META_ACCESS_TOKEN", src: null, path: "/api/cron/meta-sync (a cada 6 h)" },
    { name: "Tarefas agendadas", env: "CRON_SECRET", src: null, path: "/api/cron/alerts, /api/cron/mrr" },
  ];
  return (
    <section className="card overflow-x-auto">
      <table className="tbl"><thead><tr><th>{t("Ligação")}</th><th>{t("Configuração")}</th><th>{t("Endereço")}</th><th>{t("Último pedido")}</th><th>{t("Estado")}</th></tr></thead>
        <tbody>{items.map((i) => {
          const configured = !!process.env[i.env];
          const l = i.src ? last(i.src) : undefined;
          return (
            <tr key={i.name}><td className="font-medium">{t(i.name)}</td><td className="num text-xs">{i.env}</td><td className="num text-xs">{t(i.path)}</td>
              <td>{l ? fmtDate(l.receivedAt) : "–"}</td>
              <td>{!configured ? <Pill tone="aviso">{t("por configurar")}</Pill> : l?.error ? <Pill tone="critico">{t("com erro")}</Pill> : <Pill tone="verde">{t("ligada")}</Pill>}</td></tr>
          );
        })}</tbody></table>
      <p className="text-xs text-muted mt-3">{t("Os segredos ficam nas variáveis de ambiente do servidor (AWS Secrets Manager), nunca na base de dados.")}</p>
    </section>
  );
}
