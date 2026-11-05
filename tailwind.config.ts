import type { Config } from "tailwindcss";

// Marca N5: tinta, creme e dourado; o cobalto (data) é só para números e dados.
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#15181D",
        muted: "#5E6066",
        line: "#E0DED8",
        surface: "#FCFBF8",
        canvas: "#F5F4F0",
        cream: "#F5F4F0",
        gold: { DEFAULT: "#E8A13C", hover: "#F0B25A" },
        data: "#2B44E7",
        accent: { DEFAULT: "#B4761A", soft: "#F9ECD8" },
        good: "#1D7A3B",
        warn: "#C2410C",
        bad: "#B42318",
      },
      fontFamily: {
        sans: ["Archivo", "system-ui", "sans-serif"],
        display: ["Bricolage Grotesque", "Archivo", "system-ui", "sans-serif"],
        label: ["var(--n5-rotulo)"],
        mono: ["ui-monospace", "Consolas", "Menlo", "monospace"],
      },
      borderRadius: { card: "14px" },
      boxShadow: { card: "0 1px 0 rgba(21, 24, 29, 0.04), 0 14px 32px -24px rgba(21, 24, 29, 0.35)" },
    },
  },
  plugins: [],
} satisfies Config;
