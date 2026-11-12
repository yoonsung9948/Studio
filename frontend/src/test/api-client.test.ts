import { acceptedRequest } from "./fixtures/backend";
import { afterEach, expect, it, vi } from "vitest";
import { createProject } from "../api/projects";
import { getJob } from "../api/jobs";
import { submitRequest } from "../api/requests";
import { requestJSON, ApiError } from "../api/client";
import { backendProject, backendJob, jsonResponse } from "./fixtures/backend";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("uses the same-origin API prefix and cookie session, preserving backend IDs", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse(backendProject, 201))
    .mockResolvedValueOnce(jsonResponse(acceptedRequest(backendJob), 202))
    .mockResolvedValueOnce(jsonResponse(backendJob));
  vi.stubGlobal("fetch", fetcher);
  expect(await createProject({ title: "First film" })).toEqual(backendProject);
  await submitRequest(
    { projectId: backendProject.id, prompt: "A letter in a café" },
    "stable-key",
  );
  await getJob(backendJob.id);
  expect(fetcher.mock.calls.map((c) => c[0])).toEqual([
    "/api/v1/projects",
    "/api/v1/requests",
    `/api/v1/jobs/${backendJob.id}`,
  ]);
  const options = fetcher.mock.calls[1][1];
  expect(options.credentials).toBe("include");
  expect(options.headers.get("Idempotency-Key")).toBe("stable-key");
  expect(JSON.parse(options.body)).toEqual({
    projectId: backendProject.id,
    prompt: "A letter in a café",
  });
});
it("preserves structured API errors and identifies expired sessions", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { error: { code: "unauthorized", message: "Sign in again." } },
          401,
        ),
      ),
  );
  await expect(createProject({ title: "Film" })).rejects.toMatchObject({
    status: 401,
    code: "unauthorized",
    message: "Sign in again.",
    sessionExpired: true,
  });
});
it("rejects SPA HTML and malformed backend data instead of treating them as success", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(new Response("<html>SPA fallback</html>"))
      .mockResolvedValueOnce(jsonResponse({ id: "demo-project" })),
  );
  await expect(createProject({ title: "Film" })).rejects.toMatchObject({
    code: "invalid_response",
  });
  await expect(createProject({ title: "Film" })).rejects.toMatchObject({
    code: "invalid_response",
  });
});
it("passes cancellation to fetch without disguising it as a network failure", async () => {
  const controller = new AbortController();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url, options) =>
        new Promise((_resolve, reject) =>
          options.signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          ),
        ),
    ),
  );
  const request = createProject({ title: "Film" }, controller.signal);
  controller.abort();
  await expect(request).rejects.toMatchObject({ name: "AbortError" });
});
it("bounds a stalled request with a useful timeout", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url, options) =>
        new Promise((_resolve, reject) =>
          options.signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          ),
        ),
    ),
  );
  const request = requestJSON("/projects", (v) => v, { timeoutMs: 20 }).catch(
    (error) => error,
  );
  await vi.advanceTimersByTimeAsync(20);
  expect(await request).toBeInstanceOf(ApiError);
  expect(await request).toMatchObject({ code: "request_timeout" });
});
it("does not retry POSTs automatically after a connection error", async () => {
  const fetcher = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
  vi.stubGlobal("fetch", fetcher);
  await expect(createProject({ title: "Film" })).rejects.toMatchObject({
    code: "network_error",
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("reports interrupted response bodies as temporary connection failures", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: () =>
        Promise.reject(new TypeError("Connection reset while reading")),
    }),
  );
  await expect(createProject({ title: "Film" })).rejects.toMatchObject({
    status: 0,
    code: "network_error",
  });
});

it("supports standalone jobs and nullable local-execution metadata", async () => {
  const standalone = {
    ...backendJob,
    projectId: null,
    attempts: [
      {
        number: 1,
        provider: null,
        model: null,
        status: "succeeded",
        startedAt: backendJob.createdAt,
      },
    ],
  };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse(acceptedRequest(standalone), 202))
    .mockResolvedValueOnce(jsonResponse(standalone));
  vi.stubGlobal("fetch", fetcher);
  const submitted = await submitRequest({ prompt: "Film" }, "standalone-key");
  expect(submitted.request.projectId).toBeNull();
  expect(fetcher.mock.calls[0][0]).toBe("/api/v1/requests");
  expect(JSON.parse(fetcher.mock.calls[0][1].body).projectId).toBeNull();
  expect((await getJob(standalone.id)).attempts[0].provider).toBeNull();
});
