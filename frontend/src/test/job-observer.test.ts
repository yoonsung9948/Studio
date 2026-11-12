import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BackendJobObserver } from "../services/job-observer";
import { useStore, recover } from "../stores/store";
import { backendJob, completedJob, jsonResponse } from "./fixtures/backend";
const identity = {
  id: backendJob.id,
  projectId: backendJob.projectId,
  operation: backendJob.operation,
};
let observer: BackendJobObserver;
let fetcher: ReturnType<typeof vi.fn>;
const listener = () => ({ onJob: vi.fn(), onError: vi.fn() });
const flush = () => vi.advanceTimersByTimeAsync(0);
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  useStore.getState().reset();
  observer = new BackendJobObserver({
    pollMs: 100,
    backoffMs: 1000,
    maxBackoffMs: 4000,
  });
  fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  observer.dispose();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it("shares one poll per job, keeps remaining watchers, and stops permanently on completion", async () => {
  fetcher
    .mockResolvedValueOnce(jsonResponse(backendJob))
    .mockResolvedValueOnce(jsonResponse(completedJob));
  const a = listener(),
    b = listener();
  const stopA = observer.watch(identity, a),
    stopB = observer.watch(identity, b);
  await flush();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(a.onJob).toHaveBeenCalledTimes(1);
  expect(b.onJob).toHaveBeenCalledTimes(1);
  stopA();
  await vi.advanceTimersByTimeAsync(100);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(a.onJob).toHaveBeenCalledTimes(1);
  expect(b.onJob).toHaveBeenLastCalledWith(completedJob);
  window.dispatchEvent(new Event("focus"));
  await vi.advanceTimersByTimeAsync(60000);
  expect(fetcher).toHaveBeenCalledTimes(2);
  stopB();
});
it("backs off temporary transport and server failures, caps the delay and resets after success", async () => {
  fetcher
    .mockRejectedValueOnce(new TypeError("offline"))
    .mockResolvedValueOnce(
      jsonResponse(
        { error: { code: "unavailable", message: "Unavailable" } },
        503,
      ),
    )
    .mockResolvedValueOnce(
      jsonResponse({ error: { code: "rate_limit", message: "Busy" } }, 429),
    )
    .mockResolvedValueOnce(
      jsonResponse(
        { error: { code: "unavailable", message: "Unavailable" } },
        503,
      ),
    )
    .mockResolvedValueOnce(jsonResponse(backendJob))
    .mockResolvedValueOnce(jsonResponse(completedJob));
  const l = listener();
  observer.watch(identity, l);
  await flush();
  expect(l.onError).toHaveBeenLastCalledWith(
    expect.objectContaining({ temporary: true, retryAt: Date.now() + 1000 }),
  );
  await vi.advanceTimersByTimeAsync(999);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(fetcher).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1999);
  expect(fetcher).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(fetcher).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(4000);
  expect(fetcher).toHaveBeenCalledTimes(4);
  await vi.advanceTimersByTimeAsync(4000);
  expect(fetcher).toHaveBeenCalledTimes(5);
  expect(useStore.getState().data.backend?.jobs?.[backendJob.id]).toMatchObject(
    { consecutiveFailures: 0, job: backendJob },
  );
  expect(
    useStore.getState().data.backend?.jobs?.[backendJob.id].observationError,
  ).toBeUndefined();
  await vi.advanceTimersByTimeAsync(100);
  expect(fetcher).toHaveBeenCalledTimes(6);
});
it("refreshes on focus and visibility, bypasses backoff, and never overlaps an in-flight GET", async () => {
  let finish!: (value: Response) => void;
  fetcher
    .mockRejectedValueOnce(new TypeError("offline"))
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
  observer.watch(identity, listener());
  await flush();
  window.dispatchEvent(new Event("focus"));
  await flush();
  expect(fetcher).toHaveBeenCalledTimes(2);
  window.dispatchEvent(new Event("focus"));
  document.dispatchEvent(new Event("visibilitychange"));
  await flush();
  expect(fetcher).toHaveBeenCalledTimes(2);
  finish(jsonResponse(backendJob));
  await flush();
  fetcher.mockResolvedValueOnce(jsonResponse(completedJob));
  document.dispatchEvent(new Event("visibilitychange"));
  await flush();
  expect(fetcher).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(5000);
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it("supports a deliberate status retry while keeping terminal job failures terminal", async () => {
  fetcher
    .mockResolvedValueOnce(
      jsonResponse(
        { error: { code: "unauthorized", message: "Sign in again" } },
        401,
      ),
    )
    .mockResolvedValueOnce(
      jsonResponse({
        ...backendJob,
        status: "failed",
        error: { code: "provider_error", message: "Provider failed" },
      }),
    );
  const l = listener();
  observer.watch(identity, l);
  await flush();
  expect(l.onError).toHaveBeenLastCalledWith(
    expect.objectContaining({ temporary: false, code: "unauthorized" }),
  );
  window.dispatchEvent(new Event("focus"));
  await vi.advanceTimersByTimeAsync(10000);
  expect(fetcher).toHaveBeenCalledTimes(1);
  observer.refresh(backendJob.id);
  await flush();
  expect(l.onJob).toHaveBeenLastCalledWith(
    expect.objectContaining({ status: "failed" }),
  );
  observer.refresh(backendJob.id);
  window.dispatchEvent(new Event("focus"));
  await vi.advanceTimersByTimeAsync(10000);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls.every((c) => c[1].method === "GET")).toBe(true);
});
it("aborts only the last watcher’s GET and ignores a late response after release", async () => {
  let finish!: (value: Response) => void;
  fetcher.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  const a = listener(),
    b = listener();
  const stopA = observer.watch(identity, a),
    stopB = observer.watch(identity, b);
  const signal = fetcher.mock.calls[0][1].signal;
  stopA();
  expect(signal.aborted).toBe(false);
  stopB();
  expect(signal.aborted).toBe(true);
  finish(jsonResponse(completedJob));
  await flush();
  window.dispatchEvent(new Event("focus"));
  await vi.advanceTimersByTimeAsync(10000);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(a.onJob).not.toHaveBeenCalled();
  expect(b.onJob).not.toHaveBeenCalled();
  expect(
    useStore.getState().data.backend?.jobs?.[backendJob.id].job,
  ).toBeUndefined();
});
it("clears scheduled retries when the page closes, and resumes on a back-forward page restore", async () => {
  fetcher
    .mockRejectedValueOnce(new TypeError("offline"))
    .mockResolvedValueOnce(jsonResponse(completedJob));
  observer.watch(identity, listener());
  await flush();
  window.dispatchEvent(new Event("pagehide"));
  await vi.advanceTimersByTimeAsync(60000);
  expect(fetcher).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new Event("pageshow"));
  await flush();
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("persists observed terminal jobs and reuses their results without polling after reload", async () => {
  fetcher.mockResolvedValueOnce(jsonResponse(completedJob));
  const stop = observer.watch(identity, listener());
  await flush();
  stop();
  const restored = recover(localStorage.getItem("nori-demo-v1"));
  useStore.setState({ data: restored.data });
  const l = listener();
  observer.watch(identity, l);
  await flush();
  expect(l.onJob).toHaveBeenCalledWith(completedJob);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("tracks distinct backend jobs independently and rejects mismatched responses", async () => {
  const second = { ...identity, id: "40000000-0000-4000-8000-000000000004" };
  fetcher
    .mockResolvedValueOnce(jsonResponse(completedJob))
    .mockResolvedValueOnce(jsonResponse(completedJob));
  const a = listener(),
    b = listener();
  observer.watch(identity, a);
  observer.watch(second, b);
  await flush();
  expect(a.onJob).toHaveBeenCalledWith(completedJob);
  expect(b.onError).toHaveBeenCalledWith(
    expect.objectContaining({ code: "job_mismatch", temporary: false }),
  );
  expect(Object.keys(useStore.getState().data.backend!.jobs!)).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(10000);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("reference-counts separate watches even when they reuse the same callbacks", async () => {
  fetcher
    .mockResolvedValueOnce(jsonResponse(backendJob))
    .mockResolvedValueOnce(jsonResponse(completedJob));
  const shared = listener();
  const first = observer.watch(identity, shared),
    second = observer.watch(identity, shared);
  await flush();
  first();
  await vi.advanceTimersByTimeAsync(100);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(shared.onJob).toHaveBeenLastCalledWith(completedJob);
  second();
});
