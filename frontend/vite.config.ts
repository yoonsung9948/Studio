import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      includeAssets: [],
      includeManifestIcons: false,
      // Keep the static manifest outside Workbox so it is never precached.
      manifest: false,
      workbox: {
        // Give each release a new worker without precaching application content.
        cacheId: `dotori-studio-${Date.now()}`,
        globPatterns: [],
        navigateFallback: undefined,
        cleanupOutdatedCaches: true,
        // Install/update lifecycle only: every application request requires the network.
        runtimeCaching: [
          { urlPattern: /^https?:\/\//, handler: "NetworkOnly" },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
