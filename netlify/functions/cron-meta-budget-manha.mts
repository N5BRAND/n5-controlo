// Tarefa agendada da Netlify: análise da manhã dos orçamentos ABO (/api/cron/meta-budget?momento=manha).
// A Netlify conta em UTC: no inverno é a hora de Lisboa; no verão corre uma hora mais tarde.
export default async () => {
  const base = process.env.APP_URL ?? process.env.URL;
  const res = await fetch(`${base}/api/cron/meta-budget?momento=manha`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  console.log(`cron meta-budget manha: ${res.status}`);
  return new Response(null, { status: res.ok ? 200 : 500 });
};

export const config = { schedule: "0 8 * * *" };
