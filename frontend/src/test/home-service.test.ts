import { acceptedRequest } from "./fixtures/backend";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { submitHomeRequest } from "../services/home";
import { interpretationWorkflow } from "../services/interpretation";
import { useStore, recover } from "../stores/store";
import {
  backendProject,
  backendJob,
  completedDecisionJob as completedJob,
  jsonResponse,
} from "./fixtures/backend";
beforeEach(() => useStore.getState().reset());
afterEach(() => {
  interpretationWorkflow.dispose();
  vi.unstubAllGlobals();
});
it("maps a selected local project to a backend project and reuses that mapping after reload", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse(backendProject, 201))
    .mockResolvedValueOnce(jsonResponse(acceptedRequest(backendJob), 202))
    .mockResolvedValueOnce(jsonResponse(completedJob))
    .mockResolvedValueOnce(jsonResponse(acceptedRequest(backendJob), 202))
    .mockResolvedValueOnce(jsonResponse(completedJob));
  vi.stubGlobal("fetch", fetcher);
  await submitHomeRequest({
    prompt: "A café",
    projectId: "midnight",
    creationKind: "shot",
    durationSeconds: 8,
  });
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
    title: "Midnight Secrets",
  });
  expect(fetcher.mock.calls[1][0]).toBe("/api/v1/requests");
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
    projectId: backendProject.id,
    prompt: "A café",
  });
  expect(useStore.getState().data.backend?.request).toMatchObject({
    creationKind: "shot",
    durationSeconds: 8,
    sourceProjectId: "midnight",
  });
  const restored = recover(localStorage.getItem("nori-demo-v1"));
  expect(restored.data.backend?.projectLinks?.midnight).toBe(backendProject.id);
  useStore.setState({ data: restored.data });
  await submitHomeRequest({
    prompt: "Another café",
    projectId: "midnight",
    creationKind: "scene",
    durationSeconds: 15,
  });
  expect(fetcher.mock.calls[3][0]).toBe("/api/v1/requests");
  expect(
    fetcher.mock.calls.filter((c) => c[0] === "/api/v1/projects"),
  ).toHaveLength(1);
});
it("never forwards an unrecognized project choice to the API", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(
    submitHomeRequest({
      prompt: "A film",
      projectId: "unknown",
      creationKind: "episode",
      durationSeconds: 30,
    }),
  ).rejects.toThrow("Choose an existing project");
  expect(fetcher).not.toHaveBeenCalled();
});
