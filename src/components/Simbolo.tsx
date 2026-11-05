/**
 * Símbolo oficial N5: quatro traços e a diagonal dourada. Copiado do SVG da marca; não se redesenha.
 * Escala-se só pela largura, a proporção 210 × 110 nunca muda. Com `titulo={null}` fica decorativo.
 */
export function Simbolo({ fundo = "claro", largura = 40, titulo = "N5", className }: { fundo?: "claro" | "escuro"; largura?: number; titulo?: string | null; className?: string }) {
  const traco = fundo === "escuro" ? "#F5F4F0" : "#15181D";
  const a11y = titulo === null ? { "aria-hidden": true } : { role: "img", "aria-label": titulo };
  return (
    <svg viewBox="0 0 210 110" width={largura} height={(largura * 110) / 210} className={className} {...a11y}>
      <g strokeWidth="16" strokeLinecap="round" fill="none">
        <path stroke={traco} d="M25 8 V102 M75 8 V102 M125 8 V102 M175 8 V102" />
        <path stroke="#E8A13C" d="M4 88 L200 20" />
      </g>
    </svg>
  );
}

/** Símbolo e nome da app, como aparecem na barra lateral e no login. */
export function Marca({ fundo = "claro" }: { fundo?: "claro" | "escuro" }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <Simbolo fundo={fundo} largura={34} titulo={null} />
      <span className="font-display text-lg font-extrabold leading-none tracking-[-0.03em]">Controlo N5</span>
    </span>
  );
}
