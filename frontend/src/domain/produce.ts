import { CONFIG, uid, type Data, type Shot } from "./types";
import { ensureSetup, referenceSnapshot } from "./scene-preflight";
import {
  generationInputs,
  generationInputSnapshot,
  effectiveWorldElements,
} from "./generation-inputs";
import { markShotsStale } from "./studio-commands";
import { isBusy } from "./selectors";

export function produceScenes(data: Data, episodeId: string) {
  return (data.episodes[episodeId]?.sceneIds ?? [])
    .map((id) => data.scenes[id])
    .filter(
      (scene) => scene && !scene.archived && scene.episodeId === episodeId,
    );
}
export function produceShots(data: Data, sceneId: string) {
  return (data.scenes[sceneId]?.shotIds ?? [])
    .map((id) => data.shots[id])
    .filter(
      (shot): shot is Shot =>
        !!shot && !shot.archived && shot.sceneId === sceneId,
    );
}
export function shotResults(
  data: Data,
  shotId: string,
  kind: "image" | "video",
) {
  return Object.values(data.takes)
    .filter((take) => {
      const asset = data.assets[take.assetId];
      return (
        take.shotId === shotId &&
        take.kind === kind &&
        asset?.url &&
        !asset.missing &&
        !asset.archived &&
        !data.shots[shotId]?.discardedTakeIds?.includes(take.id)
      );
    })
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/** Resolve dynamically: the scene stores no copied generated-media URL. */
export function scenePreview(data: Data, sceneId: string) {
  const shots = produceShots(data, sceneId);
  for (const shot of shots) {
    const chosen = data.takes[shot.imageTakeId ?? ""];
    const take =
      chosen?.approved &&
      shotResults(data, shot.id, "image").some((t) => t.id === chosen.id)
        ? chosen
        : shotResults(data, shot.id, "image")[0];
    if (take)
      return {
        url: data.assets[take.assetId].url,
        shotId: shot.id,
        sample: false,
        status:
          take.id === shot.imageTakeId && take.approved
            ? take.revision === shot.revision
              ? null
              : "Outdated frame"
            : "Generated candidate",
      };
  }
  return {
    url: data.scenes[sceneId]?.cover || "/media/director-desk/cafe.png",
    sample: true,
    status: "Sample preview",
  };
}

export function chooseFrame(data: Data, shotId: string, takeId: string) {
  const shot = data.shots[shotId],
    take = data.takes[takeId];
  if (
    !shot ||
    shot.locked ||
    take?.shotId !== shotId ||
    take.kind !== "image" ||
    !shotResults(data, shotId, "image").some((item) => item.id === takeId)
  )
    throw Error("Choose an available frame from this shot.");
  shot.imageTakeId = take.id;
  take.approved = true;
  // Frame selection is an editorial pointer, not a new generation revision.
  shot.generationOverride = {
    ...shot.generationOverride,
    startingFrameAssetId: take.assetId,
    videoMode: "image_first",
  };
}

export function chooseVideo(data: Data, shotId: string, takeId: string) {
  const shot = data.shots[shotId],
    take = data.takes[takeId];
  if (
    !shot ||
    shot.locked ||
    take?.shotId !== shotId ||
    take.kind !== "video" ||
    !shotResults(data, shotId, "video").some((item) => item.id === takeId)
  )
    throw Error("Choose an available take from this shot.");
  shot.currentTakeId = takeId;
  take.approved = true;
  shot.stale = take.revision !== shot.revision;
  if (shot.candidateTakeId === takeId) delete shot.candidateTakeId;
  data.episodes[data.scenes[shot.sceneId].episodeId].timelineVersion++;
}

/** Append a batch to the existing job model. Browsing and chosen pointers are separate. */
export function generateProduceBatch(
  data: Data,
  shotId: string,
  kind: "image" | "video",
  count: number,
) {
  const shot = data.shots[shotId];
  if (!shot || shot.archived) throw Error("Shot unavailable.");
  if (shot.locked) throw Error("Unlock the shot before generating.");
  if (isBusy(data, shotId))
    throw Error("Wait for the current generation to finish.");
  if (![1, 2, 3, 4].includes(count)) throw Error("Choose 1–4 results.");
  const scene = data.scenes[shot.sceneId],
    episode = scene && data.episodes[scene.episodeId],
    project = episode && data.projects[episode.projectId];
  if (
    !scene ||
    scene.archived ||
    !episode ||
    episode.archived ||
    !project ||
    project.archived ||
    !scene.shotIds.includes(shotId) ||
    !episode.sceneIds.includes(scene.id) ||
    !project.episodeIds.includes(episode.id)
  )
    throw Error("This shot is no longer in an active episode.");
  ensureSetup(data, scene.id);
  const input = generationInputs(data, scene.id, shotId);
  if (kind === "video") {
    const frame = data.assets[input.startingFrameAssetId ?? ""];
    if (
      !frame?.url ||
      frame.missing ||
      frame.archived ||
      frame.kind !== "image" ||
      frame.projectId !== episode.projectId
    )
      throw Error("Choose a starting frame in Shots first.");
  }
  // Produce has no source-approval step. Optional reference/readiness checks from
  // the legacy workspace must not gate iterative frame or take generation.
  const cost = count * (kind === "image" ? CONFIG.imageCost : CONFIG.videoCost);
  if (data.credits < cost) throw Error(`This batch requires ${cost} credits.`);
  const inputs = generationInputSnapshot(data, shotId, kind);
  const sourceFrame = shotResults(data, shotId, "image").find(
    (take) => take.assetId === input.startingFrameAssetId,
  );
  const id = uid("job");
  data.jobs[id] = {
    id,
    projectId: episode.projectId,
    episodeId: episode.id,
    sceneId: scene.id,
    shotId,
    operation: kind,
    state: "queued",
    attempt:
      1 + Object.values(data.jobs).filter((j) => j.shotId === shotId).length,
    cost,
    progress: 0,
    revision: shot.revision,
    replacement: true,
    outputCount: count,
    sourceTakeId: kind === "video" ? sourceFrame?.id : undefined,
    inputs,
    references: referenceSnapshot(data, shotId),
  };
  data.credits -= cost;
}

export function setSceneProps(data: Data, sceneId: string, ids: string[]) {
  const scene = data.scenes[sceneId],
    project = data.projects[data.episodes[scene.episodeId].projectId];
  if (ids.some((id) => !project.worldElements?.some((item) => item.id === id)))
    throw Error("Choose props from this production.");
  const setup = ensureSetup(data, sceneId);
  if (JSON.stringify(setup.worldElementIds ?? []) === JSON.stringify(ids))
    return;
  setup.worldElementIds = [...new Set(ids)];
  setup.revision++;
  markShotsStale(
    data,
    scene.shotIds.filter((id) => !data.shots[id].worldElementIds),
  );
}

/** One-time upgrade: retain intentional overrides, remove copied defaults. */
export function migrateProduce(data: Data) {
  for (const scene of Object.values(data.scenes)) {
    const setup = ensureSetup(data, scene.id);
    setup.worldElementIds ??= [
      ...new Set(
        produceShots(data, scene.id).flatMap(
          (shot) => shot.worldElementIds ?? [],
        ),
      ),
    ];
    for (const shot of produceShots(data, scene.id)) {
      const override = shot.generationOverride;
      if (override) {
        const inherited = generationInputs(data, scene.id);
        for (const key of Object.keys(override) as (keyof typeof override)[]) {
          if (JSON.stringify(override[key]) === JSON.stringify(inherited[key]))
            delete override[key];
        }
      }
      if (JSON.stringify(shot.castOverride) === JSON.stringify(setup.cast))
        delete shot.castOverride;
      if (
        JSON.stringify(shot.worldElementIds) ===
        JSON.stringify(setup.worldElementIds)
      )
        delete shot.worldElementIds;
    }
  }
}

export { effectiveWorldElements };

/** Informational progress, independent of the generation eligibility checks. */
export function produceProgress(data: Data, episodeId: string) {
  const scenes = produceScenes(data, episodeId),
    shots = scenes.flatMap((scene) => produceShots(data, scene.id));
  const planned =
    !!scenes.length &&
    scenes.every((scene) => {
      const items = produceShots(data, scene.id);
      return (
        items.length > 0 &&
        items.every((shot) => shot.title.trim() && shot.action.trim())
      );
    });
  const available = (assetId?: string, kind?: string) => {
    const asset = data.assets[assetId ?? ""];
    return (
      !!asset?.url &&
      !asset.missing &&
      !asset.archived &&
      (!kind || asset.kind === kind) &&
      asset.projectId === data.episodes[episodeId]?.projectId
    );
  };
  const frames =
    planned &&
    shots.every((shot) => {
      const id = generationInputs(
        data,
        shot.sceneId,
        shot.id,
      ).startingFrameAssetId;
      const take = Object.values(data.takes).find(
        (item) => item.assetId === id,
      );
      return (
        available(id, "image") &&
        (!take ||
          (take.shotId === shot.id &&
            take.kind === "image" &&
            shot.imageTakeId === take.id &&
            shotResults(data, shot.id, "image").some(
              (item) => item.id === take.id,
            ) &&
            take.approved &&
            take.revision === shot.revision))
      );
    });
  const takes =
    frames &&
    shots.every((shot) => {
      const take = data.takes[shot.currentTakeId ?? ""];
      return (
        take?.shotId === shot.id &&
        take.kind === "video" &&
        take.approved &&
        take.revision === shot.revision &&
        !shot.stale &&
        !shot.discardedTakeIds?.includes(take.id) &&
        available(take.assetId, "video")
      );
    });
  return [planned, frames, takes];
}
