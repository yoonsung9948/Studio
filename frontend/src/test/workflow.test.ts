import { updateDirection } from "../domain/studio-commands";
import { beforeEach, describe, it, expect } from "vitest";
import { seed } from "../mocks/seed";
import { type Data } from "../domain/types";
import {
  approveScript,
  approveScenePlan,
  scriptApproved,
  scenePlanApproved,
  reviseEpisodeScript,
  planScenes,
  updateScenePlan,
  splitScene,
  mergeSceneWithNext,
} from "../domain/workflow";
import {
  approveTake,
  enqueueGeneration,
  tick,
  duplicateEpisode,
} from "../domain/commands";
import { recover, useStore } from "../stores/store";
import { validateRelations } from "../domain/validation";
let d: Data;
beforeEach(() => {
  d = seed();
});
function newEpisode() {
  d.episodes.fresh = {
    id: "fresh",
    projectId: "midnight",
    title: "A missed call",
    synopsis: "A late call changes the night.",
    script: "",
    scriptRevision: 1,
    scriptHistory: [],
    sceneIds: [],
    revision: 1,
    timelineVersion: 1,
    targetSeconds: 30,
  };
  d.projects.midnight.episodeIds.push("fresh");
  return d.episodes.fresh;
}
describe("Script → Scenes → Edit state", () => {
  it("requires script then scene-plan approval before any generation charge", () => {
    const ep = newEpisode();
    expect(() => planScenes(d, ep.id)).toThrow(/Approve/);
    reviseEpisodeScript(
      d,
      ep.id,
      "INT. ROOM — NIGHT\n\nA phone rings.\n\nEXT. STREET — NIGHT\n\nSomeone waits.",
    );
    expect(scriptApproved(ep)).toBe(false);
    approveScript(d, ep.id);
    planScenes(d, ep.id, 2);
    expect(ep.sceneIds).toHaveLength(2);
    expect(
      ep.sceneIds.reduce((n, id) => n + d.studio.setups[id].targetSeconds, 0),
    ).toBe(30);
    const id = ep.sceneIds[0],
      shots = d.scenes[id].shotIds,
      credits = d.credits;
    expect(scenePlanApproved(d, id)).toBe(false);
    expect(() => enqueueGeneration(d, shots)).toThrow(
      /Approve this scene plan/,
    );
    expect(d.credits).toBe(credits);
    approveScenePlan(d, id);
    enqueueGeneration(d, shots);
    expect(d.credits).toBeLessThan(credits);
    expect(ep.scriptHistory).toHaveLength(1);
    expect(d.scenes[id].planHistory).toHaveLength(1);
  });
  it("invalidates approvals after script changes without replacing IDs, takes, trims or reference choices", () => {
    const s = d.shots["ep1-s1-q1"];
    s.inFrame = 46;
    const old = s.currentTakeId,
      cast = structuredClone(d.studio.setups["ep1-s1"].cast),
      history = d.scenes["ep1-s1"].planHistory?.length;
    reviseEpisodeScript(d, "ep1", "A revised story.");
    expect(scriptApproved(d.episodes.ep1)).toBe(false);
    expect(scenePlanApproved(d, "ep1-s1")).toBe(false);
    expect(s.currentTakeId).toBe(old);
    expect(s.inFrame).toBe(46);
    expect(d.studio.setups["ep1-s1"].cast).toEqual(cast);
    approveScript(d, "ep1");
    expect(scenePlanApproved(d, "ep1-s1")).toBe(false);
    approveScenePlan(d, "ep1-s1");
    expect(scenePlanApproved(d, "ep1-s1")).toBe(true);
    expect(d.scenes["ep1-s1"].planHistory).toHaveLength(history! + 1);
    expect(s.stale).toBe(true);
  });
  it("invalidates only the edited scene plan and preserves the approved plan history", () => {
    const old = d.scenes["ep1-s1"].planHistory?.[0].description;
    updateScenePlan(
      d,
      "ep1-s1",
      { description: "A deliberate new entrance." },
      18,
    );
    expect(scenePlanApproved(d, "ep1-s1")).toBe(false);
    expect(scenePlanApproved(d, "ep1-s2")).toBe(true);
    expect(d.scenes["ep1-s1"].planHistory?.[0].description).toBe(old);
    expect(
      d.scenes["ep1-s1"].shotIds.reduce(
        (n, id) => n + d.shots[id].targetFrames / 30,
        0,
      ),
    ).toBe(18);
    approveScenePlan(d, "ep1-s1");
    expect(d.scenes["ep1-s1"].planHistory).toHaveLength(2);
  });
  it("refreshes existing scene descriptions without deleting production or changing its scene and shot IDs", () => {
    const ids = structuredClone(d.episodes.ep1.sceneIds),
      shots = Object.keys(d.shots),
      takes = Object.keys(d.takes);
    reviseEpisodeScript(d, "ep1", "INT. ROOM — NIGHT\n\nThe lights fail.");
    approveScript(d, "ep1");
    planScenes(d, "ep1", 4);
    expect(d.episodes.ep1.sceneIds).toEqual(ids);
    expect(Object.keys(d.shots)).toEqual(shots);
    expect(Object.keys(d.takes)).toEqual(takes);
    expect(ids.every((id) => !scenePlanApproved(d, id))).toBe(true);
  });
  it("splits and merges while retaining takes, shot references, job ownership and duration", () => {
    enqueueGeneration(d, ["ep1-s2-q3"]);
    const takes = Object.keys(d.takes),
      seconds = d.studio.setups["ep1-s2"].targetSeconds,
      oldShotIds = [...d.scenes["ep1-s2"].shotIds];
    const id = splitScene(d, "ep1-s2");
    expect(d.shots["ep1-s2-q3"].sceneId).toBe(id);
    expect(
      Object.values(d.jobs).find((j) => j.shotId === "ep1-s2-q3")?.sceneId,
    ).toBe(id);
    expect(
      d.studio.setups["ep1-s2"].targetSeconds +
        d.studio.setups[id].targetSeconds,
    ).toBe(seconds);
    expect(scenePlanApproved(d, id)).toBe(false);
    mergeSceneWithNext(d, "ep1-s2");
    expect(d.scenes["ep1-s2"].shotIds).toEqual(oldShotIds);
    expect(d.shots["ep1-s2-q3"].castOverride).toEqual(
      d.studio.setups["ep1-s2"].cast,
    );
    expect(Object.keys(d.takes)).toEqual(takes);
    expect(d.studio.setups["ep1-s2"].targetSeconds).toBe(seconds);
    validateRelations(d);
  });
  it("preserves existing v2 production during workflow migration, and persists draft approvals in v3", () => {
    const shot = d.shots["ep1-s1-q1"];
    shot.inFrame = 46;
    d.credits = 333;
    for (const ep of Object.values(d.episodes)) {
      delete ep.scriptRevision;
      delete ep.scriptApprovedRevision;
      delete ep.scriptHistory;
    }
    for (const sc of Object.values(d.scenes)) {
      delete sc.planRevision;
      delete sc.planApprovedRevision;
      delete sc.sourceScriptRevision;
      delete sc.planHistory;
    }
    const restored = recover(
      JSON.stringify({ version: 2, data: d, ui: useStore.getState().ui }),
    );
    expect(restored.notice).toBe("");
    expect(restored.data.credits).toBe(333);
    expect(restored.data.shots[shot.id].inFrame).toBe(46);
    expect(scenePlanApproved(restored.data, "ep1-s1")).toBe(true);
    reviseEpisodeScript(restored.data, "ep1", "Unapproved changes");
    const again = recover(
      JSON.stringify({ version: 3, data: restored.data, ui: restored.ui }),
    );
    expect(again.notice).toBe("");
    expect(scriptApproved(again.data.episodes.ep1)).toBe(false);
    expect(scenePlanApproved(again.data, "ep1-s1")).toBe(false);
  });
  it("keeps completed old candidates unapproved after their plan changes", () => {
    enqueueGeneration(d, ["ep1-s2-q1"]);
    updateScenePlan(d, "ep1-s2", { description: "A different action." });
    for (let i = 0; i < 30; i++) tick(d);
    const shot = d.shots["ep1-s2-q1"],
      take = d.takes[shot.candidateTakeId!];
    expect(take.revision).toBeLessThan(shot.revision);
    expect(take.approved).toBe(false);
    expect(scenePlanApproved(d, "ep1-s2")).toBe(false);
  });
  it("duplicates approval history and inputs without aliasing later edits to the source", () => {
    const copy = duplicateEpisode(d, "ep1");
    d.episodes[copy].scriptHistory?.push({
      revision: 999,
      script: "Different",
      approvedAt: 0,
    });
    expect(d.episodes.ep1.scriptHistory?.some((v) => v.revision === 999)).toBe(
      false,
    );
    const sid = d.episodes[copy].sceneIds[0];
    d.scenes[sid].planHistory?.push({
      ...d.scenes[sid].planHistory![0],
      description: "New",
    });
    expect(
      d.scenes["ep1-s1"].planHistory?.some((v) => v.description === "New"),
    ).toBe(false);
  });
});
it("tracks direction edits in plan approval and frozen generation inputs", () => {
  const sc = d.scenes["ep1-s2"];
  updateDirection(d, sc.id, { lighting: "Moonlit blue shadows" });
  expect(scenePlanApproved(d, sc.id)).toBe(false);
  approveScenePlan(d, sc.id);
  enqueueGeneration(d, [sc.shotIds[0]]);
  const j = Object.values(d.jobs).find((j) => j.shotId === sc.shotIds[0])!;
  expect(j.inputs?.direction.lighting).toBe("Moonlit blue shadows");
  expect(j.inputs?.planRevision).toBe(sc.planRevision);
  expect(sc.planHistory?.at(-1)?.direction?.lighting).toBe(
    "Moonlit blue shadows",
  );
});

it("creates usable mock source spans for planned shots longer than eight seconds", () => {
  const ep = newEpisode();
  reviseEpisodeScript(d, ep.id, "INT. ROOM — NIGHT\n\nMAYA\nAnswer the phone.");
  approveScript(d, ep.id);
  planScenes(d, ep.id, 1);
  const id = ep.sceneIds[0];
  expect(d.scenes[id].dialogue).toContain("MAYA: Answer the phone.");
  approveScenePlan(d, id);
  enqueueGeneration(d, d.scenes[id].shotIds);
  for (let i = 0; i < 40; i++) tick(d);
  for (const qid of d.scenes[id].shotIds)
    approveTake(d, qid, d.shots[qid].imageTakeId!);
  enqueueGeneration(d, d.scenes[id].shotIds);
  for (let i = 0; i < 40; i++) tick(d);
  for (const qid of d.scenes[id].shotIds) {
    const s = d.shots[qid],
      t = d.takes[s.candidateTakeId!];
    expect(t.sourceFrames).toBeGreaterThanOrEqual(s.targetFrames);
    approveTake(d, qid, t.id);
    expect(s.currentTakeId).toBe(t.id);
  }
});
