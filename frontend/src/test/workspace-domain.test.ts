import { expect, it } from "vitest";
import { seed } from "../mocks/seed";
import {
  createWorkspaceEpisode,
  createHomeDraft,
  generateWorkspace,
  workspacePreflight,
  changeShotCamera,
  createWorldElement,
  changeWorldAsset,
  assignWorld,
} from "../domain/workspace";
import { tick } from "../domain/commands";
import { recover, useStore } from "../stores/store";
it("conditions Animate on the generated still and captures camera and World inputs immutably", () => {
  const d = seed(),
    eid = createWorkspaceEpisode(
      d,
      "midnight",
      "INT. ROOM — NIGHT\nA phone rings.",
      15,
    ),
    s = d.shots[d.scenes[d.episodes[eid].sceneIds[0]].shotIds[0]];
  const prop = createWorldElement(d, "midnight", "prop", "Recorder"),
    asset = Object.values(d.assets).find(
      (a) => a.projectId === "midnight" && a.kind === "image",
    )!;
  changeWorldAsset(d, "midnight", prop, asset.id);
  assignWorld(d, [s.id], "prop", prop);
  changeShotCamera(d, s.id, { framing: "Close-up", movement: "Push in" });
  generateWorkspace(d, [s.id], "image");
  for (let i = 0; i < 20; i++) tick(d);
  const still = d.takes[s.imageTakeId!];
  expect(still).toBeTruthy();
  generateWorkspace(d, [s.id], "video");
  const job = Object.values(d.jobs).find(
    (j) => j.shotId === s.id && j.operation === "video",
  )!;
  expect(job.inputs?.startingFrameAssetId).toBe(still.assetId);
  expect(job.inputs?.camera?.framing).toBe("Close-up");
  expect(job.inputs?.worldElements?.[0].id).toBe(prop);
  d.projects.midnight.worldElements![0].name = "Changed";
  expect(job.inputs?.worldElements?.[0].name).toBe("Recorder");
});
it("keeps zero-cost preparation pure and permits opting back into strict approvals", () => {
  const d = seed(),
    eid = createWorkspaceEpisode(
      d,
      "midnight",
      "INT. ROOM — NIGHT\nA phone rings.",
      15,
    ),
    sid = d.episodes[eid].sceneIds[0],
    id = d.scenes[sid].shotIds[0],
    before = JSON.stringify(d);
  expect(workspacePreflight(d, [id], "image").blockers).toHaveLength(0);
  expect(JSON.stringify(d)).toBe(before);
  d.projects.midnight.strictApprovals = true;
  expect(
    workspacePreflight(d, [id], "image").blockers.some(
      (b) => b.fix === "Approve source",
    ),
  ).toBe(true);
});
it("round-trips optional studio fields under the existing v3 storage contract", () => {
  const d = seed();
  d.projects.midnight.strictApprovals = true;
  d.projects.midnight.worldElements = [
    {
      id: "recorder",
      kind: "prop",
      name: "Recorder",
      description: "Vintage",
      assetId: Object.keys(d.assets)[0],
    },
  ];
  d.shots["ep1-s1-q1"].locked = true;
  const saved = recover(
    JSON.stringify({
      version: 3,
      data: d,
      ui: {
        theme: "dark",
        collapsed: false,
        aiOpen: false,
        layouts: {},
        selectedShots: {},
        density: "compact",
        inspectorAdvanced: true,
      },
    }),
  );
  expect(saved.notice).toBe("");
  expect(saved.data.projects.midnight.strictApprovals).toBe(true);
  expect(saved.data.shots["ep1-s1-q1"].locked).toBe(true);
  expect(saved.ui.density).toBe("compact");
});
it("keeps unfiled shot and scene drafts within the existing v3 engine", () => {
  const d = seed(),
    credits = d.credits,
    jobs = Object.keys(d.jobs);
  const shot = createHomeDraft(
    d,
    "An umbrella in the rain",
    "shot",
    undefined,
    20,
  );
  const scene = createHomeDraft(
    d,
    "A reunion at the station",
    "scene",
    undefined,
    15,
  );
  expect(scene.projectId).toBe(shot.projectId);
  expect(d.projects[shot.projectId].unfiled).toBe(true);
  expect(d.scenes[shot.sceneId].shotIds).toEqual([shot.shotId]);
  expect(d.shots[shot.shotId].targetFrames).toBe(600);
  expect(d.episodes[scene.episodeId].sceneIds).toHaveLength(1);
  expect(d.credits).toBe(credits);
  expect(Object.keys(d.jobs)).toEqual(jobs);
  const restored = recover(
    JSON.stringify({ version: 3, data: d, ui: useStore.getState().ui }),
  );
  expect(restored?.data.projects[shot.projectId].unfiled).toBe(true);
  expect(restored?.data.episodes[shot.episodeId].creationKind).toBe("shot");
});
