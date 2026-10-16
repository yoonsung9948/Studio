import { beforeEach, describe, it, expect } from "vitest";
import { seed } from "../mocks/seed";
import { emptyStudio } from "../mocks/studio-seed";
import {
  createCharacter,
  updateCharacter,
  enqueueStudio,
  approveVersion,
  createLook,
  updateLook,
  setSceneCast,
  updateDirection,
  addLookAngle,
  applyStudioProposal,
  studioProposal,
  deleteLook,
} from "../domain/studio-commands";
import {
  characterReady,
  characterReferences,
  lookReady,
  referenceValid,
  targetJobs,
} from "../domain/studio-selectors";
import { scenePreflight, updateShotPlan } from "../domain/scene-preflight";
import {
  tick,
  cancelJob,
  retryJob,
  enqueueGeneration,
} from "../domain/commands";
import { recover, useStore } from "../stores/store";
import type { Data, StudioOperation } from "../domain/types";
let d: Data;
beforeEach(() => {
  d = seed();
});
const finish = () => {
  for (let i = 0; i < 80; i++) tick(d);
};
const generate = (kind: StudioOperation, id: string) => {
  enqueueStudio(d, kind, [id]);
  finish();
  return targetJobs(d, kind, id).at(-1)!.outputVersionIds![0];
};
describe("Character production lifecycle", () => {
  it("creates a draft immediately, approves one of three identities and reuses it as the front reference", () => {
    const id = createCharacter(d, "midnight");
    expect(characterReady(d, id)).toBe(false);
    updateCharacter(d, id, { appearance: "A woman with black hair" });
    const credits = d.credits;
    const version = generate("identity", id);
    expect(d.credits).toBe(credits - 24);
    expect(targetJobs(d, "identity", id)[0].outputVersionIds).toHaveLength(3);
    expect(characterReady(d, id)).toBe(false);
    approveVersion(d, version);
    expect(characterReady(d, id)).toBe(true);
    const front = characterReferences(d, id).find((r) => r.type === "front")!;
    expect(referenceValid(d, front.id)).toBe(true);
    expect(d.studio.versions[front.activeVersionId!].assetId).toBe(
      d.studio.versions[version].assetId,
    );
  });
  it("charges once for duplicate active jobs and shares concurrency with shot jobs", () => {
    enqueueStudio(d, "identity", ["maya", "maya"]);
    const credits = d.credits;
    enqueueStudio(d, "identity", ["maya"]);
    expect(d.credits).toBe(credits);
    enqueueGeneration(d, ["ep1-s2-q1"]);
    enqueueStudio(d, "look", ["maya-look-1"]);
    tick(d);
    expect(
      Object.values(d.jobs).filter((j) => j.state === "running"),
    ).toHaveLength(2);
  });
  it("retains canceled and failed attempts and retries explicitly", () => {
    enqueueStudio(d, "identity", ["maya"], true);
    finish();
    const old = targetJobs(d, "identity", "maya")[0];
    expect(old.state).toBe("failed");
    retryJob(d, old.id);
    const next = targetJobs(d, "identity", "maya")[1];
    tick(d);
    cancelJob(d, next.id);
    finish();
    expect(next.outputVersionIds).toBeUndefined();
    expect(old.state).toBe("failed");
    retryJob(d, next.id);
    finish();
    expect(targetJobs(d, "identity", "maya").at(-1)?.state).toBe("succeeded");
  });
  it("preserves old identity and footage while invalidating only dependent assignments", () => {
    const old = d.characters.maya.canonicalVersionId!;
    const take = d.shots["ep1-s1-q1"].currentTakeId;
    const unrelatedRevision = d.shots["ep1-s4-q1"].revision;
    approveVersion(d, generate("identity", "maya"));
    expect(d.studio.versions[old].approval).toBe("approved");
    expect(d.shots["ep1-s1-q1"].currentTakeId).toBe(take);
    expect(d.shots["ep1-s1-q1"].stale).toBe(true);
    expect(d.shots["ep1-s4-q1"].revision).toBe(unrelatedRevision);
    expect(lookReady(d, "maya-look-1")).toBe(false);
    expect(referenceValid(d, "maya-three_quarter")).toBe(false);
    expect(characterReady(d, "maya")).toBe(true);
  });
  it("requires an identity before Look generation and validates Look ownership", () => {
    const cid = createCharacter(d, "midnight"),
      lid = createLook(d, cid);
    updateLook(d, lid, { description: "Black jacket" });
    expect(() => enqueueStudio(d, "look", [lid])).toThrow(/identity/);
    expect(() =>
      setSceneCast(d, "ep1-s1", [
        { characterId: "maya", lookId: "leo-look-0" },
      ]),
    ).toThrow(/another character/);
  });
  it("keeps Look references tied to their approved appearance", () => {
    const rid = addLookAngle(d, "maya-look-1");
    approveVersion(d, generate("reference", rid));
    expect(referenceValid(d, rid)).toBe(true);
    approveVersion(d, generate("look", "maya-look-1"));
    expect(referenceValid(d, rid)).toBe(false);
    deleteLook(d, "maya-look-1");
    expect(d.studio.references[rid]).toBeUndefined();
  });
  it("freezes job anchors and rejects obsolete candidate approval", () => {
    const id = generate("look", "maya-look-1");
    const anchor = d.studio.versions[id].sourceIdentityVersionId;
    approveVersion(d, generate("identity", "maya"));
    expect(d.studio.versions[id].sourceIdentityVersionId).toBe(anchor);
    expect(() => approveVersion(d, id)).toThrow(/identity changed/);
  });
});
describe("Scene setup and recovery", () => {
  it("seeds ready, dependency, reference-review, and missing-identity states", () => {
    expect(scenePreflight(d, "ep1-s1").ready).toBe(true);
    expect(scenePreflight(d, "ep1-s2").dependencies).toBeGreaterThan(0);
    expect(
      scenePreflight(d, "ep1-s3").issues.some(
        (i) => i.group === "References" && i.level === "blocker",
      ),
    ).toBe(true);
    expect(scenePreflight(d, "ep1-s4").ready).toBe(false);
    approveVersion(d, generate("identity", "emma"));
    expect(scenePreflight(d, "ep1-s4").ready).toBe(true);
  });
  it("treats extra views and inferred locations as warnings, not blockers", () => {
    setSceneCast(d, "ep1-s1", [{ characterId: "leo" }]);
    d.studio.setups["ep1-s1"].locationMode = "inferred";
    const p = scenePreflight(d, "ep1-s1");
    expect(p.ready).toBe(true);
    expect(
      p.issues.filter((i) => i.level === "warning").length,
    ).toBeGreaterThan(0);
    d.studio.setups["ep1-s1"].locationMode = "required";
    delete d.studio.setups["ep1-s1"].locationId;
    expect(scenePreflight(d, "ep1-s1").ready).toBe(false);
  });
  it("blocks invalid dependencies, duration mismatch, budget and cross-project routes", () => {
    expect(() =>
      updateShotPlan(d, "ep1-s2-q1", { dependsOn: "ep1-s2-q2" }),
    ).toThrow();
    updateShotPlan(d, "ep1-s2-q1", { targetFrames: 60 });
    expect(scenePreflight(d, "ep1-s2").ready).toBe(false);
    expect(scenePreflight(d, "ep1-s1", "missing", "ep1").ready).toBe(false);
    d = seed();
    d.credits = 0;
    expect(
      scenePreflight(d, "ep1-s2").issues.some((i) => i.group === "Budget"),
    ).toBe(true);
  });
  it("does not let retry bypass character readiness or charge on rejection", () => {
    const credits = d.credits;
    expect(() => retryJob(d, "seed-failure")).toThrow(/Emma/);
    expect(d.credits).toBe(credits);
  });
  it("snapshots job references and preserves them after a later Look replacement", () => {
    enqueueGeneration(d, ["ep1-s2-q1"]);
    const j = Object.values(d.jobs).find((j) => j.shotId === "ep1-s2-q1")!;
    const snapshot = structuredClone(j.references);
    approveVersion(d, generate("look", "maya-look-1"));
    expect(j.references).toEqual(snapshot);
    expect(
      Object.values(d.takes).find((t) => t.shotId === j.shotId && t.references)
        ?.references,
    ).toEqual(snapshot);
  });
  it("applies context-scoped Director proposals and rejects a stale scene proposal", () => {
    const scope = {
      projectId: "midnight",
      characterId: "maya",
      revision: d.projects.midnight.revision,
      fps: 30 as const,
    };
    const id = studioProposal(d, scope, "Create a summer outfit")!;
    applyStudioProposal(d, id);
    expect(
      Object.values(d.studio.looks).filter((l) => l.characterId === "maya"),
    ).toHaveLength(4);
    const p = studioProposal(
      d,
      {
        projectId: "midnight",
        sceneId: "ep1-s1",
        setup: true,
        revision: d.projects.midnight.revision,
        fps: 30,
      },
      "Make it darker",
    )!;
    updateDirection(d, "ep1-s1", { mood: "Calm" });
    expect(() => applyStudioProposal(d, p)).toThrow(/context changed/);
  });
  it("migrates v1 without changing IDs, trims, credits, jobs or user descriptions", () => {
    const original = seed();
    original.shots["ep1-s1-q1"].inFrame = 46;
    original.characters.maya.description = "User-written appearance";
    original.credits = 345;
    original.studio = emptyStudio();
    for (const c of Object.values(original.characters)) {
      delete c.revision;
      delete c.canonicalVersionId;
    }
    const saved = JSON.parse(JSON.stringify(original));
    delete saved.studio;
    const restored = recover(
      JSON.stringify({ version: 1, data: saved, ui: useStore.getState().ui }),
    );
    expect(restored.notice).toBe("");
    expect(restored.data.credits).toBe(345);
    expect(restored.data.shots["ep1-s1-q1"].inFrame).toBe(46);
    expect(restored.data.characters.maya.appearance).toBe(
      "User-written appearance",
    );
    expect(Object.keys(restored.data.jobs)).toEqual(Object.keys(original.jobs));
    expect(
      Object.values(restored.data.studio.looks).filter(
        (l) => l.characterId === "maya",
      ),
    ).toHaveLength(3);
  });
});
