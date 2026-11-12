import { useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useStore } from "../../stores/store";
import {
  produceStage,
  produceUrl,
  type ProduceStage,
} from "../../domain/produce-route";
import { produceScenes, produceShots } from "../../domain/produce";
import { useSelection } from "../selection";

export function useProduce() {
  const { projectId = "", episodeId = "", shotId: legacyShotId } = useParams();
  const data = useStore((state) => state.data);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const episode = data.episodes[episodeId];
  const scenes = produceScenes(data, episodeId);
  const stage = produceStage(params, !!legacyShotId);
  const requestedShot = data.shots[params.get("shot") ?? legacyShotId ?? ""];
  const scopedShot =
    requestedShot &&
    !requestedShot.archived &&
    scenes.some((scene) => scene.id === requestedShot.sceneId)
      ? requestedShot
      : undefined;
  const invalidShotRoute = !!legacyShotId && !scopedShot;
  const scene =
    scenes.find((item) => item.id === scopedShot?.sceneId) ??
    scenes.find((item) => item.id === params.get("scene")) ??
    scenes[0];
  const shots = scene ? produceShots(data, scene.id) : [];
  const shot =
    scopedShot ??
    shots.find(
      (item) => item.id === useStore.getState().ui.selectedShots[scene?.id],
    ) ??
    shots[0];
  const allShots = scenes.flatMap((item) => produceShots(data, item.id));
  const href = (next: ProduceStage, nextScene?: string, nextShot?: string) => {
    const url = produceUrl(projectId, episodeId, next, nextScene, nextShot);
    return params.get("mode") === "demo" ? `${url}&mode=demo` : url;
  };
  const go = (next: ProduceStage, nextScene = scene?.id, nextShot?: string) => {
    const current = useStore.getState().data;
    const activeScenes = produceScenes(current, episodeId);
    const targetScene =
      activeScenes.find((item) => item.id === nextScene) ?? activeScenes[0];
    const activeShots = targetScene
      ? produceShots(current, targetScene.id)
      : [];
    const requestedId =
      nextShot ??
      (targetScene?.id === scene?.id ? shot?.id : undefined) ??
      useStore.getState().ui.selectedShots[targetScene?.id ?? ""];
    const selectedShot =
      activeShots.find((item) => item.id === requestedId) ?? activeShots[0];
    navigate(href(next, targetScene?.id, selectedShot?.id));
  };
  useEffect(() => {
    if (shot) {
      useSelection.getState().replace([`shot:${shot.id}`]);
      const ui = useStore.getState().ui;
      if (ui.selectedShots[shot.sceneId] !== shot.id)
        useStore.getState().setUI({
          selectedShots: { ...ui.selectedShots, [shot.sceneId]: shot.id },
        });
    }
    return () => useSelection.getState().replace([]);
  }, [shot?.id]);
  useEffect(() => {
    if (
      !invalidShotRoute &&
      (legacyShotId ||
        params.has("view") ||
        params.has("tab") ||
        !params.has("stage"))
    ) {
      navigate(href(stage, scene?.id, shot?.id), { replace: true });
    }
  }, [legacyShotId, params.toString(), projectId, episodeId]);
  return {
    data,
    episode,
    project: data.projects[projectId],
    scenes,
    scene,
    shots,
    shot,
    allShots,
    stage,
    go,
    href,
    invalidShotRoute,
  };
}
export type ProduceContext = ReturnType<typeof useProduce>;
