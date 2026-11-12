import { useStore } from "../../stores/store";
import { shotAsset } from "../../domain/workspace";
import { activeEpisodeShots } from "../../domain/episode-review";
import { useSelection } from "../selection";
import { boardShotStatus } from "../episode-board/scene-presentation";
import type { Data, Shot } from "../../domain/types";

export function useEpisodeScope(episodeId: string) {
  const data = useStore((state) => state.data);
  const keys = useSelection((state) => state.keys);
  const episode = data.episodes[episodeId];
  const project = data.projects[episode.projectId];
  const scenes = episode.sceneIds
    .map((id) => data.scenes[id])
    .filter((scene) => scene && !scene.archived);
  const shots = activeEpisodeShots(data, episodeId);
  const key = keys.at(-1);
  const selectedShot = shots.find((shot) => key === `shot:${shot.id}`);
  const scene =
    scenes.find(
      (scene) =>
        scene.id ===
        (selectedShot?.sceneId ??
          (key?.startsWith("scene:") ? key.slice(6) : undefined)),
    ) ?? scenes[0];
  const shot = selectedShot ?? shots.find((shot) => shot.sceneId === scene?.id);
  return {
    data,
    episode,
    project,
    scenes,
    shots,
    scene,
    shot,
    episodeNumber: String(project.episodeIds.indexOf(episodeId) + 1).padStart(
      2,
      "0",
    ),
  };
}

export function shotPresentation(data: Data, shot: Shot) {
  const status = boardShotStatus(data, shot);
  return {
    ...status,
    label:
      status.label === "Draft"
        ? "Not started"
        : status.label === "Frame ready"
          ? "Frame chosen"
          : status.label,
    asset: shotAsset(data, shot),
    cover: data.scenes[shot.sceneId]?.cover,
  };
}
