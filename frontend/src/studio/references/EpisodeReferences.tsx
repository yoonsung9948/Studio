import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { useStore } from "../../stores/store";
import {
  createEpisodeLook,
  episodeCharacterLooks,
  localizeEpisodeLook,
} from "../../domain/episode-characters";
import {
  assetCategories,
  categoryFor,
  type AssetSubject,
} from "../../domain/asset-library";
import { episodeAssetSubjects } from "../../domain/asset-usage";
import { AddEpisodeCharacter } from "./AddEpisodeCharacter";
import { AddEpisodeAsset } from "./AddEpisodeAsset";
import { AssetGallery } from "../assets/AssetGallery";
import { useAssetPath } from "../assets/asset-navigation";
import { episodeLookPath, episodeReferencesPath } from "./paths";
import { commit } from "../generation";
import "../../styles/episode-references.css";
import "../../styles/assets-characters.css";
import "../../styles/asset-workspace.css";

export function EpisodeReferencesWorkspace({
  episodeId,
}: {
  episodeId: string;
}) {
  const data = useStore((s) => s.data),
    episode = data.episodes[episodeId],
    project = data.projects[episode.projectId];
  const [params, setParams] = useSearchParams(),
    navigate = useNavigate(),
    path = useAssetPath(),
    [adding, setAdding] = useState(false);
  const category =
    assetCategories.find((item) => item === params.get("kind")) ?? "characters";
  const openLook = (characterId: string, lookId: string) => {
    let local = lookId;
    if (
      useStore.getState().data.studio.looks[lookId]?.episodeId === episodeId ||
      commit(
        (next) => {
          local = localizeEpisodeLook(next, episodeId, lookId);
        },
        "Episode look opened",
        false,
      )
    )
      navigate(
        path(episodeLookPath(project.id, episodeId, characterId, local)),
      );
  };
  const open = (subject: AssetSubject) => {
    if (subject.kind === "character") {
      const look = episodeCharacterLooks(data, episodeId, subject.id)[0];
      if (look) {
        openLook(subject.id, look.id);
        return;
      }
    }
    navigate(
      path(
        `${episodeReferencesPath(project.id, episodeId)}/${categoryFor(subject)}/${subject.id}/views`,
      ),
    );
  };
  const newLook = (characterId: string) => {
    let id = "";
    if (
      commit((next) => {
        id = createEpisodeLook(next, episodeId, characterId);
      }, "Episode look created")
    )
      navigate(
        path(
          `${episodeLookPath(project.id, episodeId, characterId, id)}?tab=details`,
        ),
      );
  };
  const update = (values: Record<string, string>) => {
    const next = new URLSearchParams(params);
    Object.entries(values).forEach(([key, value]) => next.set(key, value));
    setParams(next);
  };
  return (
    <section
      className="ac-workspace ag-workspace"
      aria-label="Episode references"
      tabIndex={0}
    >
      <header className="av-heading">
        <div>
          <h1>References</h1>
          <p>
            Episode{" "}
            {String(project.episodeIds.indexOf(episodeId) + 1).padStart(2, "0")}{" "}
            · {episode.title}
          </p>
        </div>
        <button
          className="ds-button ds-primary"
          onClick={() => setAdding(true)}
        >
          <Plus size={18} />
          Add from Assets
        </button>
      </header>
      <nav
        className="ep-tabs ac-category-tabs"
        aria-label="Episode reference categories"
      >
        {assetCategories.map((item) => (
          <button
            key={item}
            aria-pressed={category === item}
            onClick={() => update({ kind: item, q: "" })}
          >
            {item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </nav>
      <AssetGallery
        category={category}
        episodeId={episodeId}
        subjects={episodeAssetSubjects(data, episodeId, category)}
        query={params.get("q") ?? ""}
        onQuery={(q) => update({ q })}
        onOpen={open}
        onCreate={() => setAdding(true)}
        onOpenLook={openLook}
        onNewLook={newLook}
      />
      {adding &&
        (category === "characters" ? (
          <AddEpisodeCharacter
            episodeId={episodeId}
            onClose={() => setAdding(false)}
            onAdded={(characterId, lookId) => {
              setAdding(false);
              if (lookId) openLook(characterId, lookId);
              else open({ kind: "character", id: characterId });
            }}
          />
        ) : (
          <AddEpisodeAsset
            episodeId={episodeId}
            category={category}
            onClose={() => setAdding(false)}
            onAdded={(subject) => {
              setAdding(false);
              open(subject);
            }}
          />
        ))}
    </section>
  );
}
