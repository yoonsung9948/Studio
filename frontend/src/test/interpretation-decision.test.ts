import { acceptedRequest } from "./fixtures/backend";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InterpretationWorkflow } from "../services/interpretation";
import { BackendJobObserver } from "../services/job-observer";
import { useStore, recover } from "../stores/store";
import {
  backendJob,
  completedDecisionJob,
  jsonResponse,
} from "./fixtures/backend";

let workflow: InterpretationWorkflow;
const queued = { ...backendJob, projectId: null };
const completed = { ...completedDecisionJob, projectId: null };
beforeEach(() => {
  useStore.getState().reset();
  workflow = new InterpretationWorkflow(new BackendJobObserver({ pollMs: 0 }));
});
afterEach(() => {
  workflow.dispose();
  vi.unstubAllGlobals();
});

it("runs one standalone interpretation and retains the decision across reload", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse(acceptedRequest(queued), 202))
    .mockResolvedValueOnce(
      jsonResponse({ ...queued, status: "running", step: "" }),
    )
    .mockResolvedValueOnce(jsonResponse(completed));
  vi.stubGlobal("fetch", fetcher);
  await workflow.start({ prompt: "A café" });
  expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
    "/api/v1/requests",
    `/api/v1/jobs/${queued.id}`,
    `/api/v1/jobs/${queued.id}`,
  ]);
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
    projectId: null,
    prompt: "A café",
  });
  const restored = recover(localStorage.getItem("nori-demo-v1"));
  expect(restored.data.backend?.request).toMatchObject({
    operation: "interpret_request",
    phase: "succeeded",
    requestId: "50000000-0000-4000-8000-000000000005",
    jobId: queued.id,
    interpretation: {
      action: "propose_operation",
      operation: "generate_video",
    },
  });
  expect(Object.keys(restored.data.backend?.jobs ?? {})).toContain(queued.id);
});

it("resumes a saved standalone interpretation with GET only", async () => {
  useStore.getState().mutate((data) => {
    data.backend = {
      projects: {},
      request: {
        operation: "interpret_request",
        prompt: "A café",
        title: "A café",
        idempotencyKey: "saved-key",
        jobId: queued.id,
        projectId: null,
        phase: "polling",
        durationSeconds: 6,
      },
    };
  });
  const fetcher = vi.fn().mockResolvedValueOnce(jsonResponse(completed));
  vi.stubGlobal("fetch", fetcher);
  await workflow.resume();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe(`/api/v1/jobs/${queued.id}`);
  expect(fetcher.mock.calls[0][1].method).toBe("GET");
  expect(
    useStore.getState().data.backend?.request?.interpretation,
  ).toBeDefined();
});

it("replays an uncertain standalone submission with its original key", async () => {
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("Offline"))
    .mockResolvedValueOnce(jsonResponse(acceptedRequest(queued), 202))
    .mockResolvedValueOnce(jsonResponse(completed));
  vi.stubGlobal("fetch", fetcher);
  await workflow.start({ prompt: "A café" });
  const key = useStore.getState().data.backend?.request?.idempotencyKey;
  await workflow.retry();
  expect(fetcher.mock.calls[0][1].headers.get("Idempotency-Key")).toBe(key);
  expect(fetcher.mock.calls[1][1].headers.get("Idempotency-Key")).toBe(key);
  expect(useStore.getState().data.backend?.request?.phase).toBe("succeeded");
});

it("rejects malformed decisions without submitting another operation", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse(acceptedRequest(queued), 202))
    .mockResolvedValueOnce(
      jsonResponse({
        ...completed,
        results: [
          {
            ...completed.results![0],
            content: {
              action: "propose_operation",
              operation: "generate_video",
              input: null,
              assumptions: [],
            },
          },
        ],
      }),
    );
  vi.stubGlobal("fetch", fetcher);
  await workflow.start({ prompt: "A café" });
  expect(useStore.getState().data.backend?.request).toMatchObject({
    phase: "failed",
    errorCode: "invalid_result",
  });
  expect(
    fetcher.mock.calls.filter((call) => call[1].method === "POST"),
  ).toHaveLength(1);
});

it("does not resume execution of a retired workflow", async () => {
  useStore.getState().mutate((data) => {
    data.backend = {
      projects: {},
      request: {
        operation: "retired_workflow",
        prompt: "A café",
        title: "A café",
        idempotencyKey: "old",
        jobId: queued.id,
        phase: "polling",
      },
    };
  });
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await workflow.resume();
  expect(fetcher).not.toHaveBeenCalled();
  expect(useStore.getState().data.backend?.request).toMatchObject({
    phase: "failed",
    errorCode: "retired_operation",
  });
});
