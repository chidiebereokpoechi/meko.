import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server on :5173. The API base is read at runtime from VITE_API_URL (default :3000).
// Add http://localhost:5173 to the API's MEKO_ALLOWED_ORIGINS so CORS + the WS Origin check pass.
export default defineConfig({
  plugins: [react()],
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
});
