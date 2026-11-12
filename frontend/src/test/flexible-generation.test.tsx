// Removed-screen UI checks are replaced by produce-workspace and produce-navigation coverage.
import { beforeEach, expect, it } from "vitest";



import { useStore } from "../stores/store";
import { useStudio, useSelection } from "../studio/selection";

import { prepareVideoGeneration } from "../domain/video-workflow";
import { enqueueGeneration, updateScript } from "../domain/commands";
import { saveGenerationInputs } from "../domain/generation-inputs";
import { shotsOfEpisode } from "../domain/selectors";
import { scenePreflight } from "../domain/scene-preflight";
import { scriptApproved, scenePlanApproved } from "../domain/workflow";
beforeEach(() => {
  useStore.getState().reset();
  useSelection.getState().replace([]);
  useStudio.getState().set({
    view: "board",
    activity: false,
    inspector: true,
    inspectorTab: "properties",
    palette: false,
    settings: false,
  });
});
function freshEpisode() {
  useStore.getState().mutate((d) => {
    d.episodes.fresh = {
      ...d.episodes.ep1,
      id: "fresh",
      title: "A doorway",
      script: "INT. ROOM — NIGHT\nMaya opens the door.",
      scriptRevision: 1,
      scriptApprovedRevision: undefined,
      scriptHistory: [],
      sceneIds: [],
      targetSeconds: 15,
    };
    d.projects.midnight.episodeIds.push("fresh");
  });
}






it("rejects missing or cross-project conditioning without charging and snapshots valid start/end frames", () => {
  freshEpisode();
  useStore.getState().mutate((d) => prepareVideoGeneration(d, "fresh"));
  const d = structuredClone(useStore.getState().data),
    shot = shotsOfEpisode(d, "fresh")[0];
  const asset = Object.values(d.assets).find(
    (a) => a.kind === "image" && a.projectId === "midnight" && a.url,
  )!;
  expect(() =>
    saveGenerationInputs(
      d,
      shot.sceneId,
      { endingFrameAssetId: asset.id },
      shot.id,
    ),
  ).toThrow(/starting frame/);
  saveGenerationInputs(
    d,
    shot.sceneId,
    { startingFrameAssetId: asset.id, endingFrameAssetId: asset.id },
    shot.id,
  );
  const credits = d.credits;
  d.assets[asset.id].missing = true;
  expect(scenePreflight(d, shot.sceneId).ready).toBe(false);
  expect(() => enqueueGeneration(d, [shot.id])).toThrow(/conditioning frame/);
  expect(d.credits).toBe(credits);
});

it("uses a revised script directly while retaining scene IDs and existing footage", () => {
  const d = structuredClone(useStore.getState().data);
  const ids = [...d.episodes.ep1.sceneIds];
  const takeId = d.shots["ep1-s1-q1"].currentTakeId;
  updateScript(d, "ep1", "INT. APARTMENT — NIGHT\nMaya hears a new recording.");
  prepareVideoGeneration(d, "ep1", undefined, true);
  expect(scriptApproved(d.episodes.ep1)).toBe(true);
  expect(d.episodes.ep1.sceneIds).toEqual(ids);
  expect(ids.every((id) => scenePlanApproved(d, id))).toBe(true);
  expect(d.shots["ep1-s1-q1"].currentTakeId).toBe(takeId);
});
