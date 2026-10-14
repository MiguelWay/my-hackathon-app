import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Static SPA built to dist/ and served from Plesk (with an SPA fallback rewrite).
export default defineConfig({
  plugins: [react()],
});
