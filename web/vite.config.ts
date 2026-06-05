import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server on :5173. The API base is read at runtime from VITE_API_URL (default :3000).
// Add http://localhost:5173 to the API's MEKO_ALLOWED_ORIGINS so CORS + the WS Origin check pass.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});
