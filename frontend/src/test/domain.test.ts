import { describe, it, expect, beforeEach } from "vitest";
import { seed } from "../mocks/seed";
import {
  approveTake,
  cancelJob,
  completeJob,
  duplicateEpisode,
  enqueueGeneration,
  proposal,
  applyEditProposal,
  reorderShots,
  retryJob,
  tick,
  trimShot,
  updateScript,
} from "../domain/commands";
import {
  available,
  dependencyReady,
  duration,
  exportWarnings,
  preflight,
  shotsOfEpisode,
  stage,
} from "../domain/selectors";
import { recover, useStore } from "../stores/store";
import { dataSchema } from "../domain/schemas";
import type { Data } from "../domain/types";
let d: Data;
beforeEach(() => {
  d = seed();
});
const finish = () => {
  for (let i = 0; i < 60; i++) tick(d);
};
describe("Production stages and duration math", () => {
  it("validates the seeded normalized schema", () =>
    expect(dataSchema.safeParse(d).success).toBe(true));
  it("distinguishes target, timeline and available source", () => {
    const ss = shotsOfEpisode(d, "ep1");
    expect(duration(ss)).toBe(60);
    expect(available(d, ss)).toBe(24);
    expect(stage(d, d.shots["ep1-s1-q1"])).toBe("Approved");
    expect(stage(d, d.shots["ep1-s2-q1"])).toBe("Generate video");
    expect(stage(d, d.shots["ep1-s3-q1"])).toBe("Review images");
  });
  it("requires image approval before video generation", () => {
    const s = d.shots["ep1-s3-q1"];
    expect(preflight(d, [s.id])).toEqual([]);
    approveTake(d, s.id, s.imageTakeId!);
    expect(stage(d, s)).toBe("Generate video");
  });
  it("keeps generated video unapproved", () => {
    const id = "ep1-s2-q1";
    enqueueGeneration(d, [id]);
    finish();
    expect(stage(d, d.shots[id])).toBe("Review video");
    expect(d.shots[id].currentTakeId).toBeUndefined();
  });
  it("validates trim bounds against source frames", () => {
    trimShot(d, "ep1-s1-q1", 30, 180);
    expect(duration([d.shots["ep1-s1-q1"]])).toBe(5);
    expect(() => trimShot(d, "ep1-s1-q1", 0, 241)).toThrow();
    expect(() => trimShot(d, "ep1-s1-q1", 50, 20)).toThrow();
  });
});
describe("App-level queue and dependencies", () => {
  it("runs two independent jobs while a continuation waits", () => {
    // Queue mechanics fixture deliberately uses a character-free scene.
    d.studio.setups["ep1-s4"].cast = [];
    enqueueGeneration(d, ["ep1-s4-q1", "ep1-s4-q2", "ep1-s4-q3"]);
    tick(d);
    expect(
      Object.values(d.jobs).filter((j) => j.state === "running"),
    ).toHaveLength(2);
    expect(
      Object.values(d.jobs).find((j) => j.shotId === "ep1-s4-q2")?.state,
    ).toBe("waiting");
    finish();
    const s = d.shots["ep1-s4-q1"];
    expect(dependencyReady(d, d.shots["ep1-s4-q2"])).toBe(false);
    approveTake(d, s.id, s.candidateTakeId!);
    tick(d);
    expect(
      Object.values(d.jobs).find((j) => j.shotId === "ep1-s4-q2")?.state,
    ).toBe("running");
  });
  it("does not duplicate active jobs or charge twice", () => {
    enqueueGeneration(d, ["ep1-s2-q1"]);
    const credits = d.credits;
    enqueueGeneration(d, ["ep1-s2-q1"]);
    expect(
      Object.values(d.jobs).filter((j) => j.shotId === "ep1-s2-q1"),
    ).toHaveLength(1);
    expect(d.credits).toBe(credits);
  });
  it("ignores late completion after cancellation", () => {
    enqueueGeneration(d, ["ep1-s2-q1"]);
    tick(d);
    const j = Object.values(d.jobs).find((j) => j.shotId === "ep1-s2-q1")!;
    cancelJob(d, j.id);
    completeJob(d, j.id);
    expect(d.shots[j.shotId].candidateTakeId).toBeUndefined();
    expect(j.state).toBe("canceled");
  });
  it("retries an explicit new attempt and preserves failure history", () => {
    d.studio.setups["ep1-s4"].cast = [];
    retryJob(d, "seed-failure");
    retryJob(d, "seed-failure");
    expect(d.jobs["seed-failure"].state).toBe("failed");
    const jobs = Object.values(d.jobs).filter((j) => j.shotId === "ep1-s4-q1");
    expect(jobs).toHaveLength(2);
    expect(jobs[1].attempt).toBe(2);
    finish();
    expect(d.shots["ep1-s4-q1"].candidateTakeId).toBeTruthy();
  });
  it("recovers unfinished work paused and resets invalid storage", () => {
    enqueueGeneration(d, ["ep1-s2-q1"]);
    const result = recover(
      JSON.stringify({ version: 1, data: d, ui: useStore.getState().ui }),
    );
    expect(result.resume).toBe(true);
    expect(recover("{broken").notice).toContain("fresh demo");
  });
});
describe("Approval, revisions and editorial commands", () => {
  it("preserves original take until approving the exact candidate", () => {
    const s = d.shots["ep1-s1-q1"];
    const original = s.currentTakeId;
    enqueueGeneration(d, [s.id], true);
    finish();
    expect(s.currentTakeId).toBe(original);
    approveTake(d, s.id, s.candidateTakeId!);
    expect(s.currentTakeId).not.toBe(original);
    expect(d.takes[original!].approved).toBe(true);
    expect(d.shots["ep1-s1-q2"].currentTakeId).toBe("take-ep1-s1-q2");
  });
  it("rejects stale candidate without discarding old media", () => {
    const s = d.shots["ep1-s1-q1"];
    enqueueGeneration(d, [s.id], true);
    updateScript(d, "ep1", "New script");
    finish();
    expect(() => approveTake(d, s.id, s.candidateTakeId!)).toThrow(
      "older revision",
    );
    expect(s.currentTakeId).toBe("take-ep1-s1-q1");
    expect(s.stale).toBe(true);
  });
  it("blocks continuation reorder before its source", () =>
    expect(() =>
      reorderShots(d, "ep1-s4", ["ep1-s4-q2", "ep1-s4-q1", "ep1-s4-q3"]),
    ).toThrow("continuation"));
  it("rejects duplicate IDs in order", () =>
    expect(() =>
      reorderShots(d, "ep1-s1", ["ep1-s1-q1", "ep1-s1-q1", "ep1-s1-q3"]),
    ).toThrow());
  it("snapshots proposal scope and requires separate generation approval", () => {
    const scope = {
      projectId: "midnight",
      episodeId: "ep1",
      sceneId: "ep1-s1",
      shotId: "ep1-s1-q1",
      revision: 1,
      fps: 30 as const,
    };
    const id = proposal(
      d,
      scope,
      "Regenerate this shot and preserve the character",
    )!;
    scope.shotId = "ep1-s1-q2";
    expect(d.proposals[id].scope.shotId).toBe("ep1-s1-q1");
    expect(() => applyEditProposal(d, id)).toThrow("separate spending");
    expect(d.credits).toBe(1200);
  });
  it("shortens selected shot and rejects stale proposals", () => {
    const scope = {
      projectId: "midnight",
      episodeId: "ep1",
      shotId: "ep1-s1-q1",
      revision: 1,
      fps: 30 as const,
    };
    const id = proposal(d, scope, "Shorten this shot by one second")!;
    applyEditProposal(d, id);
    expect(duration([d.shots[scope.shotId]])).toBe(4);
    const next = proposal(d, scope, "Make this scene more suspenseful")!;
    expect(() => applyEditProposal(d, next)).toThrow("project changed");
  });
  it("duplicates independent entity IDs without job references", () => {
    const eid = duplicateEpisode(d, "ep1");
    const copy = shotsOfEpisode(d, eid);
    expect(copy).toHaveLength(12);
    expect(
      copy.every((s) => !shotsOfEpisode(d, "ep1").some((x) => x.id === s.id)),
    ).toBe(true);
    expect(Object.values(d.jobs).some((j) => j.episodeId === eid)).toBe(false);
    expect(copy[0].currentTakeId).not.toBe(d.shots["ep1-s1-q1"].currentTakeId);
  });
  it("derives export warnings and complete animatic readiness", () => {
    expect(exportWarnings(d, "ep1").length).toBeGreaterThan(0);
    expect(exportWarnings(d, "ep2")).toEqual([]);
  });
  it("undo restores edits without refunding spent credits or removing jobs", () => {
    useStore.getState().reset();
    useStore.getState().mutate((d) => trimShot(d, "ep1-s1-q1", 0, 120), true);
    useStore.getState().mutate((d) => enqueueGeneration(d, ["ep1-s2-q1"]));
    useStore.getState().undo();
    expect(useStore.getState().data.shots["ep1-s1-q1"].outFrame).toBe(150);
    expect(useStore.getState().data.credits).toBe(1176);
    expect(Object.values(useStore.getState().data.jobs)).toHaveLength(2);
  });
});

describe("Persistence and asynchronous edit isolation", () => {
  it("rejects dangling saved IDs", () => {
    d.projects.midnight.episodeIds.push("missing");
    const r = recover(
      JSON.stringify({ version: 1, data: d, ui: useStore.getState().ui }),
    );
    expect(r.notice).toContain("fresh demo");
  });
  it("rejects cyclic continuation dependencies", () => {
    d.shots["ep1-s4-q1"].dependsOn = "ep1-s4-q2";
    const r = recover(
      JSON.stringify({ version: 1, data: d, ui: useStore.getState().ui }),
    );
    expect(r.notice).toContain("fresh demo");
  });
  it("undo preserves candidate results completed after an edit", () => {
    useStore.getState().reset();
    useStore.getState().mutate((d) => trimShot(d, "ep1-s1-q1", 0, 120), true);
    useStore.getState().mutate((d) => enqueueGeneration(d, ["ep1-s2-q1"]));
    for (let i = 0; i < 20; i++) useStore.getState().mutate(tick);
    const take = useStore.getState().data.shots["ep1-s2-q1"].candidateTakeId;
    useStore.getState().undo();
    expect(take).toBeTruthy();
    expect(useStore.getState().data.shots["ep1-s2-q1"].candidateTakeId).toBe(
      take,
    );
    expect(useStore.getState().data.shots["ep1-s1-q1"].outFrame).toBe(150);
  });
});

it("revised scripts require approval and a fresh image step", () => {
  const s = d.shots["ep1-s2-q1"];
  updateScript(d, "ep1", "Changed action");
  expect(stage(d, s)).toBe("Review images");
  expect(preflight(d, [s.id])[0].operation).toBe("image");
  expect(() => enqueueGeneration(d, [s.id])).toThrow(/Approve/);
});
