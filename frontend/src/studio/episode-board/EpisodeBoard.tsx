import { SortableItem, SortableList } from "../../components/Sortable";
import { reorderShots } from "../../domain/workspace";
import { commit } from "../generation";
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, Film, MoreHorizontal, Plus, Sparkles } from "lucide-react";
import { useStore } from "../../stores/store";
import { useSelection, useStudio, type EntityKey } from "../selection";
import { SelectionSurface } from "../SelectionSurface";
import { CommandButton, useCommands } from "../commands";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../../components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../../components/ui/dialog";
import { SceneFoundations } from "../director-desk/ScenePlanner";
import { shotUrl } from "../director-desk/SceneRail";
import { timecode } from "../../domain/selectors";
import { sceneShots } from "./scene-presentation";

export function EpisodeBoard({
  episodeId,
  renderShot,
  inspector,
  outline,
}: {
  episodeId: string;
  renderShot(id: string): ReactNode;
  inspector?: ReactNode;
  outline?: ReactNode;
}) {
  const data = useStore((state) => state.data),
    keys = useSelection((state) => state.keys);
  const episode = data.episodes[episodeId];
  const navigate = useNavigate(),
    [params] = useSearchParams(),
    { commands, execute } = useCommands();
  const [sceneDetails, setSceneDetails] = useState(false);
  const scenes = episode.sceneIds
    .map((id) => data.scenes[id])
    .filter((scene) => scene && !scene.archived);
  const lastKey = keys.at(-1);
  const selectedScene = lastKey?.startsWith("scene:")
    ? lastKey.slice(6)
    : lastKey?.startsWith("shot:")
      ? data.shots[lastKey.slice(5)]?.sceneId
      : params.get("scene");
  const current =
    scenes.find((scene) => scene.id === selectedScene) ??
    scenes.find((scene) => scene.title === episode.title) ??
    scenes[0];
  useEffect(() => {
    const valid = keys.some((key) =>
      key.startsWith("scene:")
        ? data.scenes[key.slice(6)]?.episodeId === episodeId
        : key.startsWith("shot:") &&
          data.scenes[data.shots[key.slice(5)]?.sceneId]?.episodeId ===
            episodeId,
    );
    if (!valid && current)
      useSelection.getState().replace([`scene:${current.id}`]);
  }, [episodeId]);
  const openScene = () => {
    if (!current) return;
    const shots = sceneShots(data, current.id);
    const preferred =
      shots.find(
        (shot) => shot.id === useStore.getState().ui.selectedShots[current.id],
      ) ?? shots[0];
    if (preferred)
      navigate(shotUrl(episode.projectId, episodeId, preferred.id, "scene"));
    else {
      useSelection.getState().replace([`scene:${current.id}`]);
      execute("shot.add");
    }
  };
  return (
    <div className="episode-board">
      <section className="episode-board-main">
        <header className="episode-board-heading">
          <h1>{episode.title}</h1>
          <div className="episode-board-toolbar">
            <nav aria-label="Workspace views">
              {[
                { id: "board", title: "Board" },
                { id: "script", title: "Script" },
                { id: "timeline", title: "Edit" },
                { id: "review", title: "Review" },
              ].map((view) => (
                <button
                  key={view.id}
                  aria-pressed={view.id === "board"}
                  onClick={() => {
                    const next = new URLSearchParams(params);
                    next.set("view", view.id);
                    navigate({ search: `?${next}` });
                  }}
                >
                  {view.title}
                </button>
              ))}
            </nav>
            <div className="episode-board-actions">
              <CommandButton id="scene.add">
                <Plus size={19} />
                Add scene
              </CommandButton>
              <CommandButton id="selection.generate">
                <Sparkles size={19} />
                Generate selection
              </CommandButton>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="ds-icon" aria-label="Episode options">
                    <MoreHorizontal size={22} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() =>
                      useStudio
                        .getState()
                        .set({ outline: !useStudio.getState().outline })
                    }
                  >
                    {outline ? "Hide outline" : "Show outline"}
                  </DropdownMenuItem>
                  {commands
                    .filter((command) =>
                      [
                        "episode.generate",
                        "episode.export",
                        "selection.animate",
                      ].includes(command.id),
                    )
                    .map((command) => (
                      <DropdownMenuItem
                        key={command.id}
                        onSelect={() => execute(command.id)}
                      >
                        {command.label}
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>
        {outline && <div className="episode-board-outline">{outline}</div>}
        <SelectionSurface
          className="episode-scene-columns"
          aria-label="Shot board"
        >
          {scenes.map((scene, index) => {
            const shots = sceneShots(data, scene.id),
              seconds = shots.reduce(
                (total, shot) => total + shot.targetFrames / 30,
                0,
              );
            return (
              <section
                className={`episode-scene-column ${scene.id === current?.id ? "is-current" : ""}`}
                key={scene.id}
                aria-label={`Scene ${scene.title}`}
              >
                <button
                  className="episode-scene-cover"
                  aria-label={`Select scene ${scene.title}`}
                  aria-pressed={scene.id === current?.id}
                  onClick={(event) => {
                    useSelection.getState().choose(
                      `scene:${scene.id}`,
                      scenes.map((scene) => `scene:${scene.id}` as EntityKey),
                      event,
                    );
                    useStudio.getState().set({ inspector: false });
                  }}
                  onDoubleClick={() => {
                    const first = shots[0];
                    if (first)
                      navigate(
                        shotUrl(
                          episode.projectId,
                          episodeId,
                          first.id,
                          "scene",
                        ),
                      );
                  }}
                >
                  {scene.cover ? (
                    <img src={scene.cover} alt="" />
                  ) : (
                    <Film size={30} />
                  )}
                  <span>
                    <b>{String(index + 1).padStart(2, "0")}</b>
                    <strong>{scene.title}</strong>
                    <time>{timecode(seconds)}</time>
                  </span>
                </button>
                <div className="episode-scene-shots">
                  <SortableList
                    ids={shots.map((shot) => shot.id)}
                    onReorder={(ids) =>
                      commit(
                        (data) => reorderShots(data, scene.id, ids),
                        "Shots reordered",
                      )
                    }
                  >
                    {shots.map((shot) => (
                      <SortableItem
                        id={shot.id}
                        key={shot.id}
                        className="episode-sortable-shot"
                      >
                        {renderShot(shot.id)}
                      </SortableItem>
                    ))}
                  </SortableList>
                  {!shots.length && (
                    <button
                      className="episode-empty-shot"
                      onClick={() => {
                        useSelection.getState().replace([`scene:${scene.id}`]);
                        execute("shot.add");
                      }}
                    >
                      <Plus size={17} />
                      Add your first shot
                    </button>
                  )}
                </div>
                <footer>
                  <span>Total duration</span>
                  <b>{Number(seconds.toFixed(1))}s</b>
                </footer>
              </section>
            );
          })}
          {!scenes.length && (
            <div className="episode-board-empty">
              <Film size={35} />
              <h2>Your episode starts with a scene.</h2>
              <CommandButton id="scene.add" className="st-primary">
                Add scene <Plus size={17} />
              </CommandButton>
              <button
                className="ds-text"
                onClick={() => navigate({ search: "?view=script" })}
              >
                Write a script <ArrowRight size={16} />
              </button>
            </div>
          )}
        </SelectionSurface>
      </section>
      <div className="episode-board-sidebar">
        {inspector ??
          (current ? (
            <SceneFoundations
              key={current.id}
              sceneId={current.id}
              mode="overview"
              onContinue={openScene}
            />
          ) : (
            <aside className="episode-board-empty">
              <h2>Scene overview</h2>
              <p>Add a scene to start planning your episode.</p>
            </aside>
          ))}
      </div>
      {current && (
        <button
          className="episode-scene-details-toggle ds-button"
          onClick={() => setSceneDetails(true)}
        >
          Scene overview
        </button>
      )}
      <Dialog open={sceneDetails} onOpenChange={setSceneDetails}>
        <DialogContent className="st-dialog episode-scene-details">
          <DialogTitle>Scene overview</DialogTitle>
          <DialogDescription>
            Review the selected scene and its production references.
          </DialogDescription>
          {current && (
            <SceneFoundations
              key={current.id}
              sceneId={current.id}
              mode="overview"
              onContinue={openScene}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
