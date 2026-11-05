// Barras por dia, desenhadas no servidor (sem JavaScript): passar o rato mostra o dia e o valor.
// A linha tracejada é uma referência opcional (por exemplo, o orçamento diário).

export function DailyBars({ days, format, reference, referenceLabel }: {
  days: { date: string; value: number }[];
  format: (v: number) => string;
  reference?: number | null;
  referenceLabel?: string;
}) {
  if (!days.length) return <p className="text-muted text-sm">Ainda sem dias com números.</p>;
  const W = 600, H = 170, top = 14, bottom = 22, left = 6, right = 6;
  const max = Math.max(...days.map((d) => d.value), reference ?? 0, 1) * 1.1;
  const y = (v: number) => top + (H - top - bottom) * (1 - v / max);
  const band = (W - left - right) / days.length;
  const bw = Math.min(32, band * 0.7);
  const dd = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Valores por dia" className="block">
      <line x1={left} x2={W - right} y1={y(0)} y2={y(0)} stroke="currentColor" strokeOpacity={0.25} />
      {days.map((d, i) => (
        <rect key={d.date} x={left + i * band + (band - bw) / 2} width={bw} y={y(d.value)} height={Math.max(0, y(0) - y(d.value))} rx={3}
          className="fill-data">
          <title>{`${dd(d.date)}: ${format(d.value)}`}</title>
        </rect>
      ))}
      {reference ? (
        <>
          <line x1={left} x2={W - right} y1={y(reference)} y2={y(reference)} stroke="currentColor" strokeOpacity={0.5} strokeDasharray="4 4" />
          <text x={W - right} y={y(reference) - 4} textAnchor="end" fontSize="11" fill="currentColor" fillOpacity={0.6}>{`${referenceLabel ?? ""} ${format(reference)}`.trim()}</text>
        </>
      ) : null}
      <text x={left} y={H - 6} fontSize="11" fill="currentColor" fillOpacity={0.6}>{dd(days[0].date)}</text>
      {days.length > 1 ? <text x={W - right} y={H - 6} textAnchor="end" fontSize="11" fill="currentColor" fillOpacity={0.6}>{dd(days[days.length - 1].date)}</text> : null}
    </svg>
  );
}
