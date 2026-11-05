import { fmtDateTime } from "@/lib/format";

const hora = new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const dia = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" });

/** Quando a Meta foi lida pela última vez (ao abrir a página, a leitura é automática) e o botão que recalcula os 28 dias. */
export function MetaLida({ live, action }: { live: { readAt: Date | null; error?: string }; action: () => Promise<void> }) {
  const quando = !live.readAt ? null
    : dia.format(live.readAt) === dia.format(new Date()) ? `às ${hora.format(live.readAt)}` : `a ${fmtDateTime(live.readAt)}`;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className={`text-xs ${live.error ? "text-warn" : "text-muted"}`} title={live.error}>
        {quando ? `Meta lida ${quando}` : "Meta ainda não lida"}
        {live.error ? ` · não deu para ler agora: ${live.error.slice(0, 120)}` : ""}
      </span>
      <form action={action}><button className="btn">Recalcular 28 dias da Meta</button></form>
    </div>
  );
}
