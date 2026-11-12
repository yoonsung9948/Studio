import { parseEnvironment } from "./environment";
export function readAppConfiguration() {
  return parseEnvironment(
    import.meta.env,
    import.meta.env.DEV && import.meta.env.MODE !== "production",
  );
}
