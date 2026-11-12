import { expect, it } from "vitest";
import {
  parseEnvironment,
  parseProxyTarget,
  homeUsesDemo,
} from "../config/environment";
const key = "pk_test_example";
it("uses safe defaults for normal development and production", () => {
  expect(
    parseEnvironment({ VITE_CLERK_PUBLISHABLE_KEY: key }, true),
  ).toMatchObject({
    authBypass: false,
    homeWorkflow: "api",
    publishableKey: key,
  });
  expect(
    parseEnvironment({ VITE_CLERK_PUBLISHABLE_KEY: key }, false),
  ).toMatchObject({ authBypass: false, homeWorkflow: "api" });
});
it("allows bypass without a Clerk key only when local demo workflow is selected", () => {
  expect(
    parseEnvironment(
      { VITE_AUTH_BYPASS: "true", VITE_HOME_WORKFLOW: "demo" },
      true,
    ),
  ).toMatchObject({ authBypass: true, homeWorkflow: "demo" });
  expect(() => parseEnvironment({ VITE_AUTH_BYPASS: "true" }, true)).toThrow(
    /requires VITE_HOME_WORKFLOW=demo/,
  );
});
it.each(["TRUE", "1", "yes", "", "false "])(
  "rejects ambiguous bypass value %s",
  (value) => {
    expect(() => parseEnvironment({ VITE_AUTH_BYPASS: value }, true)).toThrow(
      /true or false/,
    );
  },
);
it("rejects bypass, demo workflows and missing authentication keys outside the dev server", () => {
  expect(() =>
    parseEnvironment(
      {
        VITE_AUTH_BYPASS: "true",
        VITE_HOME_WORKFLOW: "demo",
        VITE_CLERK_PUBLISHABLE_KEY: key,
      },
      false,
    ),
  ).toThrow(/only allowed/);
  expect(() =>
    parseEnvironment(
      { VITE_HOME_WORKFLOW: "demo", VITE_CLERK_PUBLISHABLE_KEY: key },
      false,
    ),
  ).toThrow(/Production requires/);
  expect(() => parseEnvironment({}, false)).toThrow(/required for production/);
});
it("rejects invalid workflow modes and non-publishable keys", () => {
  expect(() => parseEnvironment({ VITE_HOME_WORKFLOW: "mock" }, true)).toThrow(
    /api or demo/,
  );
  expect(() =>
    parseEnvironment({ VITE_CLERK_PUBLISHABLE_KEY: "wrong-key" }, true),
  ).toThrow(/publishable key/);
});
it("supports the development URL override but ignores it in production", () => {
  const development = parseEnvironment({}, true);
  const production = parseEnvironment(
    { VITE_CLERK_PUBLISHABLE_KEY: key },
    false,
  );
  expect(homeUsesDemo(development, "?mode=demo")).toBe(true);
  expect(homeUsesDemo(production, "?mode=demo")).toBe(false);
  expect(
    homeUsesDemo(parseEnvironment({ VITE_HOME_WORKFLOW: "demo" }, true), ""),
  ).toBe(true);
});
it("accepts HTTP proxy origins and rejects path rewrites and credentials", () => {
  expect(parseProxyTarget()).toBe("http://localhost:8080");
  expect(parseProxyTarget("https://api.example.com/")).toBe(
    "https://api.example.com",
  );
  for (const value of [
    "invalid",
    "file:///tmp/api",
    "http://user:secret@localhost:8080",
    "http://localhost:8080/api",
    "http://localhost:8080?key=x",
  ])
    expect(() => parseProxyTarget(value)).toThrow(/HTTP\(S\) origin/);
});
