import type { Data, Episode } from "../../domain/types";
import { active, shotsOfEpisode } from "../../domain/selectors";
import { generationInputs } from "../../domain/generation-inputs";

export function productionEpisodes(data: Data, projectId: string) {
  return (data.projects[projectId]?.episodeIds ?? [])
    .map((id) => data.episodes[id])
    .filter((episode): episode is Episode => !!episode && !episode.archived);
}
export function episodeProgress(data: Data, episodeId: string) {
  const shots = shotsOfEpisode(data, episodeId).filter(
    (shot) => !shot.archived && !data.scenes[shot.sceneId]?.archived,
  );
  const ready = shots.filter((shot) => {
    const take = data.takes[shot.currentTakeId ?? ""];
    const asset = data.assets[take?.assetId ?? ""];
    return (
      take?.kind === "video" &&
      take.approved &&
      take.revision === shot.revision &&
      !shot.stale &&
      asset?.url &&
      !asset.missing
    );
  }).length;
  const started =
    shots.some(
      (shot) => shot.imageTakeId || shot.currentTakeId || shot.candidateTakeId,
    ) ||
    Object.values(data.jobs).some(
      (job) => job.episodeId === episodeId && active(job),
    );
  return {
    shots,
    ready,
    total: shots.length,
    status:
      shots.length > 0 && ready === shots.length
        ? "Ready to review"
        : started
          ? "In progress"
          : "Draft",
  };
}
export function productionFacts(data: Data, projectId: string) {
  const episodes = productionEpisodes(data, projectId);
  const scenes = episodes
    .flatMap((episode) => episode.sceneIds)
    .filter((id) => data.scenes[id] && !data.scenes[id].archived);
  const ratios = [
    ...new Set(
      scenes.flatMap((id) => [
        generationInputs(data, id).aspectRatio,
        ...data.scenes[id].shotIds
          .filter((shotId) => !data.shots[shotId]?.archived)
          .map((shotId) => generationInputs(data, id, shotId).aspectRatio),
      ]),
    ),
  ];
  const styles = [
    ...new Set(
      [
        ...episodes.map((episode) => episode.style?.trim()),
        ...scenes.map((id) => data.studio.setups[id]?.direction.style.trim()),
      ].filter((style): style is string => !!style),
    ),
  ];
  return [
    {
      label: "Format",
      value:
        data.projects[projectId].format ||
        (episodes.length > 1 ? "Series" : "Short film"),
    },
    {
      label: "Episodes",
      value: `${episodes.length} ${episodes.length === 1 ? "episode" : "episodes"}`,
    },
    {
      label: "Aspect ratio",
      value:
        ratios.length === 1
          ? ratios[0]
          : ratios.length
            ? "Mixed formats"
            : "Not set",
    },
    {
      label: "Visual style",
      value:
        styles.length === 1
          ? styles[0]
          : styles.length
            ? "Varies by scene"
            : "Not set",
    },
  ];
}
export interface ProductionEvent {
  id: string;
  title: string;
  detail: string;
  kind: "script" | "frame" | "video";
  href: string;
  thumbnail?: string;
  occurredAt?: number;
}
/** Only recorded events and approval states are shown; missing timestamps stay unspecified. */
export function productionEvents(
  data: Data,
  projectId: string,
): ProductionEvent[] {
  const events: ProductionEvent[] = [];
  for (const episode of productionEpisodes(data, projectId)) {
    const number = data.projects[projectId].episodeIds.indexOf(episode.id) + 1;
    const detail = `Episode ${String(number).padStart(2, "0")} · ${episode.title}`;
    const href = `/projects/${projectId}/episodes/${episode.id}`;
    for (const approval of episode.scriptHistory ?? [])
      events.push({
        id: `script-${episode.id}-${approval.revision}`,
        title: "Script approved",
        detail,
        kind: "script",
        href: `${href}?view=script`,
        occurredAt: approval.approvedAt || undefined,
      });
    for (const shot of episodeProgress(data, episode.id).shots) {
      for (const take of Object.values(data.takes).filter(
        (take) =>
          take.shotId === shot.id && !shot.discardedTakeIds?.includes(take.id),
      )) {
        const asset = data.assets[take.assetId];
        if (!asset || asset.archived) continue;
        events.push({
          id: take.id,
          title:
            take.kind === "video"
              ? take.approved
                ? "Video approved"
                : "Video generated"
              : take.approved
                ? "Frame approved"
                : "Frame generated",
          detail,
          kind: take.kind === "video" ? "video" : "frame",
          href: `${href}/shots/${shot.id}?stage=${take.kind === "video" ? "review" : "frame"}`,
          thumbnail:
            asset.kind === "image" && !asset.missing ? asset.url : undefined,
          // Approval dates were not recorded on takes. Do not relabel generation dates as approval dates.
          occurredAt:
            !take.approved && take.createdAt > 0 ? take.createdAt : undefined,
        });
      }
    }
  }
  return events.sort((a, b) => (b.occurredAt ?? 0) - (a.occurredAt ?? 0));
}
export function relativeEventTime(timestamp: number, now = Date.now()) {
  const seconds = Math.round((timestamp - now) / 1000);
  const amount = Math.abs(seconds);
  const [divisor, unit] =
    amount < 60
      ? [1, "second"]
      : amount < 3600
        ? [60, "minute"]
        : amount < 86400
          ? [3600, "hour"]
          : [86400, "day"];
  return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(
    Math.round(seconds / Number(divisor)),
    unit as Intl.RelativeTimeFormatUnit,
  );
}
