import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  Clapperboard,
  Film,
  Image,
  LayoutGrid,
  List,
  Plus,
  Sparkles,
  CirclePlay,
} from "lucide-react";
import { useEpisodeScope, shotPresentation } from "./scope";
import { useSelection, type EntityKey } from "../selection";
import { commit, useGenerate } from "../generation";
import { useCommands, CommandButton } from "../commands";
import { DraftField } from "../design/Primitives";
import { sceneShots, readyMedia } from "../episode-board/scene-presentation";
import {
  changeShot,
  changeShotCamera,
  changeShotInputs,
  setShotDuration,
} from "../../domain/workspace";
import { generationInputs, defaultCraft } from "../../domain/generation-inputs";
import { isBusy } from "../../domain/selectors";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../components/ui/dialog";
import {
  proposeSceneAssistance,
  applySceneSuggestion,
  type SceneSuggestion,
} from "../../domain/scene-assistance";
import { SortableItem, SortableList } from "../../components/Sortable";
import { reorderShots } from "../../domain/workspace";

export function EpisodeScenes({ episodeId }: { episodeId: string }) {
  const { data, episode, scenes, shots, shot } = useEpisodeScope(episodeId);
  const keys = useSelection((state) => state.keys);
  const order = shots.map((item) => `shot:${item.id}` as EntityKey);
  const [layout, setLayout] = useState<"board" | "strip">("board");
  const [mode, setMode] = useState<"frame" | "video">("frame");
  const [proposal, setProposal] = useState<SceneSuggestion>();
  const navigate = useNavigate(),
    generate = useGenerate(),
    { execute } = useCommands();
  const approved = shots.filter((shot) =>
    readyMedia(data, shot, "video"),
  ).length;
  const inputs = shot
    ? generationInputs(data, shot.sceneId, shot.id)
    : undefined;
  const craft = { ...defaultCraft, ...inputs?.craft };
  const presentation = shot ? shotPresentation(data, shot) : undefined;
  const frameTake = data.takes[shot?.imageTakeId ?? ""],
    frame = data.assets[frameTake?.assetId ?? ""];
  const hasFrame =
    !!frame?.url &&
    !frame.missing &&
    !frame.archived &&
    frameTake?.revision === shot?.revision &&
    !shot?.stale;
  const candidate = data.takes[shot?.candidateTakeId ?? ""],
    candidateAsset = data.assets[candidate?.assetId ?? ""];
  const hasCandidate =
    !!candidate &&
    candidate.revision === shot?.revision &&
    !!candidateAsset?.url &&
    !candidateAsset.missing &&
    !candidateAsset.archived;
  const sceneIndex = scenes.findIndex((scene) => scene.id === shot?.sceneId);
  const shotIndex = shot
    ? sceneShots(data, shot.sceneId).findIndex((item) => item.id === shot.id)
    : -1;
  const number = `${String(sceneIndex + 1).padStart(2, "0")}.${shotIndex + 1}`;
  const disabled = !!shot && (shot.locked || isBusy(data, shot.id));
  const openShot = (stage: string) =>
    shot &&
    navigate(
      `/projects/${episode.projectId}/episodes/${episodeId}/shots/${shot.id}?stage=${stage}`,
    );
  return (
    <div className="ep-columns">
      <section className="ep-scene-board" aria-label="Episode scenes">
        <div className="ep-board-tools">
          <span>
            {approved} of {shots.length} shots ready for the edit
          </span>
          <a className="ep-mobile-inspector" href="#episode-shot-inspector">
            Shot controls ↓
          </a>
          <div className="ep-layout">
            <button
              aria-pressed={layout === "board"}
              onClick={() => setLayout("board")}
            >
              <LayoutGrid size={18} />
              Board
            </button>
            <button
              aria-pressed={layout === "strip"}
              onClick={() => setLayout("strip")}
            >
              <List size={18} />
              Strip
            </button>
          </div>
        </div>
        {scenes.map((scene, index) => {
          const items = sceneShots(data, scene.id);
          return (
            <section
              className="ep-scene-group"
              key={scene.id}
              aria-label={`Scene ${scene.title}`}
            >
              <header>
                <button
                  className="ep-scene-title"
                  aria-label={`Select scene ${scene.title}`}
                  onClick={() =>
                    useSelection.getState().replace([`scene:${scene.id}`])
                  }
                >
                  <span className="ep-scene-number">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span>
                    <h2>{scene.title}</h2>
                    <p>{scene.description}</p>
                  </span>
                </button>
                <span className="ep-scene-meta">
                  {items.length} shots ·{" "}
                  {Number(
                    (
                      items.reduce((n, s) => n + s.targetFrames, 0) / 30
                    ).toFixed(1),
                  )}
                  s
                </span>
              </header>
              <SortableList
                ids={items.map((item) => item.id)}
                onReorder={(ids) =>
                  commit(
                    (d) => reorderShots(d, scene.id, ids),
                    "Shots reordered",
                  )
                }
              >
                <div
                  className={`ep-shot-grid ${layout === "strip" ? "ep-shot-strip" : ""}`}
                >
                  {items.map((item, i) => {
                    const media = shotPresentation(data, item),
                      selected =
                        keys.includes(`shot:${item.id}`) ||
                        (!keys.some((key) => key.startsWith("shot:")) &&
                          shot?.id === item.id);
                    return (
                      <SortableItem
                        key={item.id}
                        id={item.id}
                        className="ep-sortable-shot"
                      >
                        <button
                          className={`ep-shot-card ${selected ? "is-selected" : ""}`}
                          data-selection-key={`shot:${item.id}`}
                          aria-pressed={selected}
                          aria-label={`Select shot ${String(index + 1).padStart(2, "0")}.${i + 1} ${item.title}`}
                          onClick={(event) =>
                            useSelection
                              .getState()
                              .choose(`shot:${item.id}`, order, event)
                          }
                        >
                          <div className="ep-shot-image">
                            {media.asset?.url &&
                            !media.asset.missing &&
                            !media.asset.archived ? (
                              media.asset.kind === "video" ? (
                                <video
                                  src={media.asset.url}
                                  preload="metadata"
                                  muted
                                  playsInline
                                />
                              ) : (
                                <img
                                  src={media.asset.url}
                                  alt=""
                                  loading="lazy"
                                />
                              )
                            ) : media.cover ? (
                              <img src={media.cover} alt="" loading="lazy" />
                            ) : (
                              <Film size={30} />
                            )}
                            <span
                              className={`ep-media-status tone-${media.tone}`}
                            >
                              {media.tone === "success" ? (
                                <CheckCircle2 size={16} />
                              ) : (
                                <Circle size={16} />
                              )}
                              {media.label}
                            </span>
                          </div>
                          <div className="ep-shot-copy">
                            <h3>
                              {String(index + 1).padStart(2, "0")}.{i + 1} ·{" "}
                              {item.title}
                            </h3>
                            <time>
                              {Number((item.targetFrames / 30).toFixed(1))}s
                            </time>
                            <p>
                              {item.action ||
                                "Describe the action for this shot."}
                            </p>
                          </div>
                        </button>
                      </SortableItem>
                    );
                  })}
                </div>
              </SortableList>
              <div className="ep-scene-actions">
                <button
                  className="ds-text"
                  onClick={() => {
                    useSelection.getState().replace([`scene:${scene.id}`]);
                    execute("shot.add");
                  }}
                >
                  <Plus size={15} />
                  Add shot
                </button>
                <button
                  className="ds-text"
                  onClick={() =>
                    setProposal(proposeSceneAssistance(data, scene.id))
                  }
                >
                  <Sparkles size={15} />
                  Suggest shots
                </button>
              </div>
            </section>
          );
        })}
        {!scenes.length && (
          <div className="ep-empty">
            <Clapperboard size={32} />
            <h2>Your episode starts with a scene.</h2>
            <p>Add a scene, then describe its story and plan its shots.</p>
          </div>
        )}
        <CommandButton id="scene.add" className="ds-button">
          <Plus size={17} />
          Add scene
        </CommandButton>
      </section>
      <aside
        id="episode-shot-inspector"
        className="ep-inspector"
        aria-label="Shot inspector"
      >
        {shot ? (
          <>
            <header>
              <h2>Shot {number}</h2>
              <span>{shot.title}</span>
            </header>
            <div className="ep-inspector-image">
              {hasFrame ? (
                <img src={frame!.url} alt={`${shot.title} chosen frame`} />
              ) : presentation?.asset?.url && !presentation.asset.missing ? (
                presentation.asset.kind === "video" ? (
                  <video
                    src={presentation.asset.url}
                    muted
                    preload="metadata"
                  />
                ) : (
                  <img
                    src={presentation.asset.url}
                    alt={`${shot.title} preview`}
                  />
                )
              ) : (
                <img
                  src={data.scenes[shot.sceneId].cover}
                  alt="Scene reference"
                />
              )}
            </div>
            <nav
              className="ep-tabs ep-inspector-tabs"
              aria-label="Shot controls"
            >
              <button
                aria-pressed={mode === "frame"}
                onClick={() => setMode("frame")}
              >
                <Image size={19} />
                Frame
              </button>
              <button
                aria-pressed={mode === "video"}
                onClick={() => setMode("video")}
              >
                <CirclePlay size={19} />
                Video
              </button>
            </nav>
            <p className={`ep-inspector-status tone-${presentation!.tone}`}>
              {presentation!.tone === "success" ? (
                <CheckCircle2 size={17} />
              ) : (
                <Circle size={17} />
              )}
              {presentation!.label}
            </p>
            <div className="ep-control-row">
              <label htmlFor="ep-framing">Framing</label>
              <select
                id="ep-framing"
                value={shot.framing ?? "Medium"}
                disabled={disabled}
                onChange={(e) =>
                  commit(
                    (d) =>
                      changeShotCamera(d, shot.id, { framing: e.target.value }),
                    "Framing saved",
                  )
                }
              >
                {["Wide", "Full body", "Medium", "Close-up", "Detail"].map(
                  (v) => (
                    <option key={v}>{v}</option>
                  ),
                )}
              </select>
            </div>
            {mode === "frame" ? (
              <div className="ep-control-row">
                <label htmlFor="ep-lens">Lens</label>
                <select
                  id="ep-lens"
                  disabled={disabled}
                  value={craft.lens}
                  onChange={(e) =>
                    commit(
                      (d) =>
                        changeShotInputs(d, shot.id, {
                          craft: { ...craft, lens: e.target.value },
                        }),
                      "Lens saved",
                    )
                  }
                >
                  {["24 mm", "35 mm", "50 mm", "85 mm"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </div>
            ) : (
              <>
                <div className="ep-control-row">
                  <label htmlFor="ep-movement">Movement</label>
                  <select
                    id="ep-movement"
                    disabled={disabled}
                    value={shot.movement || "Static"}
                    onChange={(e) =>
                      commit(
                        (d) =>
                          changeShotCamera(d, shot.id, {
                            movement: e.target.value,
                          }),
                        "Movement saved",
                      )
                    }
                  >
                    {[
                      ...new Set([
                        shot.movement || "Static",
                        "Static",
                        "Slow push-in",
                        "Push in",
                        "Pull out",
                        "Pan left",
                        "Pan right",
                        "Tracking",
                      ]),
                    ].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </div>
                <label className="ep-field">
                  Duration (seconds)
                  <DraftField
                    key={`duration:${shot.id}`}
                    label="Shot duration"
                    value={String(shot.targetFrames / 30)}
                    disabled={disabled}
                    onSave={(value) =>
                      commit(
                        (d) => setShotDuration(d, shot.id, Number(value)),
                        "Duration saved",
                      )
                    }
                  />
                </label>
              </>
            )}
            <label className="ep-field">
              {mode === "frame" ? "Frame direction" : "Performance and action"}
              <DraftField
                key={`action:${shot.id}`}
                label={
                  mode === "frame"
                    ? "Frame direction"
                    : "Performance and action"
                }
                value={shot.action}
                multiline
                disabled={disabled}
                onSave={(action) =>
                  commit(
                    (d) => changeShot(d, shot.id, { action }),
                    "Shot direction saved",
                  )
                }
              />
            </label>
            <div className="ep-inspector-continuity">
              <p>
                {data.studio.setups[shot.sceneId]?.cast
                  .map((item) => data.characters[item.characterId]?.name)
                  .filter(Boolean)
                  .join(" · ")}
                {inputs?.locationId &&
                  ` · ${data.studio.locations[inputs.locationId]?.name ?? ""}`}
              </p>
              <p>
                Continuity:{" "}
                {data.studio.setups[shot.sceneId]?.direction.notes ||
                  "No continuity notes yet."}
              </p>
            </div>
            <button
              className="ds-button ds-primary ep-wide"
              disabled={disabled}
              onClick={() =>
                mode === "frame"
                  ? hasFrame
                    ? setMode("video")
                    : generate([shot.id], "image")
                  : hasCandidate || readyMedia(data, shot, "video")
                    ? openShot("review")
                    : generate([shot.id], "video")
              }
            >
              {mode === "frame"
                ? hasFrame
                  ? "Direct video"
                  : "Create frame · 8 credits"
                : hasCandidate
                  ? "Review take"
                  : readyMedia(data, shot, "video")
                    ? "Review approved take"
                    : "Create video · 24 credits"}
              <ArrowRight size={19} />
            </button>
            <button
              className="ds-text ep-advanced"
              onClick={() => openShot(mode === "frame" ? "frame" : "motion")}
            >
              Open full {mode === "frame" ? "frame" : "motion"} controls{" "}
              <ArrowRight size={15} />
            </button>
          </>
        ) : (
          <div className="ep-empty">
            <Image size={28} />
            <h2>Select a shot</h2>
            <p>Add a shot to start creating its frame and video.</p>
          </div>
        )}
      </aside>
      <Dialog
        open={!!proposal}
        onOpenChange={(open) => !open && setProposal(undefined)}
      >
        <DialogContent className="st-dialog">
          <DialogTitle>Suggested shot coverage</DialogTitle>
          <DialogDescription>
            Preview additional coverage before adding shots to this scene.
            Existing shots stay in place.
          </DialogDescription>
          {proposal?.shots.map((item, i) => (
            <article key={i} className="ep-suggestion">
              <h3>
                {item.title} · {item.seconds}s
              </h3>
              <p>{item.action}</p>
            </article>
          ))}
          <button
            className="ds-button ds-primary"
            onClick={() => {
              if (
                proposal &&
                commit(
                  (d) => applySceneSuggestion(d, proposal, "shots"),
                  "Suggested shots added",
                )
              )
                setProposal(undefined);
            }}
          >
            Add suggested shots
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
