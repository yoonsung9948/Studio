// Removed-screen UI checks are replaced by produce-workspace and produce-navigation coverage.
import { beforeEach, expect, it } from "vitest";



import { useStore } from "../stores/store";
import { useSelection, useStudio } from "../studio/selection";
import { installDirectorProject } from "../mocks/director-project";
import {
  boardShotStatus,
  sceneReadiness,
} from "../studio/episode-board/scene-presentation";



beforeEach(() => {
  useStore.getState().reset();
  useStore.getState().mutate(installDirectorProject);
  useSelection.getState().replace([]);
  useStudio.getState().set({
    activity: false,
    settings: false,
    account: false,
    palette: false,
    inspector: false,
    inspectorTab: "properties",
    view: "board",
  });
});













it("distinguishes frame availability, unreviewed video, and approved footage", () => {
  const data = structuredClone(useStore.getState().data),
    shot = data.shots["letter-reunion-q1"];
  expect(boardShotStatus(data, shot).label).toBe("Frame ready");
  expect(sceneReadiness(data, "letter-reunion").frames).toBe(3);
  const frame = data.takes[shot.imageTakeId!];
  data.takes["video-test"] = {
    ...frame,
    id: "video-test",
    kind: "video",
    approved: false,
  };
  shot.candidateTakeId = "video-test";
  expect(boardShotStatus(data, shot).label).toBe("Review video");
  expect(sceneReadiness(data, "letter-reunion").videos).toBe(0);
  data.takes["video-test"].approved = true;
  shot.currentTakeId = "video-test";
  expect(boardShotStatus(data, shot).label).toBe("Video ready");
  shot.stale = true;
  expect(boardShotStatus(data, shot).label).toBe("Needs update");
  expect(sceneReadiness(data, "letter-reunion").videos).toBe(0);
});




