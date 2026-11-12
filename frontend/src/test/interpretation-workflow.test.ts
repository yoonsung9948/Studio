import { acceptedRequest } from "./fixtures/backend";
import { BackendJobObserver } from "../services/job-observer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InterpretationWorkflow } from "../services/interpretation";
import { useStore, recover } from "../stores/store";
import { backendWorkspace } from "../domain/interpretation";
import {
  backendProject,
  backendJob,
  completedJob,
  interpretation,
  jsonResponse,
} from "./fixtures/backend";
let workflow: InterpretationWorkflow;
beforeEach(() => {
  useStore.getState().reset();
  workflow = new InterpretationWorkflow(new BackendJobObserver({ pollMs: 0 }));
});
afterEach(() => {
  workflow.dispose();
  vi.unstubAllGlobals();
});
const current = () => useStore.getState().data.backend?.request;
it("creates a backend project, saves its job, polls to a brief and never invents scene structure or spends demo credits", async () => {
  const before = structuredClone(useStore.getState().data);
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse(backendProject, 201))
    .mockResolvedValueOnce(jsonResponse(acceptedRequest(backendJob), 202))
    .mockResolvedValueOnce(jsonResponse({ ...backendJob, status: "running" }))
    .mockResolvedValueOnce(jsonResponse(completedJob));
  vi.stubGlobal("fetch", fetcher);
  await workflow.start({
    prompt: " A letter in a café ",
    sourceProjectId: "midnight",
  });
  expect(current()).toMatchObject({
    prompt: "A letter in a café",
    projectId: backendProject.id,
    jobId: backendJob.id,
    phase: "succeeded",
    interpretation,
  });
  const after = useStore.getState().data;
  expect(after.backend?.projects[backendProject.id]).toEqual(backendProject);
  expect(after.scenes).toEqual(before.scenes);
  expect(after.shots).toEqual(before.shots);
  expect(after.credits).toBe(before.credits);
  expect(fetcher).toHaveBeenCalledTimes(4);
});
it("uses an existing backend-issued project and never creates a duplicate project", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse(acceptedRequest(backendJob), 202))
    .mockResolvedValueOnce(jsonResponse(completedJob));
  vi.stubGlobal("fetch", fetcher);
  await workflow.start({ prompt: "A letter", projectId: backendProject.id });
  expect(fetcher.mock.calls[0][0]).toBe("/api/v1/requests");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("replays an interrupted submission with the same key and project", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse(backendProject, 201))
    .mockRejectedValueOnce(new TypeError("Connection dropped"))
    .mockResolvedValueOnce(jsonResponse(acceptedRequest(backendJob), 202))
    .mockResolvedValueOnce(jsonResponse(completedJob));
  vi.stubGlobal("fetch", fetcher);
  await workflow.start({ prompt: "A letter", sourceProjectId: "midnight" });
  const key = current()!.idempotencyKey;
  expect(current()).toMatchObject({
    phase: "failed",
    projectId: backendProject.id,
  });
  await workflow.retry();
  expect(current()?.phase).toBe("succeeded");
  expect(fetcher.mock.calls[1][1].headers.get("Idempotency-Key")).toBe(key);
  expect(fetcher.mock.calls[2][1].headers.get("Idempotency-Key")).toBe(key);
  expect(
    fetcher.mock.calls.filter((c) => c[0] === "/api/v1/projects"),
  ).toHaveLength(1);
});
it("restores optional backend state from the unchanged v3 save and resumes GET polling without resubmitting", async () => {
  useStore.getState().mutate((data) => {
    backendWorkspace(data).request = {
      prompt: "A letter",
      title: "Film",
      idempotencyKey: "saved-key",
      projectId: backendProject.id,
      jobId: backendJob.id,
      phase: "polling",
    };
  });
  const restored = recover(localStorage.getItem("nori-demo-v1"));
  expect(restored.data.backend?.request?.jobId).toBe(backendJob.id);
  useStore.setState({ data: restored.data });
  const fetcher = vi.fn().mockResolvedValue(jsonResponse(completedJob));
  vi.stubGlobal("fetch", fetcher);
  await workflow.resume();
  expect(current()?.phase).toBe("succeeded");
  expect(fetcher.mock.calls[0][0]).toBe(`/api/v1/jobs/${backendJob.id}`);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("shows backend failure and requests a new job with a new key only on explicit retry", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse(acceptedRequest(backendJob), 202))
    .mockResolvedValueOnce(
      jsonResponse({
        ...backendJob,
        status: "failed",
        error: { code: "provider_error", message: "Provider failed." },
      }),
    )
    .mockResolvedValueOnce(
      jsonResponse(
        acceptedRequest({
          ...backendJob,
          id: "40000000-0000-4000-8000-000000000004",
        }),
        202,
      ),
    )
    .mockResolvedValueOnce(
      jsonResponse({
        ...completedJob,
        id: "40000000-0000-4000-8000-000000000004",
      }),
    );
  vi.stubGlobal("fetch", fetcher);
  await workflow.start({ prompt: "A letter", projectId: backendProject.id });
  expect(current()).toMatchObject({
    phase: "failed",
    error: "Provider failed.",
  });
  const previousKey = current()!.idempotencyKey;
  await workflow.retry();
  expect(current()?.idempotencyKey).not.toBe(previousKey);
  expect(current()?.phase).toBe("succeeded");
});
it("accepts clarification-only output and rejects an unsupported completed artifact", async () => {
  const clarification = {
    ...completedJob,
    results: completedJob.results!.map((a) => ({
      ...a,
      content: { assumptions: [], questions: ["What kind of film?"] },
    })),
  };
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(acceptedRequest(backendJob), 202))
      .mockResolvedValueOnce(jsonResponse(clarification))
      .mockResolvedValueOnce(
        jsonResponse(
          acceptedRequest({
            ...backendJob,
            id: "40000000-0000-4000-8000-000000000004",
          }),
          202,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ...completedJob,
          id: "40000000-0000-4000-8000-000000000004",
          results: [],
        }),
      ),
  );
  await workflow.start({ prompt: "Film", projectId: backendProject.id });
  expect(current()?.interpretation).toEqual({
    assumptions: [],
    questions: ["What kind of film?"],
  });
  await workflow.start({
    prompt: "Another film",
    projectId: backendProject.id,
  });
  expect(current()?.phase).toBe("failed");
});
it("does not submit twice while another start is pending, and pausing only aborts status checks", async () => {
  let started!: () => void;
  const polling = new Promise<void>((resolve) => {
    started = resolve;
  });
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse(acceptedRequest(backendJob), 202))
    .mockImplementationOnce((_url, options) => {
      started();
      return new Promise((_resolve, reject) =>
        options.signal.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        ),
      );
    });
  vi.stubGlobal("fetch", fetcher);
  const running = workflow.start({
    prompt: "A letter",
    projectId: backendProject.id,
  });
  await polling;
  await workflow.start({ prompt: "Duplicate", projectId: backendProject.id });
  workflow.stopChecking();
  await running;
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(current()).toMatchObject({ phase: "paused", jobId: backendJob.id });
});
it("rejects demo IDs and empty input before making a network call", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(workflow.start({ prompt: "  " })).rejects.toThrow();
  await expect(
    workflow.start({ prompt: "Film", projectId: "midnight" }),
  ).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});

it("requires deliberate replay of an uncertain submission after page reopening", async () => {
  useStore.getState().mutate((data) => {
    backendWorkspace(data).request = {
      prompt: "A letter",
      title: "Film",
      projectId: backendProject.id,
      idempotencyKey: "uncertain-key",
      phase: "submitting",
    };
  });
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse(acceptedRequest(backendJob), 202))
    .mockResolvedValueOnce(jsonResponse(completedJob));
  vi.stubGlobal("fetch", fetcher);
  await workflow.resume();
  expect(fetcher).not.toHaveBeenCalled();
  expect(current()).toMatchObject({
    phase: "failed",
    errorCode: "submission_uncertain",
  });
  await workflow.retry();
  expect(fetcher.mock.calls[0][1].headers.get("Idempotency-Key")).toBe(
    "uncertain-key",
  );
  expect(current()?.phase).toBe("succeeded");
});
