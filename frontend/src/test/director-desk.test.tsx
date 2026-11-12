// Removed-screen UI checks are replaced by produce-workspace and produce-navigation coverage.

import { beforeEach, expect, it } from "vitest";


import { useStore } from "../stores/store";
import { useStudio } from "../studio/selection";
import { tick } from "../domain/commands";
import {
  generationInputs,
  defaultCraft,
  saveGenerationInputs,
} from "../domain/generation-inputs";
import { dataSchema } from "../domain/schemas";

import { seed } from "../mocks/seed";
import { installDirectorProject } from "../mocks/director-project";
import { generateWorkspace, workspacePreflight } from "../domain/workspace";
import { characterReady } from "../domain/studio-selectors";
import { upgradeDemoMedia } from "../mocks/demo-media";

const shotId = "ep1-s2-q2";

beforeEach(() => {
  useStore.getState().reset();
  useStudio.getState().set({
    activity: false,
    navigation: false,
    palette: false,
    account: false,
    settings: false,
  });
});



it("persists structured direction through validation and rejects invalid settings", () => {
  const data = seed();
  saveGenerationInputs(
    data,
    "ep1-s2",
    { craft: { ...defaultCraft, seed: 48291, lens: "35 mm" } },
    shotId,
  );
  const restored = dataSchema.parse(JSON.parse(JSON.stringify(data)));
  expect(generationInputs(restored, "ep1-s2", shotId).craft?.seed).toBe(48291);
  expect(() =>
    saveGenerationInputs(
      data,
      "ep1-s2",
      { craft: { ...defaultCraft, motionStrength: 110 } },
      shotId,
    ),
  ).toThrow();
});

it("upgrades bundled photography without rewriting uploaded image URLs", () => {
  const data = seed();
  data.assets.uploaded = {
    id: "uploaded",
    projectId: "midnight",
    kind: "image",
    title: "My photo",
    url: "https://example.com/private-photo.png",
    provenance: "Uploaded",
  };
  upgradeDemoMedia(data);
  expect(data.assets.uploaded.url).toBe(
    "https://example.com/private-photo.png",
  );
  expect(data.characters.maya.reference).toContain("director-desk/maya.png");
});

it("installs a valid sample with approved references that can generate immediately", () => {
  const data = seed();
  installDirectorProject(data);
  expect(dataSchema.safeParse(data).success).toBe(true);
  expect(characterReady(data, "letter-maya")).toBe(true);
  expect(characterReady(data, "letter-jun")).toBe(true);
  expect(
    workspacePreflight(data, ["letter-reunion-q1"], "image").blockers,
  ).toEqual([]);
  delete data.studio.references["letter-maya-front"];
  installDirectorProject(data);
  expect(characterReady(data, "letter-maya")).toBe(true);
});

it("uses the chosen frame in a demo video instead of replacing it with the scene cover", () => {
  const data = seed();
  installDirectorProject(data);
  const id = "letter-reunion-q3";
  const assetId = data.takes[data.shots[id].imageTakeId!].assetId;
  saveGenerationInputs(
    data,
    "letter-reunion",
    { startingFrameAssetId: assetId, videoMode: "image_first" },
    id,
  );
  generateWorkspace(data, [id], "video");
  for (let i = 0; i < 40; i++) tick(data);
  const take = data.takes[data.shots[id].candidateTakeId!];
  expect(data.assets[take.assetId].url).toBe(data.assets[assetId].url);
});
