import { and, desc, eq, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDateTime, LABELS } from "@/lib/format";
import { Empty, PageHeader, Pill, Tabs } from "@/components/ui";
import { getT } from "@/lib/i18n/server";
import { alertAction, testAlert } from "./actions";

const MODULE_LABEL: Record<string, string> = { comunidades: "Comunidades", pipeline: "Pipeline", campanhas: "Campanhas", receita: "Receita", sistema: "Sistema", impacto: "Impacto", chat: "Chat" };

export default async function Alertas({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser("alertas");
  const t = await getT();
  const sp = await searchParams;
  const estado = typeof sp.estado === "string" ? sp.estado : "abertos";
  const conds = [];
  if (estado === "abertos") conds.push(ne(schema.alerts.status, "resolvido"), sql`(${schema.alerts.mutedUntil} is null or ${schema.alerts.mutedUntil} < now())`);
  if (estado === "resolvidos") conds.push(eq(schema.alerts.status, "resolvido"));
  if (typeof sp.sw === "string") conds.push(eq(schema.alerts.softwareId, sp.sw));
  const rows = await db.select({ a: schema.alerts, owner: schema.users.name, sw: schema.softwares.name }).from(schema.alerts)
    .leftJoin(schema.users, eq(schema.users.id, schema.alerts.ownerUserId)).leftJoin(schema.softwares, eq(schema.softwares.id, schema.alerts.softwareId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(sql`case ${schema.alerts.severity} when 'critico' then 0 when 'aviso' then 1 else 2 end`, desc(schema.alerts.updatedAt)).limit(300);
  const tabs = [{ key: "abertos", label: t("Abertos") }, { key: "resolvidos", label: t("Resolvidos") }, { key: "todos", label: t("Todos") }]
    .map((tb) => ({ ...tb, href: `/alertas?estado=${tb.key}${typeof sp.sw === "string" ? `&sw=${sp.sw}` : ""}` }));
  return (
    <>
      <PageHeader title={t("Centro de alertas")} lead={t("Alertas de todos os módulos. Críticos e avisos chegam também ao canal Slack interno.")}>
        <form action={testAlert}><button className="btn">{t("Criar alerta de teste")}</button></form>
      </PageHeader>
      <Tabs items={tabs} active={estado} />
      {rows.length === 0 ? <Empty title={t("Nada por tratar")}>{t("Os alertas aparecem aqui quando uma regra dispara.")}</Empty> : (
        <ul className="space-y-2">
          {rows.map(({ a, owner, sw }) => (
            <li key={a.id} className="card flex flex-wrap gap-3 items-start justify-between">
              <div className="min-w-0 max-w-3xl">
                <div className="flex flex-wrap gap-2 items-center">
                  <Pill tone={a.severity}>{t(LABELS.alertSeverity[a.severity])}</Pill>
                  <span className="text-xs text-muted">{t(MODULE_LABEL[a.module])}{sw ? ` · ${sw}` : ""} · {t(LABELS.alertStatus[a.status])}{a.count > 1 ? ` · ${t("repetido {n}×", { n: a.count })}` : ""}</span>
                </div>
                <div className="font-semibold mt-1">{a.title}</div>
                {a.detail ? <div className="text-sm text-muted whitespace-pre-wrap">{a.detail}</div> : null}
                <div className="text-xs text-muted mt-1">{t("Criado {data} · dono: {dono}", { data: fmtDateTime(a.createdAt), dono: owner ?? t("ninguém") })}{a.note ? ` · ${t("nota: {nota}", { nota: a.note })}` : ""}</div>
              </div>
              {a.status !== "resolvido" ? (
                <div className="flex flex-wrap gap-2 items-start">
                  <form action={alertAction}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="op" value="assumir" /><button className="btn">{t("Assumir")}</button></form>
                  <form action={alertAction}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="op" value="silenciar" /><button className="btn">{t("Silenciar 24 h")}</button></form>
                  <form action={alertAction} className="flex gap-2"><input type="hidden" name="id" value={a.id} /><input type="hidden" name="op" value="resolver" />
                    <input name="note" className="input w-48" placeholder={t("Nota (opcional)")} aria-label={t("Nota de resolução")} /><button className="btn btn-primary">{t("Resolver")}</button></form>
                </div>
              ) : <span className="text-xs text-muted">{t("Resolvido {data}", { data: fmtDateTime(a.resolvedAt) })}</span>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
