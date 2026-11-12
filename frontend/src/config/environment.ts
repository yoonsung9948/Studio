/** Shared by the browser and Vite config; never includes server credentials. */
export interface PublicEnvironment {
  VITE_CLERK_PUBLISHABLE_KEY?: string;
  VITE_AUTH_BYPASS?: string;
  VITE_HOME_WORKFLOW?: string;
}
export interface AppConfiguration {
  development: boolean;
  publishableKey?: string;
  authBypass: boolean;
  homeWorkflow: "api" | "demo";
}
export function parseEnvironment(
  env: PublicEnvironment,
  development: boolean,
): AppConfiguration {
  const bypass = env.VITE_AUTH_BYPASS ?? "false";
  if (bypass !== "true" && bypass !== "false")
    throw new Error("VITE_AUTH_BYPASS must be true or false.");
  const authBypass = bypass === "true";
  const homeWorkflow = env.VITE_HOME_WORKFLOW ?? "api";
  if (homeWorkflow !== "api" && homeWorkflow !== "demo")
    throw new Error("VITE_HOME_WORKFLOW must be api or demo.");
  const publishableKey = env.VITE_CLERK_PUBLISHABLE_KEY?.trim() || undefined;
  if (!development && authBypass)
    throw new Error(
      "Login bypass is only allowed in the development server. Set VITE_AUTH_BYPASS=false before building or previewing.",
    );
  if (!development && homeWorkflow !== "api")
    throw new Error("Production requires VITE_HOME_WORKFLOW=api.");
  if (authBypass && homeWorkflow !== "demo")
    throw new Error(
      "VITE_AUTH_BYPASS=true requires VITE_HOME_WORKFLOW=demo. Backend calls require real authentication.",
    );
  if (publishableKey && !/^pk_(test|live)_[A-Za-z0-9_-]+$/.test(publishableKey))
    throw new Error(
      "VITE_CLERK_PUBLISHABLE_KEY must be a Clerk publishable key (pk_test_… or pk_live_…).",
    );
  if (!development && !publishableKey)
    throw new Error(
      "VITE_CLERK_PUBLISHABLE_KEY is required for production builds and preview.",
    );
  return { development, publishableKey, authBypass, homeWorkflow };
}
export function homeUsesDemo(config: AppConfiguration, search: string) {
  return (
    config.development &&
    (config.homeWorkflow === "demo" ||
      new URLSearchParams(search).get("mode") === "demo")
  );
}
export function parseProxyTarget(value = "http://localhost:8080") {
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error();
    return url.origin;
  } catch {
    throw new Error(
      "DEV_API_PROXY_TARGET must be an HTTP(S) origin, such as http://localhost:8080, without credentials or a path.",
    );
  }
}
