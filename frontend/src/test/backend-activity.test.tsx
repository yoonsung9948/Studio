import { acceptedRequest } from "./fixtures/backend";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../app/App";
import { useStore } from "../stores/store";
import { useStudio } from "../studio/selection";
import { interpretationWorkflow } from "../services/interpretation";
import { backendJobObserver } from "../services/job-observer";
import {
  backendJob,
  backendProject,
  completedJob,
  jsonResponse,
} from "./fixtures/backend";
const context = {
  prompt: "A letter in a café",
  title: "Café letter",
  idempotencyKey: "original-key",
  sourceProjectId: "midnight",
  creationKind: "scene" as const,
  durationSeconds: 15,
};
beforeEach(() => {
  useStore.getState().reset();
  useStudio.getState().set({
    activity: false,
    navigation: false,
    settings: false,
    account: false,
    palette: false,
  });
});
afterEach(() => {
  interpretationWorkflow.dispose();
  backendJobObserver.dispose();
  vi.unstubAllGlobals();
});
const seedJob = () =>
  useStore.getState().mutate((data) => {
    data.backend = {
      projects: { [backendProject.id]: backendProject },
      projectLinks: { midnight: backendProject.id },
      jobs: {
        [backendJob.id]: {
          id: backendJob.id,
          projectId: backendJob.projectId,
          operation: "interpret_request",
          title: context.title,
          request: context,
        },
      },
    };
  });
const mount = (path = "/projects/browse") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
const tray = () => screen.getByRole("region", { name: "Activity tray" });
const toggle = () =>
  fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
const row = (id = backendJob.id) =>
  within(tray()).getByRole("group", { name: `Backend job ${id}` });
it("tracks while collapsed, shares Home's polling and opens the completed brief through Show", async () => {
  seedJob();
  let finish!: (r: Response) => void;
  const fetcher = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce(jsonResponse(completedJob));
  vi.stubGlobal("fetch", fetcher);
  mount();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Notifications" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  toggle();
  expect(within(row()).getByText("Queued")).toBeInTheDocument();
  expect(within(row()).getByText("Cancel unavailable")).toBeInTheDocument();
  expect(
    within(row()).queryByRole("button", { name: "Cancel" }),
  ).not.toBeInTheDocument();
  toggle();
  finish(jsonResponse({ ...backendJob, status: "running" }));
  await waitFor(() =>
    expect(
      useStore.getState().data.backend?.jobs?.[backendJob.id].job?.status,
    ).toBe("running"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Home" }));
  expect(fetcher).toHaveBeenCalledTimes(1);
  fireEvent(window, new Event("focus"));
  await waitFor(() =>
    expect(
      useStore.getState().data.backend?.jobs?.[backendJob.id].job?.status,
    ).toBe("succeeded"),
  );
  toggle();
  expect(within(row()).getByText("Complete")).toBeInTheDocument();
  fireEvent.click(within(row()).getByRole("button", { name: "Show" }));
  expect(
    await screen.findByRole("heading", { name: "Creative brief" }),
  ).toBeInTheDocument();
  expect(screen.getByText("A letter changes everything.")).toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls.every((c) => c[1].method === "GET")).toBe(true);
});
it("stops local observation when the app closes, preserving the job record", async () => {
  seedJob();
  let signal!: AbortSignal;
  const fetcher = vi.fn().mockImplementation((_url, options) => {
    signal = options.signal;
    return new Promise((_resolve, reject) =>
      signal.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      ),
    );
  });
  vi.stubGlobal("fetch", fetcher);
  const view = mount();
  expect(fetcher).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(signal.aborted).toBe(true);
  fireEvent(window, new Event("focus"));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(useStore.getState().data.backend?.jobs?.[backendJob.id]).toBeDefined();
  expect(fetcher.mock.calls[0][1].method).toBe("GET");
});
it("retries terminal failure with a new key and guards double clicks", async () => {
  seedJob();
  const nextId = "40000000-0000-4000-8000-000000000004";
  let submitted!: (r: Response) => void;
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      jsonResponse({
        ...backendJob,
        status: "failed",
        error: { code: "provider_error", message: "Provider failed" },
      }),
    )
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          submitted = resolve;
        }),
    )
    .mockResolvedValueOnce(jsonResponse({ ...completedJob, id: nextId }));
  vi.stubGlobal("fetch", fetcher);
  mount();
  toggle();
  await waitFor(() =>
    expect(within(row()).getByText("Failed")).toBeInTheDocument(),
  );
  const retry = within(row()).getByRole("button", { name: "Retry" });
  fireEvent.click(retry);
  fireEvent.click(retry);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(fetcher.mock.calls[1][0]).toBe("/api/v1/requests");
  expect(fetcher.mock.calls[1][1].headers.get("Idempotency-Key")).not.toBe(
    context.idempotencyKey,
  );
  submitted(jsonResponse(acceptedRequest({ ...backendJob, id: nextId }), 202));
  await waitFor(() =>
    expect(within(row(nextId)).getByText("Complete")).toBeInTheDocument(),
  );
  expect(fetcher.mock.calls.filter((c) => c[1].method === "POST")).toHaveLength(
    1,
  );
  expect(useStore.getState().data.backend?.request).toMatchObject({
    jobId: nextId,
    creationKind: "scene",
    durationSeconds: 15,
    phase: "succeeded",
  });
});
it("retries an uncertain submission deliberately with its original key", async () => {
  useStore.getState().mutate((data) => {
    data.backend = {
      projects: { [backendProject.id]: backendProject },
      request: {
        ...context,
        projectId: backendProject.id,
        phase: "failed",
        error: "Submission confirmation interrupted",
      },
    };
  });
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse(acceptedRequest(backendJob), 202))
    .mockResolvedValueOnce(jsonResponse(completedJob));
  vi.stubGlobal("fetch", fetcher);
  mount();
  toggle();
  expect(fetcher).not.toHaveBeenCalled();
  const pending = within(tray()).getByRole("group", {
    name: "Backend submission",
  });
  fireEvent.click(
    within(pending).getByRole("button", { name: "Retry submission" }),
  );
  await waitFor(() =>
    expect(within(row()).getByText("Complete")).toBeInTheDocument(),
  );
  expect(fetcher.mock.calls[0][1].headers.get("Idempotency-Key")).toBe(
    context.idempotencyKey,
  );
});
it("surfaces temporary status failures and Check now performs GET only", async () => {
  seedJob();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      jsonResponse(
        { error: { code: "unavailable", message: "Try later" } },
        503,
      ),
    )
    .mockResolvedValueOnce(jsonResponse(completedJob));
  vi.stubGlobal("fetch", fetcher);
  mount();
  toggle();
  await waitFor(() =>
    expect(within(row()).getByText("Reconnecting")).toBeInTheDocument(),
  );
  fireEvent.click(within(row()).getByRole("button", { name: "Check now" }));
  await waitFor(() =>
    expect(within(row()).getByText("Complete")).toBeInTheDocument(),
  );
  expect(fetcher.mock.calls.every((c) => c[1].method === "GET")).toBe(true);
});
it("filters backend rows using the local-to-backend project mapping", async () => {
  seedJob();
  const otherId = "50000000-0000-4000-8000-000000000005",
    otherProject = "60000000-0000-4000-8000-000000000006";
  useStore.getState().mutate((data) => {
    data.backend!.jobs![otherId] = {
      id: otherId,
      projectId: otherProject,
      operation: "interpret_request",
      title: "Other project",
    };
  });
  const fetcher = vi.fn((url: string) =>
    Promise.resolve(
      jsonResponse(
        url.endsWith(otherId)
          ? { ...completedJob, id: otherId, projectId: otherProject }
          : completedJob,
      ),
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  mount("/projects/midnight/episodes");
  toggle();
  expect(row()).toBeInTheDocument();
  expect(
    within(tray()).queryByRole("group", { name: `Backend job ${otherId}` }),
  ).not.toBeInTheDocument();
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
});

it("keeps saved permanent status errors stopped until an explicit GET retry", async () => {
  seedJob();
  useStore.getState().mutate((data) => {
    data.backend!.jobs![backendJob.id].observationError = {
      code: "unauthorized",
      message: "Sign in again",
    };
    data.backend!.request = {
      ...context,
      projectId: backendProject.id,
      jobId: backendJob.id,
      phase: "failed",
      jobStatus: "queued",
      error: "Sign in again",
    };
  });
  const fetcher = vi.fn().mockResolvedValue(jsonResponse(completedJob));
  vi.stubGlobal("fetch", fetcher);
  mount();
  toggle();
  expect(fetcher).not.toHaveBeenCalled();
  expect(within(row()).getByText("Needs attention")).toBeInTheDocument();
  fireEvent.click(
    within(row()).getByRole("button", { name: "Retry status check" }),
  );
  await waitFor(() =>
    expect(within(row()).getByText("Complete")).toBeInTheDocument(),
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][1].method).toBe("GET");
  expect(useStore.getState().data.backend?.request).toMatchObject({
    phase: "succeeded",
    idempotencyKey: context.idempotencyKey,
  });
});

it("does not lose an uncertain submission key when Show selects a different job", () => {
  seedJob();
  useStore.getState().mutate((data) => {
    data.backend!.jobs![backendJob.id].job = completedJob;
    data.backend!.request = {
      ...context,
      idempotencyKey: "uncertain-new-request",
      projectId: backendProject.id,
      phase: "failed",
      errorCode: "submission_uncertain",
      error: "Confirmation interrupted",
    };
  });
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  mount();
  toggle();
  fireEvent.click(within(row()).getByRole("button", { name: "Show" }));
  expect(useStore.getState().data.backend?.request?.idempotencyKey).toBe(
    "uncertain-new-request",
  );
  expect(
    screen.getByText(
      "Finish or retry the pending submission before opening another request.",
    ),
  ).toBeInTheDocument();
  expect(fetcher).not.toHaveBeenCalled();
});
