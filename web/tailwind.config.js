/** @type {import('tailwindcss').Config} */
// Theme lifted from spenny.io-web: the same primary purple + slate palette.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#6e24ff",
        "primary-dark": "#3600a3",
        // Lime accent lifted from the logo wordmark (meko.png). Pairs on the primary purple.
        accent: "#aeef34",
        // Single source of truth for all border/divider colours.
        "line-subtle": "#f1f5f9", // slate-100
        line: "#e2e8f0", // slate-200 (default)
        "line-strong": "#cbd5e1", // slate-300
        "line-stronger": "#94a3b8", // slate-400
        // Muted text/icon ink (top-bar icons, rail labels).
        "ink-muted": "#475569", // slate-600
        // Sunken chrome surfaces (top bar).
        surface: "#e2e8f0", // slate-200
      },
    },
  },
  plugins: [],
};
