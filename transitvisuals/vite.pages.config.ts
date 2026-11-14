import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Statischer Build für GitHub Pages (kein Server, kein Cloudflare)
export default defineConfig({
  nitro: false,
  tanstackStart: { spa: { enabled: true } },
  vite: { base: process.env.BASE_PATH || "/" },
});
