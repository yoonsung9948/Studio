import { acceptedRequest } from "./fixtures/backend";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../app/App";
import { useStore } from "../stores/store";
import { useStudio } from "../studio/selection";
import { interpretationWorkflow } from "../services/interpretation";
import {
  backendJob as associatedJob,
  completedDecisionJob,
  jsonResponse,
} from "./fixtures/backend";
const backendJob = { ...associatedJob, projectId: null };
const completedJob = { ...completedDecisionJob, projectId: null };
beforeEach(() => {
  useStore.getState().reset();
  useStudio.getState().set({
    navigation: false,
    activity: false,
    settings: false,
    account: false,
    palette: false,
  });
});
afterEach(() => {
  interpretationWorkflow.dispose();
  vi.unstubAllGlobals();
});
const mount = (url = "/work") =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <App />
    </MemoryRouter>,
  );
it("keeps the original Home and floating chat controls while submitting them to Go", async () => {
  let finish!: (response: Response) => void;
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse(acceptedRequest(backendJob), 202))
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
  vi.stubGlobal("fetch", fetcher);
  const before = Object.keys(useStore.getState().data.scenes);
  mount();
  expect(screen.queryByLabelText("Home workflow")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Connected projects")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("New project name")).not.toBeInTheDocument();
  expect(screen.getByRole("group", { name: "All work" })).toBeInTheDocument();
  expect(screen.getByLabelText("Home project filter")).toHaveValue("all");
  expect(screen.getByLabelText("Work type")).toHaveValue("shots");
  expect(screen.queryByLabelText("Creation type")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Story duration")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Story project")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Send message" }),
  ).toHaveTextContent("");
  expect(screen.getByRole("button", { name: "Dialogue" })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Story idea"), {
    target: { value: "A letter in a café" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() =>
    expect(useStore.getState().data.backend?.request?.jobId).toBe(
      backendJob.id,
    ),
  );
  expect(
    screen.getByRole("status", { name: "Interpretation status" }),
  ).toHaveTextContent("Queued");
  const submit = screen.getByRole("button", { name: "Send message" });
  expect(submit).toHaveAttribute("aria-disabled", "true");
  fireEvent.click(submit);
  expect(fetcher).toHaveBeenCalledTimes(2);
  finish(jsonResponse(completedJob));
  expect(
    await screen.findByRole("heading", { name: "Proposed action" }),
  ).toBeInTheDocument();
  expect(screen.getByText("A letter changes everything.")).toBeInTheDocument();
  expect(screen.queryByLabelText("Generated video")).not.toBeInTheDocument();
  expect(
    screen.getByText("Proposal only. Nothing has been generated."),
  ).toBeInTheDocument();
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
    projectId: null,
    prompt: "A letter in a café",
  });
  expect(
    fetcher.mock.calls.filter((call) => call[1].method === "POST"),
  ).toHaveLength(1);
  expect(Object.keys(useStore.getState().data.scenes)).toEqual(before);
  expect(screen.getByRole("group", { name: "All work" })).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Board" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close reply" }));
  expect(
    screen.queryByRole("region", { name: "Chat reply" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "View reply" }));
  expect(
    screen.getByRole("region", { name: "Chat reply" }),
  ).toBeInTheDocument();
});
it("keeps backend errors in the chat reply without replacing the background", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error: { code: "unavailable", message: "Database is unavailable." },
        },
        503,
      ),
    ),
  );
  mount();
  fireEvent.change(screen.getByLabelText("Story idea"), {
    target: { value: "A film about rain" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Database is unavailable.",
  );
  expect(screen.getByLabelText("Story idea")).toHaveValue("A film about rain");
  expect(
    within(screen.getByRole("region", { name: "Chat reply" })).getByRole(
      "button",
      { name: "Retry submission" },
    ),
  ).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "All work" })).toBeInTheDocument();
});
it("supports clarification without a brief through the original composer", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(acceptedRequest(backendJob), 202))
      .mockResolvedValueOnce(
        jsonResponse({
          ...completedJob,
          status: "succeeded",
          results: [
            {
              ...completedJob.results![0],
              content: {
                action: "clarification_needed",
                questions: ["How long should it be?"],
                assumptions: [],
              },
            },
          ],
        }),
      ),
  );
  mount();
  fireEvent.change(screen.getByLabelText("Story idea"), {
    target: { value: "A film" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  expect(await screen.findByText("How long should it be?")).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Proposed action" }),
  ).not.toBeInTheDocument();
});
it("retains a separate developer demo entry without a Home mode switch", () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  mount("/work?mode=demo");
  fireEvent.change(screen.getByLabelText("Story idea"), {
    target: { value: "A quiet room" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  expect(screen.getByRole("button", { name: "Scene plan" })).toBeInTheDocument();
  expect(fetcher).not.toHaveBeenCalled();
});

it("keeps Activity observing across page navigation without another submission", async () => {
  let statusSignal!: AbortSignal;
  let finishStatus!: (response: Response) => void;
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse(acceptedRequest(backendJob), 202))
    .mockImplementationOnce((_url, options) => {
      statusSignal = options.signal;
      return new Promise<Response>((resolve, reject) => {
        finishStatus = resolve;
        statusSignal.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
    })
    .mockResolvedValueOnce(jsonResponse(completedJob));
  vi.stubGlobal("fetch", fetcher);
  mount();
  fireEvent.change(screen.getByLabelText("Story idea"), {
    target: { value: "A letter in a café" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole("button", { name: "Assets" }));
  expect(statusSignal.aborted).toBe(false);
  expect(useStore.getState().data.backend?.request).toMatchObject({
    jobId: backendJob.id,
    phase: "polling",
  });
  fireEvent(window, new Event("focus"));
  expect(fetcher).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "Home" }));
  finishStatus(jsonResponse(completedJob));
  expect(
    await screen.findByRole("heading", { name: "Proposed action" }),
  ).toBeInTheDocument();
  expect(
    fetcher.mock.calls.filter(
      (c) => c[0].endsWith("/requests") && c[1].method === "POST",
    ),
  ).toHaveLength(1);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("shows a reconnecting state and offers a status-only retry after a temporary failure", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse(acceptedRequest(backendJob), 202))
    .mockRejectedValueOnce(new TypeError("Offline"))
    .mockResolvedValueOnce(jsonResponse(completedJob));
  vi.stubGlobal("fetch", fetcher);
  mount();
  fireEvent.change(screen.getByLabelText("Story idea"), {
    target: { value: "A letter in a café" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  expect(
    await screen.findByText(
      "Connection interrupted. Status checks will retry automatically.",
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("status", { name: "Interpretation status" }),
  ).toHaveTextContent("Reconnecting");
  fireEvent.click(screen.getByRole("button", { name: "Check now" }));
  expect(
    await screen.findByRole("heading", { name: "Proposed action" }),
  ).toBeInTheDocument();
  expect(fetcher.mock.calls[2][0]).toBe(`/api/v1/jobs/${backendJob.id}`);
  expect(fetcher.mock.calls[2][1].method).toBe("GET");
});
