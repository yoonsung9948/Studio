import {
  CONFIG,
  FPS,
  type Data,
  type Shot,
  type GenerationJob,
  type Operation,
} from "./types";
export const active = (j: GenerationJob) =>
  ["queued", "waiting", "running"].includes(j.state);
export const shotsOfScene = (d: Data, id: string) =>
  d.scenes[id]?.shotIds.map((s) => d.shots[s]).filter(Boolean) ?? [];
export const shotsOfEpisode = (d: Data, id: string) =>
  d.episodes[id]?.sceneIds.flatMap((s) => shotsOfScene(d, s)) ?? [];
export function stage(d: Data, s: Shot): string {
  if (s.currentTakeId && d.takes[s.currentTakeId]?.approved)
    return s.stale ? "Approved · needs review" : "Approved";
  if (s.candidateTakeId) return "Review video";
  if (
    (s.generationOverride?.videoMode ??
      d.studio.setups[s.sceneId]?.generation?.videoMode) === "direct"
  )
    return "Generate video";
  if (!s.imageTakeId) return "Generate images";
  if (
    !d.takes[s.imageTakeId]?.approved ||
    d.takes[s.imageTakeId].revision !== s.revision
  )
    return "Review images";
  return "Generate video";
}
export const nextOperation = (d: Data, s: Shot): Operation | undefined => {
  const mode =
    s.generationOverride?.videoMode ??
    d.studio.setups[s.sceneId]?.generation?.videoMode;
  if (mode === "direct")
    return s.candidateTakeId &&
      d.takes[s.candidateTakeId]?.revision === s.revision
      ? undefined
      : !s.currentTakeId || s.stale
        ? "video"
        : undefined;
  return s.stale
    ? !s.imageTakeId || d.takes[s.imageTakeId]?.revision !== s.revision
      ? "image"
      : d.takes[s.imageTakeId]?.approved
        ? "video"
        : undefined
    : stage(d, s) === "Generate images"
      ? "image"
      : stage(d, s) === "Generate video"
        ? "video"
        : undefined;
};
export const isBusy = (d: Data, id: string) =>
  Object.values(d.jobs).some((j) => j.shotId === id && active(j));
export function dependencyReady(d: Data, shot: Shot) {
  return (
    !shot.dependsOn ||
    (!!d.shots[shot.dependsOn]?.currentTakeId && !d.shots[shot.dependsOn].stale)
  );
}
export function summary(d: Data, shots: Shot[]) {
  const counts: Record<string, number> = {};
  shots.forEach((s) => {
    const label = stage(d, s);
    const key: string =
      (
        {
          "Generate video": "ready for video",
          "Generate images": "ready for images",
          "Review images": "images need review",
          "Review video": "videos need review",
        } as Record<string, string>
      )[label] ?? label;
    counts[key] = (counts[key] ?? 0) + 1;
  });
  return Object.entries(counts)
    .map(([k, v]) => `${v} ${k.toLowerCase()}`)
    .join(" · ");
}
export const duration = (shots: Shot[]) =>
  shots.reduce((n, s) => n + s.outFrame - s.inFrame, 0) / FPS;
export const available = (d: Data, shots: Shot[]) =>
  shots.reduce(
    (n, s) =>
      n + (s.currentTakeId ? (d.takes[s.currentTakeId]?.sourceFrames ?? 0) : 0),
    0,
  ) / FPS;
export const timecode = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
export const costFor = (op: Operation) =>
  op === "video" ? CONFIG.videoCost : CONFIG.imageCost;
export interface WorkItem {
  shotId: string;
  operation: Operation;
  replacement: boolean;
  blocked: boolean;
  cost: number;
}
export function preflight(
  d: Data,
  ids: string[],
  replacement = false,
): WorkItem[] {
  return ids.flatMap((id) => {
    const s = d.shots[id];
    if (!s || isBusy(d, id)) return [];
    const op = replacement ? "video" : nextOperation(d, s);
    if (!op || (replacement && !s.currentTakeId)) return [];
    return [
      {
        shotId: id,
        operation: op,
        replacement,
        blocked: op === "video" && !dependencyReady(d, s),
        cost: costFor(op),
      },
    ];
  });
}
export const exportWarnings = (d: Data, id: string) => {
  const shots = shotsOfEpisode(d, id);
  const out: string[] = [];
  if (!shots.length) out.push("This episode has no shots.");
  const missing = shots.filter((s) => !s.currentTakeId).length;
  const review = shots.filter(
    (s) =>
      s.stale ||
      s.candidateTakeId ||
      (s.currentTakeId && !d.takes[s.currentTakeId]?.approved),
  ).length;
  if (missing) out.push(`${missing} shots have no approved footage.`);
  if (review) out.push(`${review} shots need review.`);
  return out;
};

export const displaySeconds = (seconds: number) =>
  Number(seconds.toFixed(2)).toString();
