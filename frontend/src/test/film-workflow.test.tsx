// Removed-screen UI checks are replaced by produce-workspace and produce-navigation coverage.

import { beforeEach, expect, it } from "vitest";


import { useStore } from "../stores/store";
import { useSelection, useStudio } from "../studio/selection";
import { installDirectorProject } from "../mocks/director-project";
import { dataSchema } from "../domain/schemas";
import { splitEditClip, insertEditMedia } from "../domain/episode-edit";




beforeEach(() => {
  useStore.getState().reset();
  useStore.getState().mutate(installDirectorProject);
  useSelection.getState().replace([]);
  useStudio
    .getState()
    .set({
      activity: false,
      settings: false,
      account: false,
      palette: false,
      outline: false,
      inspector: false,
      view: "board",
    });
});






it("preserves immutable media and take ownership when splitting an approved video", () => {
  const data = structuredClone(useStore.getState().data),
    shot = data.shots["ep1-s1-q1"];
  const take = structuredClone(data.takes[shot.currentTakeId!]);
  const oldOut = shot.outFrame,
    splitAt = 30;
  const id = splitEditClip(data, shot.id, splitAt),
    next = data.shots[id];
  expect(next.inFrame).toBe(shot.inFrame + splitAt);
  expect(next.outFrame).toBe(oldOut);
  expect(data.takes[next.currentTakeId!].assetId).toBe(take.assetId);
  expect(data.takes[next.currentTakeId!].shotId).toBe(id);
  expect(data.takes[take.id]).toEqual(take);
  expect(dataSchema.safeParse(data).success).toBe(true);
  expect(() => splitEditClip(data, shot.id, 0)).toThrow(/inside/);
  expect(() =>
    insertEditMedia(data, "letter-reunion", take.assetId, 5),
  ).toThrow(/production/);
});

