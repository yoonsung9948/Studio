/// <reference types="vite/client" />

/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
  readonly VITE_AUTH_BYPASS?: string;
  readonly VITE_HOME_WORKFLOW?: string;
}
