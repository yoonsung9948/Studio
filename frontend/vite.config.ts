import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import {
  parseEnvironment,
  parseProxyTarget,
} from "./src/config/environment.ts";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig(({ command, mode, isPreview }) => {
  const env = loadEnv(mode, ".", ["VITE_", "DEV_API_"]);
  const development =
    command === "serve" && !isPreview && mode !== "production";
  parseEnvironment(env, development);
  const target = parseProxyTarget(env.DEV_API_PROXY_TARGET);
  return {
    server: {
      proxy: { "/api": { target, changeOrigin: true } },
    },
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
      maxWorkers: 4,
      setupFiles: ["./src/test/setup.ts"],
      css: false,
    },
  };
});
