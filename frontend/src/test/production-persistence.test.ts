import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { configureApiSession } from "../api/session";
import { beginServerWorkspace, useStore } from "../stores/store";
import { ProductionSync, useProductionSave } from "../services/production-sync";
import {
  productionDocument,
  applyProduction,
} from "../services/production-document";
import { createWorkspaceEpisode } from "../domain/workspace";
import { jsonResponse } from "./fixtures/backend";
import type { ProductionDocument } from "../api/production";
const id = "10000000-0000-4000-8000-000000000001";
let release: () => void;
let sync: ProductionSync | undefined;
const initial = (): ProductionDocument => ({
  revision: 0,
  project: {
    id,
    title: "Film",
    description: "",
    cover: "",
    episodeIds: [],
    bible: "",
    defaultDuration: 6,
    revision: 1,
  },
  episodes: [],
  scenes: [],
  shots: [],
  characters: [],
  looks: [],
  locations: [],
  props: [],
  versions: [],
  takes: [],
  setups: [],
  references: [],
  exports: [],
  assets: [],
});
beforeEach(() => {
  vi.stubEnv("VITE_AUTH_BYPASS", "false");
  release = configureApiSession(async () => "token");
  beginServerWorkspace();
});
afterEach(() => {
  sync?.stop();
  sync = undefined;
  release();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("restores editorial hierarchy after a fresh server load and keeps runtime state out of persistence", async () => {
  let saved = initial();
  const requests: RequestInit[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_path: string, options: RequestInit = {}) => {
      if (options.method === "PUT") {
        requests.push(options);
        saved = {
          ...JSON.parse(options.body as string),
          revision: saved.revision + 1,
        };
      }
      return jsonResponse(saved);
    }),
  );
  sync = new ProductionSync();
  await sync.load(id);
  let episodeId = "";
  useStore.getState().mutate((data) => {
    episodeId = createWorkspaceEpisode(data, id, "A quiet cafe.");
    data.credits = 999;
  });
  await sync.ready();
  expect(saved.episodes[0].id).toBe(episodeId);
  expect(saved.scenes.length).toBeGreaterThan(0);
  const payload = JSON.parse(requests[0].body as string);
  expect(payload).not.toHaveProperty("credits");
  expect(payload).not.toHaveProperty("jobs");
  expect(payload).not.toHaveProperty("backend");
  sync.stop();
  beginServerWorkspace();
  sync = new ProductionSync();
  await sync.load(id);
  expect(useStore.getState().data.episodes[episodeId].projectId).toBe(id);
  expect(useStore.getState().data.projects[id].episodeIds).toContain(episodeId);
  expect(useProductionSave.getState().pending).toBe(false);
});
it("keeps unsaved edits after a revision conflict", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_path: string, options: RequestInit = {}) =>
      options.method === "PUT"
        ? jsonResponse(
            {
              error: {
                code: "revision_conflict",
                message: "Changed elsewhere",
              },
            },
            409,
          )
        : jsonResponse(initial()),
    ),
  );
  sync = new ProductionSync();
  await sync.load(id);
  useStore.getState().mutate((data) => {
    data.projects[id].title = "My draft";
  });
  await expect(sync.flush()).rejects.toThrow("Changed elsewhere");
  expect(useStore.getState().data.projects[id].title).toBe("My draft");
  expect(useProductionSave.getState().pending).toBe(true);
});
it("does not project demo jobs or retain signed media URLs in saved documents", () => {
  const data = useStore.getState().data;
  applyProduction(data, initial());
  data.assets.a = {
    id: "a",
    serverAssetId: "80000000-0000-4000-8000-000000000001",
    projectId: id,
    title: "Frame",
    kind: "image",
    url: "/api/v1/downloads/file?token=secret",
    provenance: "Uploaded",
  };
  const document = productionDocument(data, id, 0);
  expect(document.assets[0].url).toBeUndefined();
  expect(document.assets[0].serverAssetId).toBe(data.assets.a.serverAssetId);
  expect(JSON.stringify(document)).not.toContain("secret");
});
it("stopping observation prevents a late production response from repopulating another account", async () => {
  let resolve!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    ),
  );
  sync = new ProductionSync();
  const opening = sync.load(id);
  await vi.waitFor(() => expect(resolve).toBeDefined());
  sync.stop();
  beginServerWorkspace();
  resolve(jsonResponse(initial()));
  await opening;
  expect(useStore.getState().data.projects[id]).toBeUndefined();
});

it("does not replace edits made while a background refresh was in flight", async () => {
  let reply: ((value: Response) => void) | undefined;
  let calls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      if (calls++ === 0) return jsonResponse(initial());
      return new Promise<Response>((resolve) => {
        reply = resolve;
      });
    }),
  );
  sync = new ProductionSync();
  await sync.load(id);
  const refreshing = sync.reload(id);
  await vi.waitFor(() => expect(reply).toBeDefined());
  useStore.getState().mutate((data) => {
    data.projects[id].title = "New unsaved title";
  });
  reply!(jsonResponse(initial()));
  await refreshing;
  expect(useStore.getState().data.projects[id].title).toBe("New unsaved title");
  expect(useProductionSave.getState().pending).toBe(true);
});
