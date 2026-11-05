/** Logótipo: quatro traços verticais cortados por um traço laranja na diagonal. Os traços herdam a cor do texto (currentColor). */
export function Logo({ className = "h-8 w-auto", title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 120 634 400" className={className} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <g stroke="currentColor" strokeWidth="52" strokeLinecap="round">
        <line x1="73" y1="164" x2="73" y2="470" />
        <line x1="235" y1="164" x2="235" y2="470" />
        <line x1="398" y1="164" x2="398" y2="470" />
        <line x1="560" y1="164" x2="560" y2="470" />
      </g>
      <line x1="-30" y1="425" x2="664" y2="205" stroke="#e9a23a" strokeWidth="56" strokeLinecap="round" />
    </svg>
  );
}
