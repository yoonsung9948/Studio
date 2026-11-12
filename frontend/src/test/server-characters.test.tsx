import { beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AccountDataProvider } from "../services/server-data";
import { ServerCharacters } from "../studio/assets/ServerCharacters";
import { configureApiSession } from "../api/session";
import { activateWorkspace, useStore } from "../stores/store";
import { bindBackendOwner } from "../domain/interpretation";
import { backendJobObserver } from "../services/job-observer";
import { jsonResponse, backendJob } from "./fixtures/backend";
const owner = "40000000-0000-4000-8000-000000000001",
  id = "50000000-0000-4000-8000-000000000001",
  versionId = "60000000-0000-4000-8000-000000000001",
  assetId = "70000000-0000-4000-8000-000000000001",
  fileId = "80000000-0000-4000-8000-000000000001";
let release: () => void;
beforeEach(() => {
  vi.stubEnv("VITE_AUTH_BYPASS", "false");
  vi.stubEnv("VITE_HOME_WORKFLOW", "api");
  activateWorkspace(owner);
  useStore.getState().mutate((d) => bindBackendOwner(d, owner));
  release = configureApiSession(async () => "token");
});
afterEach(() => {
  cleanup();
  backendJobObserver.dispose();
  release();
  activateWorkspace(null);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("creates a character, generates a stored candidate, selects it, reloads it, and deletes it", async () => {
  let exists = false,
    generated = false,
    selected = false;
  let character = {
    id,
    name: "Untitled character",
    appearance: "",
    notes: "",
    appearanceRevision: 1,
    createdAt: backendJob.createdAt,
    updatedAt: backendJob.updatedAt,
  };
  const detail = () => ({
    ...character,
    canonicalVersionId: selected ? versionId : null,
    views: [
      {
        type: "front",
        selectedVersionId: selected ? versionId : null,
        stale: false,
      },
    ],
  });
  const version = {
    id: versionId,
    characterId: id,
    view: "front",
    assetId,
    producerJobId: backendJob.id,
    appearanceRevision: 1,
    sourceIdentityVersionId: null,
    prompt: "Portrait",
    approval: "needs_review",
    stale: false,
    createdAt: backendJob.createdAt,
  };
  const fetcher = vi.fn(async (path: string, options: RequestInit = {}) => {
    const method = options.method ?? "GET";
    if (path.startsWith("/api/v1/billing/wallet"))
      return jsonResponse({ available: 1000, reserved: 0 });
    if (path.startsWith("/api/v1/jobs?"))
      return jsonResponse({ items: [], nextCursor: null });
    if (path === `/api/v1/jobs/${backendJob.id}`)
      return jsonResponse({
        ...backendJob,
        projectId: null,
        operation: "generate_image",
        status: "succeeded",
        results: [],
        attempts: [],
      });
    if (path === "/api/v1/characters" && method === "POST") {
      exists = true;
      return jsonResponse(detail(), 201);
    }
    if (path === `/api/v1/characters/${id}` && method === "PATCH") {
      character = { ...character, ...JSON.parse(options.body as string) };
      return jsonResponse(detail());
    }
    if (path === `/api/v1/characters/${id}` && method === "DELETE") {
      exists = false;
      return new Response(null, { status: 204 });
    }
    if (path === `/api/v1/characters/${id}/generations`) {
      generated = true;
      return jsonResponse(
        {
          id: versionId,
          characterId: id,
          jobs: [
            { ...backendJob, projectId: null, operation: "generate_image" },
          ],
        },
        202,
      );
    }
    if (path === `/api/v1/characters/${id}/views/front/selection`) {
      selected = true;
      return jsonResponse(detail());
    }
    if (path.startsWith(`/api/v1/characters/${id}/versions`))
      return jsonResponse({
        items: generated ? [version] : [],
        nextCursor: null,
      });
    if (path === `/api/v1/characters/${id}`) return jsonResponse(detail());
    if (path.startsWith("/api/v1/characters?"))
      return jsonResponse({
        items: exists ? [character] : [],
        nextCursor: null,
      });
    if (path === `/api/v1/assets/${assetId}`)
      return jsonResponse({
        id: assetId,
        projectId: null,
        producerJobId: backendJob.id,
        kind: "image",
        createdAt: backendJob.createdAt,
        files: [
          {
            id: fileId,
            assetId,
            role: "original",
            contentType: "image/png",
            sizeBytes: 100,
          },
        ],
      });
    if (path === `/api/v1/asset-files/${fileId}/url`)
      return jsonResponse({
        url: `/api/v1/downloads/${fileId}?token=test`,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      });
    throw Error(`Unexpected ${method} ${path}`);
  });
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
  const mount = () =>
    render(
      <MemoryRouter>
        <AccountDataProvider accountId={owner}>
          <ServerCharacters />
        </AccountDataProvider>
      </MemoryRouter>,
    );
  let view = mount();
  fireEvent.click(await screen.findByRole("button", { name: "New character" }));
  fireEvent.change(await screen.findByLabelText("Character appearance"), {
    target: { value: "Short dark hair" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save character" }));
  await waitFor(() => expect(character.appearance).toBe("Short dark hair"));
  fireEvent.click(screen.getByRole("button", { name: "Generate view" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Use this image" }),
  );
  await waitFor(() => expect(selected).toBe(true));
  view.unmount();
  view = mount();
  fireEvent.click(
    await screen.findByRole("button", { name: "Untitled character" }),
  );
  expect(await screen.findByText(/Selected/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Delete character" }));
  await waitFor(() => expect(exists).toBe(false));
  expect(
    fetcher.mock.calls.some(
      ([path, options]) =>
        path.endsWith("/generations") &&
        new Headers(options?.headers).has("Idempotency-Key"),
    ),
  ).toBe(true);
  view.unmount();
});
