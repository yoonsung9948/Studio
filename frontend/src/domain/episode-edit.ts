import { isBusy } from "./selectors";
import { uid, type Data } from "./types";

/** Split an edit without regenerating media or changing its source direction. */
export function splitEditClip(
  data: Data,
  shotId: string,
  offsetFrames: number,
) {
  const shot = data.shots[shotId];
  if (!shot || shot.archived) throw Error("Choose a clip in this episode.");
  if (shot.locked || isBusy(data, shotId))
    throw Error(
      "Unlock the clip and wait for generation to finish before splitting.",
    );
  const cut = shot.inFrame + Math.round(offsetFrames);
  if (cut <= shot.inFrame || cut >= shot.outFrame)
    throw Error("Place the playhead inside the selected clip to split it.");
  const id = uid("shot"),
    next = structuredClone(shot);
  next.id = id;
  next.title = `${shot.title} · part 2`;
  next.inFrame = cut;
  next.dependsOn = undefined;
  next.discardedTakeIds = [];
  // Takes belong to shots; copy their metadata while sharing immutable media assets.
  for (const field of [
    "currentTakeId",
    "imageTakeId",
    "candidateTakeId",
  ] as const) {
    const source = data.takes[shot[field] ?? ""];
    if (!source) {
      delete next[field];
      continue;
    }
    const takeId = uid("take");
    data.takes[takeId] = { ...structuredClone(source), id: takeId, shotId: id };
    next[field] = takeId;
  }
  shot.outFrame = cut;
  data.shots[id] = next;
  const scene = data.scenes[shot.sceneId];
  scene.shotIds.splice(scene.shotIds.indexOf(shotId) + 1, 0, id);
  data.episodes[scene.episodeId].timelineVersion++;
  return id;
}

export function insertEditMedia(
  data: Data,
  sceneId: string,
  assetId: string,
  seconds: number,
) {
  const scene = data.scenes[sceneId],
    asset = data.assets[assetId];
  const episode = scene && data.episodes[scene.episodeId];
  if (
    !episode ||
    !asset ||
    asset.projectId !== episode.projectId ||
    asset.archived ||
    asset.missing ||
    !asset.url ||
    asset.kind === "audio"
  )
    throw Error("Choose an available image or video from this production.");
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 30)
    throw Error("Choose a source duration from 1 to 30 seconds.");
  const id = uid("shot"),
    takeId = uid("take"),
    frames = Math.round(seconds * 30);
  data.shots[id] = {
    id,
    sceneId,
    title: asset.title,
    action: "",
    dialogue: "",
    characters: [],
    targetFrames: frames,
    inFrame: 0,
    outFrame: frames,
    revision: 1,
    stale: false,
    ...(asset.kind === "video"
      ? { currentTakeId: takeId }
      : { imageTakeId: takeId }),
  };
  data.takes[takeId] = {
    id: takeId,
    shotId: id,
    kind: asset.kind,
    revision: 1,
    approved: true,
    sourceFrames: frames,
    assetId,
    createdAt: Date.now(),
  };
  scene.shotIds.push(id);
  episode.timelineVersion++;
  return id;
}
