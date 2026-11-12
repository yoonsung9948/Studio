import { uid, type Data } from "./types";
import {
  episodeCutSchema,
  type CutAudio,
  type CutClip,
  type EpisodeCut,
} from "./cut-schema";
import { produceScenes, produceShots } from "./produce";

export function initialCut(data: Data, episodeId: string): EpisodeCut {
  const shots = produceScenes(data, episodeId).flatMap((scene) =>
    produceShots(data, scene.id),
  );
  return {
    revision: 1,
    captions: false,
    aspectRatio: "16:9",
    audio: [],
    clips: shots.flatMap((shot) => {
      const take = data.takes[shot.currentTakeId ?? ""];
      return take
        ? [
            {
              id: `clip-${shot.id}`,
              shotId: shot.id,
              takeId: take.id,
              inFrame: shot.inFrame,
              outFrame: Math.min(shot.outFrame, take.sourceFrames),
              volume: shot.volume ?? 1,
            },
          ]
        : [];
    }),
  };
}
export function getCut(data: Data, episodeId: string) {
  return data.episodes[episodeId]?.cut ?? initialCut(data, episodeId);
}
export function editCut(
  data: Data,
  episodeId: string,
  change: (cut: EpisodeCut) => void,
) {
  const episode = data.episodes[episodeId];
  if (!episode || episode.archived) throw Error("Episode unavailable.");
  const cut = structuredClone(getCut(data, episodeId));
  change(cut);
  validateCut(data, episodeId, cut);
  cut.revision++;
  episode.cut = episodeCutSchema.parse(cut);
  episode.timelineVersion++;
}
export function validateCut(data: Data, episodeId: string, cut: EpisodeCut) {
  episodeCutSchema.parse(cut);
  if (new Set(cut.clips.map((clip) => clip.id)).size !== cut.clips.length)
    throw Error("Clip IDs must be unique.");
  for (const clip of cut.clips) {
    const take = data.takes[clip.takeId],
      shot = data.shots[clip.shotId];
    if (
      !take ||
      take.shotId !== shot?.id ||
      take.kind !== "video" ||
      data.scenes[shot.sceneId]?.episodeId !== episodeId ||
      clip.outFrame <= clip.inFrame ||
      clip.outFrame > take.sourceFrames
    )
      throw Error("Choose valid footage and trim within its source duration.");
  }
  for (const track of cut.audio) {
    const asset = data.assets[track.assetId];
    if (
      !asset ||
      asset.kind !== "audio" ||
      asset.projectId !== data.episodes[episodeId].projectId ||
      track.outFrame <= track.inFrame
    )
      throw Error("Choose available audio from this production.");
  }
}
export function updateCutClip(
  data: Data,
  episodeId: string,
  clipId: string,
  fields: Partial<Omit<CutClip, "id" | "shotId">>,
) {
  editCut(data, episodeId, (cut) => {
    const clip = cut.clips.find((item) => item.id === clipId);
    if (!clip) throw Error("Choose a clip first.");
    Object.assign(clip, fields);
  });
}
/** Reuse footage in the cut without creating another planned shot or take. */
export function appendCutTake(data: Data, episodeId: string, takeId: string) {
  const take = data.takes[takeId],
    shot = data.shots[take?.shotId ?? ""];
  const asset = data.assets[take?.assetId ?? ""];
  if (
    !take ||
    take.kind !== "video" ||
    !shot ||
    shot.archived ||
    data.scenes[shot.sceneId]?.episodeId !== episodeId ||
    !asset?.url ||
    asset.archived ||
    asset.missing
  )
    throw Error("Choose available footage from this episode.");
  editCut(data, episodeId, (cut) =>
    cut.clips.push({
      id: uid("clip"),
      shotId: shot.id,
      takeId,
      inFrame: 0,
      outFrame: take.sourceFrames,
      volume: shot.volume ?? 1,
    }),
  );
}
export function splitCutClip(
  data: Data,
  episodeId: string,
  clipId: string,
  offset: number,
) {
  editCut(data, episodeId, (cut) => {
    const index = cut.clips.findIndex((clip) => clip.id === clipId),
      clip = cut.clips[index];
    if (!clip || offset <= 0 || offset >= clip.outFrame - clip.inFrame)
      throw Error("Place the playhead inside the clip.");
    const point = clip.inFrame + Math.round(offset);
    cut.clips.splice(index + 1, 0, {
      ...clip,
      id: uid("clip"),
      inFrame: point,
    });
    clip.outFrame = point;
  });
}
export function syncChosenTakes(data: Data, episodeId: string) {
  editCut(data, episodeId, (cut) => {
    for (const source of initialCut(data, episodeId).clips) {
      const existing = cut.clips.filter(
        (clip) => clip.shotId === source.shotId,
      );
      if (!existing.length) cut.clips.push(source);
      else
        for (const clip of existing) {
          clip.takeId = source.takeId;
          clip.outFrame = Math.min(
            clip.outFrame,
            data.takes[source.takeId].sourceFrames,
          );
          if (clip.inFrame >= clip.outFrame) clip.inFrame = 0;
        }
    }
  });
}
export function addCutAudio(
  data: Data,
  episodeId: string,
  assetId: string,
  sourceFrames: number,
  role: CutAudio["role"],
) {
  editCut(data, episodeId, (cut) =>
    cut.audio.push({
      id: uid("audio"),
      assetId,
      title: data.assets[assetId]?.title ?? "Audio",
      role,
      startFrame: 0,
      inFrame: 0,
      outFrame: Math.round(sourceFrames),
      volume: role === "music" ? 0.3 : 0.7,
      muted: false,
    }),
  );
}
export const cutDuration = (cut: EpisodeCut) =>
  cut.clips.reduce((frames, clip) => frames + clip.outFrame - clip.inFrame, 0);

/** Immutable render input, including exact take lineage and independent audio tracks. */
export function renderSnapshot(data: Data, episodeId: string) {
  const cut = getCut(data, episodeId);
  validateCut(data, episodeId, cut);
  if (!cut.clips.length) throw Error("Choose video takes before rendering.");
  return structuredClone({
    episodeId,
    title: data.episodes[episodeId].title,
    fps: 30,
    ...cut,
    clips: cut.clips.map((clip) => {
      const take = data.takes[clip.takeId],
        asset = data.assets[take.assetId];
      if (!asset?.url || asset.missing || asset.archived)
        throw Error("Reattach missing clip media before rendering.");
      return {
        ...clip,
        asset,
        references: take.references,
        inputs: take.inputs,
        dialogue: data.shots[clip.shotId].dialogue,
      };
    }),
    audio: cut.audio.map((track) => ({
      ...track,
      asset: data.assets[track.assetId],
    })),
  });
}
