import { useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useStore } from "../../stores/store";
import {
  episodeReferenceCharacters,
  localizeEpisodeLook,
  lookSceneUsage,
  referenceEpisode,
} from "../../domain/episode-characters";
import { AssetDetail } from "../assets/AssetDetail";
import { useAssetPath } from "../assets/asset-navigation";
import { commit } from "../generation";
import { episodeLookPath, episodeReferencesPath } from "./paths";

function LocalizeLook({
  episodeId,
  lookId,
  characterId,
}: {
  episodeId: string;
  lookId: string;
  characterId: string;
}) {
  const navigate = useNavigate(),
    path = useAssetPath();
  useEffect(() => {
    let id = "";
    if (
      commit(
        (next) => {
          id = localizeEpisodeLook(next, episodeId, lookId);
        },
        "Episode look opened",
        false,
      )
    )
      navigate(
        path(
          episodeLookPath(
            useStore.getState().data.episodes[episodeId].projectId,
            episodeId,
            characterId,
            id,
          ),
        ),
        { replace: true },
      );
    // This boundary migration runs once per legacy route, before mounting the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodeId, lookId, characterId, navigate]);
  return <div className="st-empty">Opening episode look…</div>;
}
export function EpisodeLookWorkspace() {
  const {
      projectId = "",
      episodeId = "",
      characterId = "",
      lookId = "",
    } = useParams(),
    [params, setParams] = useSearchParams();
  const data = useStore((s) => s.data),
    episode = data.episodes[episodeId],
    character = data.characters[characterId],
    look = data.studio.looks[lookId];
  let available = false;
  try {
    referenceEpisode(data, episodeId);
    available =
      !!episode &&
      episode.projectId === projectId &&
      !!character &&
      character.projectId === projectId &&
      !!look &&
      look.characterId === characterId &&
      episodeReferenceCharacters(data, episodeId).some(
        (item) => item.id === characterId,
      ) &&
      (look.episodeId === episodeId ||
        (!look.episodeId &&
          (lookSceneUsage(data, episodeId, lookId).length > 0 ||
            Object.values(data.studio.looks).some(
              (item) =>
                item.episodeId === episodeId &&
                item.characterId === characterId &&
                item.sourceLookId === lookId,
            ))));
  } catch {
    /* Invalid scoped links fail closed. */
  }
  if (!available) return <div className="st-empty">Look unavailable.</div>;
  if (!look.episodeId)
    return (
      <LocalizeLook
        episodeId={episodeId}
        characterId={characterId}
        lookId={lookId}
      />
    );
  const update = (values: Record<string, string>) => {
    const next = new URLSearchParams(params);
    Object.entries(values).forEach(([key, value]) => next.set(key, value));
    setParams(next);
  };
  return (
    <AssetDetail
      subject={{ kind: "look", id: lookId }}
      episodeId={episodeId}
      tab={params.get("tab") === "details" ? "details" : "views"}
      type={params.get("view") ?? "front"}
      onTab={(tab) => update({ tab })}
      onView={(view) => update({ view })}
      back={`${episodeReferencesPath(projectId, episodeId)}?kind=characters`}
      backLabel="Back to References"
    />
  );
}
