import { uid, type Data } from "./types";
export function activeEpisodeShots(data: Data, episodeId: string) {
  const episode = data.episodes[episodeId];
  if (!episode || episode.archived) return [];
  return episode.sceneIds.flatMap((sceneId) => {
    const scene = data.scenes[sceneId];
    if (!scene || scene.archived || scene.episodeId !== episodeId) return [];
    return scene.shotIds
      .map((id) => data.shots[id])
      .filter((shot) => shot && !shot.archived && shot.sceneId === sceneId);
  });
}

/** Approval belongs to the exact assembled cut, including source revisions and trims. */
export function cutSignature(data: Data, episodeId: string) {
  return JSON.stringify(
    activeEpisodeShots(data, episodeId).map((shot) => [
      shot.id,
      shot.revision,
      shot.stale,
      shot.currentTakeId,
      shot.inFrame,
      shot.outFrame,
      shot.volume ?? 1,
      data.takes[shot.currentTakeId ?? ""]?.approved,
      data.assets[data.takes[shot.currentTakeId ?? ""]?.assetId ?? ""]?.missing,
      data.assets[data.takes[shot.currentTakeId ?? ""]?.assetId ?? ""]
        ?.archived,
      data.assets[data.takes[shot.currentTakeId ?? ""]?.assetId ?? ""]?.url,
    ]),
  );
}

export function addCutNote(
  data: Data,
  episodeId: string,
  frame: number,
  text: string,
  shotId?: string,
) {
  const episode = data.episodes[episodeId];
  if (!episode || episode.archived) throw Error("Episode unavailable.");
  const body = text.trim();
  if (!body || body.length > 2000)
    throw Error("Write a note under 2,000 characters.");
  const total = activeEpisodeShots(data, episodeId).reduce(
    (n, shot) => n + shot.outFrame - shot.inFrame,
    0,
  );
  const notes = (episode.cutReview ??= { notes: [] }).notes;
  notes.push({
    id: uid("cut-note"),
    text: body,
    frame: Math.max(0, Math.min(Math.max(0, total - 1), Math.round(frame))),
    resolved: false,
    shotId,
    version: episode.timelineVersion,
    createdAt: Date.now(),
  });
  delete episode.cutReview!.approvedSignature;
}

export function resolveCutNote(data: Data, episodeId: string, noteId: string) {
  const note = data.episodes[episodeId]?.cutReview?.notes.find(
    (note) => note.id === noteId,
  );
  if (!note) throw Error("Feedback no longer exists.");
  note.resolved = !note.resolved;
  delete data.episodes[episodeId].cutReview!.approvedSignature;
}

export function approveEpisodeCut(data: Data, episodeId: string) {
  const episode = data.episodes[episodeId];
  if (!episode || episode.archived) throw Error("Episode unavailable.");
  const shots = activeEpisodeShots(data, episodeId);
  if (
    !shots.length ||
    shots.some((shot) => {
      const take = data.takes[shot.currentTakeId ?? ""],
        asset = data.assets[take?.assetId ?? ""];
      return (
        !take ||
        take.kind !== "video" ||
        !take.approved ||
        take.revision !== shot.revision ||
        shot.stale ||
        !asset?.url ||
        asset.missing ||
        asset.archived
      );
    })
  )
    throw Error("Approve all video takes before approving the episode cut.");
  const review = (episode.cutReview ??= { notes: [] });
  if (review.notes.some((note) => !note.resolved))
    throw Error("Resolve the open feedback before approving the cut.");
  review.approvedSignature = cutSignature(data, episodeId);
}
