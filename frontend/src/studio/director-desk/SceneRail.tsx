import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, ChevronDown, Film, Plus } from "lucide-react";
import { useStore } from "../../stores/store";
import { shotAsset, addWorkspaceScene } from "../../domain/workspace";
import { commit } from "../generation";

export function shotUrl(
  projectId: string,
  episodeId: string,
  shotId: string,
  stage = "frame",
) {
  return `/projects/${projectId}/episodes/${episodeId}/shots/${shotId}?stage=${stage}`;
}
export function SceneRail({
  episodeId,
  shotId,
}: {
  episodeId: string;
  shotId: string;
}) {
  const navigate = useNavigate(),
    data = useStore((state) => state.data),
    episode = data.episodes[episodeId];
  const currentScene = data.shots[shotId]?.sceneId;
  const [params] = useSearchParams(),
    stage = params.get("stage") || "frame";
  const [open, setOpen] = useState(false);
  const createScene = () => {
    let sceneId = "";
    if (
      commit((d) => {
        sceneId = addWorkspaceScene(d, episodeId);
      }, "Scene added")
    )
      navigate(
        shotUrl(
          episode.projectId,
          episodeId,
          useStore.getState().data.scenes[sceneId].shotIds[0],
          "scene",
        ),
      );
  };
  return (
    <aside
      className={`dd-scene-rail ${open ? "is-mobile-open" : ""}`}
      aria-label="Scene and shot navigation"
    >
      <button
        className="dd-scene-picker"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {data.scenes[currentScene]?.title || "Episode outline"}
        <ChevronDown size={16} />
      </button>
      <div className="dd-rail-content">
        <div className="dd-rail-heading">
          <h2>Episode outline</h2>
          <button
            className="ds-icon"
            aria-label="Add scene"
            onClick={createScene}
          >
            <Plus size={17} />
          </button>
        </div>
        {episode.sceneIds.map((id, index) => {
          const scene = data.scenes[id],
            first = scene.shotIds[0];
          const image =
            scene.cover ||
            (first ? shotAsset(data, data.shots[first])?.url : "");
          const seconds = scene.shotIds.reduce(
            (n, id) => n + data.shots[id].targetFrames / 30,
            0,
          );
          return (
            <section
              key={id}
              className={`dd-scene-nav ${id === currentScene ? "is-current" : ""}`}
            >
              <Link
                onClick={() => setOpen(false)}
                to={
                  first
                    ? shotUrl(episode.projectId, episodeId, first, "scene")
                    : `/projects/${episode.projectId}/episodes/${episodeId}?scene=${id}`
                }
                aria-current={id === currentScene ? "true" : undefined}
              >
                {image ? (
                  <img src={image} alt="" />
                ) : (
                  <div className="dd-rail-placeholder">
                    <Film size={24} />
                  </div>
                )}
                <span>
                  <small>{String(index + 1).padStart(2, "0")}</small>
                  {scene.title}
                  <time>
                    {String(Math.floor(seconds / 60)).padStart(2, "0")}:
                    {String(Math.round(seconds % 60)).padStart(2, "0")}
                  </time>
                </span>
              </Link>
              {id === currentScene && stage !== "scene" && (
                <details className="dd-rail-shots">
                  <summary>{scene.shotIds.length} shots</summary>
                  <nav aria-label={`${scene.title} shots`}>
                    {scene.shotIds.map((id, index) => (
                      <Link
                        key={id}
                        to={shotUrl(episode.projectId, episodeId, id, stage)}
                        aria-current={id === shotId ? "page" : undefined}
                        onClick={() => setOpen(false)}
                      >
                        <span>{String(index + 1).padStart(2, "0")}</span>
                        {data.shots[id].title}
                      </Link>
                    ))}
                  </nav>
                </details>
              )}
            </section>
          );
        })}
        <Link
          className="dd-back"
          to={`/projects/${episode.projectId}/episodes/${episodeId}`}
        >
          <ArrowLeft size={15} />
          Episode board
        </Link>
      </div>
    </aside>
  );
}
