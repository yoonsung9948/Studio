import type { Data, Shot } from "../../domain/types";
import { active, isBusy } from "../../domain/selectors";
export function sceneShots(data: Data, sceneId: string) {
  return (data.scenes[sceneId]?.shotIds ?? [])
    .map((id) => data.shots[id])
    .filter((shot): shot is Shot => !!shot && !shot.archived);
}
export function readyMedia(data: Data, shot: Shot, kind: "image" | "video") {
  const take =
    data.takes[
      (kind === "image" ? shot.imageTakeId : shot.currentTakeId) ?? ""
    ];
  const asset = data.assets[take?.assetId ?? ""];
  return (
    !!take &&
    take.kind === kind &&
    take.approved &&
    take.revision === shot.revision &&
    !shot.stale &&
    !!asset?.url &&
    !asset.missing &&
    !asset.archived
  );
}
export function boardShotStatus(data: Data, shot: Shot) {
  if (isBusy(data, shot.id)) return { label: "Generating", tone: "amber" };
  if (shot.stale) return { label: "Needs update", tone: "amber" };
  if (readyMedia(data, shot, "video"))
    return { label: "Video ready", tone: "success" };
  const candidate = data.takes[shot.candidateTakeId ?? ""];
  if (
    candidate &&
    data.assets[candidate.assetId]?.url &&
    !data.assets[candidate.assetId]?.missing
  )
    return { label: "Review video", tone: "blue" };
  const frame = data.takes[shot.imageTakeId ?? ""];
  if (
    frame &&
    frame.revision === shot.revision &&
    data.assets[frame.assetId]?.url &&
    !data.assets[frame.assetId]?.missing
  )
    return { label: "Frame ready", tone: "blue" };
  if (
    Object.values(data.jobs)
      .filter((job) => job.shotId === shot.id)
      .at(-1)?.state === "failed"
  )
    return { label: "Generation failed", tone: "error" };
  return { label: "Draft", tone: "neutral" };
}
export function sceneReadiness(data: Data, sceneId: string) {
  const shots = sceneShots(data, sceneId),
    episode = data.episodes[data.scenes[sceneId].episodeId];
  return {
    script:
      !!episode?.script.trim() &&
      episode.scriptApprovedRevision === (episode.scriptRevision ?? 1),
    frames: shots.filter((shot) => readyMedia(data, shot, "image")).length,
    videos: shots.filter((shot) => readyMedia(data, shot, "video")).length,
    generating: Object.values(data.jobs).filter(
      (job) => job.sceneId === sceneId && active(job),
    ).length,
    total: shots.length,
  };
}
