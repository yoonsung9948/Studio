import { afterEach, expect, it, vi } from "vitest";
import { configureApiSession } from "../api/session";
import { requestJSON } from "../api/client";
import { jsonResponse } from "./fixtures/backend";
let release: (() => void) | undefined;
afterEach(() => {
  release?.();
  release = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("refreshes the bearer token for each API request without persisting it", async () => {
  const token = vi
    .fn()
    .mockResolvedValueOnce("first-token")
    .mockResolvedValueOnce("fresh-token");
  release = configureApiSession(token);
  const fetcher = vi.fn().mockImplementation(async () => jsonResponse({ ok: true }));
  vi.stubGlobal("fetch", fetcher);
  await requestJSON("/me", (v) => v);
  await requestJSON("/me", (v) => v);
  expect(
    fetcher.mock.calls.map((call) => call[1].headers.get("Authorization")),
  ).toEqual(["Bearer first-token", "Bearer fresh-token"]);
});
it("does not send a request when Clerk has no signed-in session", async () => {
  release = configureApiSession(async () => null);
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(requestJSON("/me", (v) => v)).rejects.toMatchObject({
    status: 401,
    code: "unauthenticated",
  });
  expect(fetcher).not.toHaveBeenCalled();
});
it("cancels even while waiting for a token", async () => {
  release = configureApiSession(() => new Promise(() => {}));
  const controller = new AbortController();
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const request = requestJSON("/me", (v) => v, { signal: controller.signal });
  controller.abort();
  await expect(request).rejects.toMatchObject({ name: "AbortError" });
  expect(fetcher).not.toHaveBeenCalled();
});
it("discards a token resolved after sign-out instead of sending it", async () => {
  let resolve!: (token: string) => void;
  release = configureApiSession(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const request = requestJSON("/me", (v) => v);
  release();
  resolve("old-token");
  await expect(request).rejects.toMatchObject({ code: "session_changed" });
  expect(fetcher).not.toHaveBeenCalled();
});
it("discards a response from an account that signed out during the request", async () => {
  release = configureApiSession(async () => "old-token");
  let resolve!: (value: Response) => void;
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((r) => {
        resolve = r;
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  const request = requestJSON("/me", (v) => v);
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
  release();
  resolve(jsonResponse({ private: "old account" }));
  await expect(request).rejects.toMatchObject({ code: "session_changed" });
});
