import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Dev server on :5173. The API base is read at runtime from VITE_API_URL (default :3000).
// Add http://localhost:5173 to the API's MEKO_ALLOWED_ORIGINS so CORS + the WS Origin check pass.
export default defineConfig(({ mode }) => {
  // This deployment's public origin, used to make Open Graph URLs (og:image/og:url) absolute —
  // crawlers ignore relative ones. Injected into index.html via the %WEB_URL% placeholder below.
  const webUrl = (loadEnv(mode, process.cwd(), "").VITE_WEB_URL || "http://localhost:5173").replace(/\/$/, "");
  return {
  plugins: [
    react(),
    { name: "meko-og-absolute-url", transformIndexHtml: (html) => html.replaceAll("%WEB_URL%", webUrl) },
  ],
  server: { port: 5173 },
  build: {
    rollupOptions: {
      output: {
        // Split heavy, rarely-changing vendors into their own chunks so the app bundle stays
        // small and these stay cached across app deploys.
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          yjs: ["yjs"],
          ui: ["@headlessui/react", "react-colorful"],
        },
      },
    },
  },
  };
});
