import { expect, it } from "vitest";
import { seed } from "../mocks/seed";
import {
  planShotDuration,
  createWorkspaceEpisode,
  createWorldElement,
} from "../domain/workspace";
import {
  chooseFrame,
  chooseVideo,
  generateProduceBatch,
  migrateProduce,
  scenePreview,
  setSceneProps,
  shotResults,
} from "../domain/produce";
import {
  generationInputs,
  saveGenerationInputs,
  generationInputSnapshot,
} from "../domain/generation-inputs";
import { completeJob } from "../domain/commands";
import {
  initialCut,
  getCut,
  editCut,
  splitCutClip,
  syncChosenTakes,
  renderSnapshot,
  appendCutTake,
} from "../domain/cut";
import { dataSchema } from "../domain/schemas";
import { produceStage } from "../domain/produce-route";
import { episodeContinuity } from "../domain/episode-resources";

function fixture() {
  const data = seed();
  const episodeId = createWorkspaceEpisode(
    data,
    "midnight",
    "INT. CAFE — DUSK\nTwo old friends exchange a letter.",
    5,
  );
  const sceneId = data.episodes[episodeId].sceneIds[0],
    shotId = data.scenes[sceneId].shotIds[0];
  return { data, episodeId, sceneId, shotId };
}
function finish(data: ReturnType<typeof seed>, shotId: string) {
  const job = Object.values(data.jobs).find(
    (job) => job.shotId === shotId && job.state === "queued",
  )!;
  job.state = "running";
  completeJob(data, job.id);
  return job;
}
it("keeps scene references inherited when a shot changes its composition", () => {
  const { data, sceneId, shotId } = fixture();
  saveGenerationInputs(data, sceneId, { aspectRatio: "16:9" });
  saveGenerationInputs(
    data,
    sceneId,
    { instructions: "Closer on the letter" },
    shotId,
  );
  saveGenerationInputs(data, sceneId, { aspectRatio: "1:1" });
  expect(generationInputs(data, sceneId, shotId).aspectRatio).toBe("1:1");
  expect(data.shots[shotId].generationOverride).toEqual({
    instructions: "Closer on the letter",
  });
});
it("preserves explicit empty reference overrides without leaking another scene's inputs", () => {
  const { data, sceneId, shotId } = fixture();
  const asset = Object.values(data.assets).find(
    (item) => item.projectId === "midnight",
  )!;
  saveGenerationInputs(data, sceneId, {
    referenceInputs: [{ assetId: asset.id, purpose: "continuity" }],
  });
  saveGenerationInputs(data, sceneId, { referenceInputs: [] }, shotId);
  expect(generationInputs(data, sceneId, shotId).referenceInputs).toEqual([]);
  expect(generationInputs(data, sceneId).referenceInputs).toHaveLength(1);
});
it("inherits scene props even before its first shot exists", () => {
  const { data, episodeId, sceneId } = fixture();
  data.scenes[sceneId].shotIds = [];
  const prop = createWorldElement(data, "midnight", "prop", "Letter");
  setSceneProps(data, sceneId, [prop]);
  expect(
    episodeContinuity(data, episodeId).props.map((entry) => entry.id),
  ).toContain(prop);
});
it("shows sample artwork only until a valid image result exists and links its shot", () => {
  const { data, sceneId, shotId } = fixture();
  expect(scenePreview(data, sceneId).sample).toBe(true);
  generateProduceBatch(data, shotId, "image", 2);
  finish(data, shotId);
  expect(scenePreview(data, sceneId)).toMatchObject({ sample: false, shotId });
  expect(shotResults(data, shotId, "image")).toHaveLength(2);
  const take = shotResults(data, shotId, "image")[1];
  chooseFrame(data, shotId, take.id);
  expect(scenePreview(data, sceneId).url).toBe(data.assets[take.assetId].url);
  data.assets[take.assetId].archived = true;
  expect(scenePreview(data, sceneId).sample).toBe(false);
});
it("appends batches and charges the whole batch without replacing the chosen frame", () => {
  const { data, shotId } = fixture();
  const credits = data.credits;
  generateProduceBatch(data, shotId, "image", 2);
  finish(data, shotId);
  const frame = shotResults(data, shotId, "image")[0];
  chooseFrame(data, shotId, frame.id);
  generateProduceBatch(data, shotId, "image", 2);
  finish(data, shotId);
  expect(shotResults(data, shotId, "image")).toHaveLength(4);
  expect(data.shots[shotId].imageTakeId).toBe(frame.id);
  expect(data.credits).toBe(credits - 32);
});
it("permits repeated video batches while earlier candidates await a decision", () => {
  const { data, shotId } = fixture();
  generateProduceBatch(data, shotId, "image", 1);
  finish(data, shotId);
  const frame = shotResults(data, shotId, "image")[0];
  chooseFrame(data, shotId, frame.id);
  generateProduceBatch(data, shotId, "video", 2);
  const first = finish(data, shotId);
  expect(first.sourceTakeId).toBe(frame.id);
  const video = shotResults(data, shotId, "video")[0];
  chooseVideo(data, shotId, video.id);
  generateProduceBatch(data, shotId, "video", 2);
  finish(data, shotId);
  expect(shotResults(data, shotId, "video")).toHaveLength(4);
  expect(data.shots[shotId].currentTakeId).toBe(video.id);
});
it("rejects video without a source frame and prevents duplicate active charges", () => {
  const { data, shotId } = fixture();
  expect(() => generateProduceBatch(data, shotId, "video", 1)).toThrow(
    /starting frame/,
  );
  generateProduceBatch(data, shotId, "image", 2);
  const credits = data.credits;
  expect(() => generateProduceBatch(data, shotId, "image", 2)).toThrow(/wait/i);
  expect(data.credits).toBe(credits);
});
it("captures generation reference and prop inputs immutably", () => {
  const { data, shotId, sceneId } = fixture();
  const prop = createWorldElement(data, "midnight", "prop", "Letter");
  setSceneProps(data, sceneId, [prop]);
  generateProduceBatch(data, shotId, "image", 1);
  const job = finish(data, shotId);
  data.projects.midnight.worldElements!.find((item) => item.id === prop)!.name =
    "Changed";
  expect(job.inputs?.worldElements?.[0].name).toBe("Letter");
  expect(generationInputSnapshot(data, shotId).worldElements?.[0].name).toBe(
    "Changed",
  );
});
it("splits timeline clips without duplicating planned shots or source takes", () => {
  const { data, episodeId, shotId } = fixture();
  generateProduceBatch(data, shotId, "image", 1);
  finish(data, shotId);
  chooseFrame(data, shotId, shotResults(data, shotId, "image")[0].id);
  generateProduceBatch(data, shotId, "video", 1);
  finish(data, shotId);
  chooseVideo(data, shotId, shotResults(data, shotId, "video")[0].id);
  const shots = Object.keys(data.shots),
    takes = Object.keys(data.takes);
  const clip = initialCut(data, episodeId).clips[0];
  splitCutClip(data, episodeId, clip.id, 60);
  expect(getCut(data, episodeId).clips).toHaveLength(2);
  expect(getCut(data, episodeId).clips[0].outFrame).toBe(
    getCut(data, episodeId).clips[1].inFrame,
  );
  expect(Object.keys(data.shots)).toEqual(shots);
  expect(Object.keys(data.takes)).toEqual(takes);
});
it("keeps edited cuts pinned until the user explicitly updates chosen takes", () => {
  const { data, episodeId, shotId } = fixture();
  generateProduceBatch(data, shotId, "image", 1);
  finish(data, shotId);
  chooseFrame(data, shotId, shotResults(data, shotId, "image")[0].id);
  generateProduceBatch(data, shotId, "video", 2);
  finish(data, shotId);
  const [first, second] = shotResults(data, shotId, "video");
  chooseVideo(data, shotId, first.id);
  editCut(data, episodeId, (cut) => {
    cut.captions = true;
  });
  chooseVideo(data, shotId, second.id);
  expect(getCut(data, episodeId).clips[0].takeId).toBe(first.id);
  const snapshot = renderSnapshot(data, episodeId);
  syncChosenTakes(data, episodeId);
  expect(getCut(data, episodeId).clips[0].takeId).toBe(second.id);
  expect(snapshot.clips[0].takeId).toBe(first.id);
  expect(dataSchema.parse(data).episodes[episodeId].cut?.captions).toBe(true);
});
it("reuses saved video footage without duplicating shots or takes and rejects another episode", () => {
  const { data, episodeId, shotId } = fixture();
  generateProduceBatch(data, shotId, "image", 1);
  finish(data, shotId);
  chooseFrame(data, shotId, shotResults(data, shotId, "image")[0].id);
  generateProduceBatch(data, shotId, "video", 1);
  finish(data, shotId);
  const take = shotResults(data, shotId, "video")[0];
  const shots = Object.keys(data.shots),
    takes = Object.keys(data.takes);
  appendCutTake(data, episodeId, take.id);
  appendCutTake(data, episodeId, take.id);
  expect(getCut(data, episodeId).clips).toHaveLength(2);
  expect(Object.keys(data.shots)).toEqual(shots);
  expect(Object.keys(data.takes)).toEqual(takes);
  expect(data.shots[shotId].currentTakeId).toBeUndefined();
  expect(() => appendCutTake(data, "ep2", take.id)).toThrow(/this episode/);
});
it("migrates copied overrides without removing intentional differences or history", () => {
  const { data, sceneId, shotId } = fixture();
  data.shots[shotId].generationOverride = {
    ...generationInputs(data, sceneId),
    instructions: "Intentional",
  };
  migrateProduce(data);
  expect(data.shots[shotId].generationOverride).toEqual({
    instructions: "Intentional",
  });
});
it.each([
  ["view=script", false, "plan"],
  ["view=board", false, "shots"],
  ["view=timeline", false, "final"],
  ["view=review", false, "final"],
  ["stage=scene", true, "plan"],
  ["stage=frame", true, "shots"],
  ["stage=motion", true, "takes"],
  ["stage=review", true, "takes"],
])("maps legacy %s to the canonical stage", (query, shotRoute, stage) => {
  expect(produceStage(new URLSearchParams(query), shotRoute)).toBe(stage);
});

it("freezes planned I2V direction in video jobs while duration edits preserve the chosen clip's trim", () => {
  const { data, sceneId, shotId } = fixture();
  generateProduceBatch(data, shotId, "image", 1);
  finish(data, shotId);
  chooseFrame(data, shotId, shotResults(data, shotId, "image")[0].id);
  saveGenerationInputs(
    data,
    sceneId,
    {
      craft: {
        ...generationInputs(data, sceneId, shotId).craft,
        endingBeat: "Hold the final gaze.",
        cameraSpeed: "Slow and gentle",
      },
    },
    shotId,
  );
  generateProduceBatch(data, shotId, "video", 1);
  finish(data, shotId);
  const take = shotResults(data, shotId, "video")[0];
  chooseVideo(data, shotId, take.id);
  const clip = {
    inFrame: data.shots[shotId].inFrame,
    outFrame: data.shots[shotId].outFrame,
    currentTakeId: data.shots[shotId].currentTakeId,
  };
  const job = Object.values(data.jobs).find(
    (item) => item.shotId === shotId && item.operation === "video",
  )!;
  expect(job.inputs?.instructions).toContain(
    "End of take: Hold the final gaze.",
  );
  planShotDuration(data, shotId, 8);
  expect(data.shots[shotId]).toMatchObject({
    ...clip,
    targetFrames: 240,
    stale: true,
  });
  saveGenerationInputs(
    data,
    sceneId,
    {
      craft: {
        ...generationInputs(data, sceneId, shotId).craft,
        endingBeat: "End on the letter.",
      },
    },
    shotId,
  );
  expect(job.inputs?.craft?.endingBeat).toBe("Hold the final gaze.");
  expect(generationInputSnapshot(data, shotId).instructions).toContain(
    "End of take: End on the letter.",
  );
});

it("generates frames without the legacy source-approval, scene-total and optional-reference gates", () => {
  const { data, episodeId, sceneId, shotId } = fixture();
  data.projects.midnight.strictApprovals = true;
  data.episodes[episodeId].scriptApprovedRevision = undefined;
  data.scenes[sceneId].planApprovedRevision = undefined;
  data.studio.setups[sceneId].targetSeconds = 100;
  data.studio.setups[sceneId].locationMode = "required";
  data.studio.setups[sceneId].locationId = undefined;
  const credits = data.credits;
  expect(() => generateProduceBatch(data, shotId, "image", 2)).not.toThrow();
  const job = Object.values(data.jobs).find((item) => item.shotId === shotId)!;
  expect(job).toMatchObject({
    operation: "image",
    state: "queued",
    outputCount: 2,
    cost: 16,
  });
  expect(data.credits).toBe(credits - 16);
  expect(data.episodes[episodeId].scriptApprovedRevision).toBeUndefined();
  expect(data.scenes[sceneId].planApprovedRevision).toBeUndefined();
  finish(data, shotId);
  expect(shotResults(data, shotId, "image")).toHaveLength(2);
});
it("still validates operational generation requirements and active episode ownership", () => {
  const { data, episodeId, shotId } = fixture();
  data.episodes[episodeId].archived = true;
  expect(() => generateProduceBatch(data, shotId, "image", 1)).toThrow(
    /active episode/,
  );
  data.episodes[episodeId].archived = false;
  data.shots[shotId].locked = true;
  expect(() => generateProduceBatch(data, shotId, "image", 1)).toThrow(
    /Unlock/,
  );
  data.shots[shotId].locked = false;
  data.credits = 0;
  expect(() => generateProduceBatch(data, shotId, "image", 1)).toThrow(
    /credits/,
  );
});
