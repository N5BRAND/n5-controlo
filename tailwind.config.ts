import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#15181d",
        muted: "#5f625e",
        line: "#e1ded5",
        surface: "#ffffff",
        canvas: "#f5f4f0",
        brand: { DEFAULT: "#e9a23a", soft: "#fbeed6" },
        accent: { DEFAULT: "#15181d", soft: "#fbeed6" },
        good: "#1d7a3b",
        warn: "#a96200",
        bad: "#b0281f",
      },
      fontFamily: {
        sans: ["IBM Plex Sans", "Segoe UI", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
