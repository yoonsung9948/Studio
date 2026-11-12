import {
  sceneReadiness,
  sceneShots,
} from "../episode-board/scene-presentation";
import { timecode } from "../../domain/selectors";
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Check,
  Circle,
  MoreHorizontal,
  FileText,
  MapPin,
  Plus,
  Sparkles,
  Tag,
  Trash2,
  UsersRound,
} from "lucide-react";
import { useStore } from "../../stores/store";
import {
  addWorkspaceShot,
  changeScene,
  changeShot,
  changeShotCamera,
  setWorkspaceSceneCast,
  setShotDuration,
  shotAsset,
  setShotWorldElement,
  reorderShots,
} from "../../domain/workspace";
import {
  generationInputs,
  saveGenerationInputs,
} from "../../domain/generation-inputs";
import { updateScenePlan } from "../../domain/workflow";
import { updateDirection } from "../../domain/studio-commands";
import { deleteCardSelection } from "../../domain/card-deletion";
import { sceneScreenplay } from "../../domain/scene-assistance";
import { characterReady } from "../../domain/studio-selectors";
import { SortableItem, SortableList } from "../../components/Sortable";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../../components/ui/dialog";
import { commit } from "../generation";
import { SaveStatus } from "../design/SavingState";
import { DraftField, EditableHeading } from "../design/Primitives";
import { AiScenePanel } from "./AiScenePanel";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../../components/ui/dropdown-menu";
import { shotUrl } from "./SceneRail";

type Panel = "enhance" | "shots" | "notes" | null;
export function ScenePlanner({
  shotId,
  onContinue,
}: {
  shotId: string;
  onContinue(): void;
}) {
  const data = useStore((state) => state.data);
  const scene = data.scenes[data.shots[shotId].sceneId];
  const episode = data.episodes[scene.episodeId];
  const [panel, setPanel] = useState<Panel>(null);
  const source = sceneScreenplay(data, scene.id);
  const slug = /^(INT\.?|EXT\.?|INT\.\/EXT\.)\s/i.test(source)
    ? source.split("\n")[0]
    : "";
  const screenplay = slug
    ? source.slice(slug.length).replace(/^\n{1,2}/, "")
    : source;
  const locked = scene.shotIds.some((id) => data.shots[id].locked);
  return (
    <div className="dd-work-layout">
      <section className="dd-work-main dd-scene-planner">
        <header className="dd-scene-titlebar">
          <div className="scene-title-fit">
            <span aria-hidden="true">{scene.title}</span>
            <EditableHeading
              value={scene.title}
              label="Scene title"
              onSave={(title) =>
                commit(
                  (d) => changeScene(d, scene.id, { title }),
                  "Scene renamed",
                )
              }
            />
          </div>
          <div className="dd-inline">
            <button
              className="ds-button ds-ai"
              onClick={() => setPanel(panel === "enhance" ? null : "enhance")}
              aria-expanded={panel === "enhance"}
            >
              <Sparkles size={16} />
              Enhance prompt
            </button>
            <button
              className="ds-button"
              onClick={() => setPanel(panel === "notes" ? null : "notes")}
              aria-expanded={panel === "notes"}
            >
              <FileText size={15} />
              Scene notes
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="ds-icon" aria-label="Scene options">
                  <MoreHorizontal size={21} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setPanel("notes")}>
                  Edit scene notes
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setPanel("shots")}>
                  Suggest shot coverage
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onContinue}>
                  Compose starting frame
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <div className="dd-screenplay">
          <div className="dd-screenplay-heading">
            {scene.settingDescription?.split("\n")[0] ||
              slug ||
              "SCENE SCREENPLAY"}
            {locked ? <span>Contains locked shots</span> : <SaveStatus />}
          </div>
          <div className="dd-screenplay-body">
            <div className="dd-line-numbers" aria-hidden="true">
              {Array.from(
                { length: Math.max(9, screenplay.split("\n").length) },
                (_, i) => (
                  <span key={i}>{i + 1}</span>
                ),
              )}
            </div>
            <DraftField
              key={scene.id}
              label="Scene screenplay"
              value={screenplay}
              multiline
              rows={10}
              disabled={locked}
              onSave={(next) =>
                commit(
                  (d) =>
                    updateScenePlan(d, scene.id, {
                      screenplay:
                        slug && !/^(INT\.?|EXT\.?)\s/i.test(next)
                          ? `${slug}\n\n${next}`
                          : next,
                    }),
                  "Scene screenplay saved",
                )
              }
            />
          </div>
        </div>
        <div className="dd-section-heading dd-shot-plan-heading">
          <h2>
            Shot plan{" "}
            <small>
              {scene.shotIds.length} shots ·{" "}
              {scene.shotIds.reduce(
                (n, id) => n + data.shots[id].targetFrames / 30,
                0,
              )}{" "}
              seconds
            </small>
          </h2>
          <div className="dd-inline">
            <button
              className="ds-button ds-ai"
              onClick={() => setPanel(panel === "shots" ? null : "shots")}
            >
              <Sparkles size={16} />
              Suggest shots
            </button>
            <button
              className="ds-button"
              onClick={() =>
                commit((d) => {
                  addWorkspaceShot(d, scene.id);
                }, "Shot added")
              }
            >
              <Plus size={16} />
              Add shot
            </button>
          </div>
        </div>
        <SortableList
          ids={scene.shotIds}
          onReorder={(ids) =>
            commit((d) => reorderShots(d, scene.id, ids), "Shot plan reordered")
          }
        >
          <div className="dd-shot-plan">
            {scene.shotIds.map((id, index) => {
              const shot = data.shots[id],
                asset = shotAsset(data, shot);
              return (
                <SortableItem key={id} id={id} className="dd-plan-sortable">
                  <div className="dd-plan-row">
                    <span className="dd-plan-number">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="dd-plan-name">
                      <DraftField
                        label={`Shot ${index + 1} title`}
                        value={shot.title}
                        disabled={shot.locked}
                        onSave={(title) =>
                          commit(
                            (d) => changeShot(d, id, { title }),
                            "Shot renamed",
                          )
                        }
                      />
                      <label>
                        <input
                          aria-label={`Shot ${index + 1} duration`}
                          type="number"
                          min={1}
                          max={30}
                          step={0.1}
                          defaultValue={shot.targetFrames / 30}
                          key={shot.targetFrames}
                          disabled={shot.locked}
                          onBlur={(e) => {
                            if (
                              Number(e.target.value) !==
                              shot.targetFrames / 30
                            )
                              if (
                                !commit(
                                  (d) =>
                                    setShotDuration(
                                      d,
                                      id,
                                      Number(e.target.value),
                                    ),
                                  "Duration updated",
                                )
                              )
                                e.target.value = String(shot.targetFrames / 30);
                          }}
                        />
                        s
                      </label>
                    </div>
                    <Link
                      className="dd-plan-thumb"
                      to={shotUrl(episode.projectId, episode.id, id, "frame")}
                      aria-label={`Compose ${shot.title}`}
                    >
                      {asset?.url ? (
                        <img src={asset.url} alt="" />
                      ) : (
                        <span>Compose frame</span>
                      )}
                    </Link>
                    <DraftField
                      className="dd-plan-action"
                      label={`Shot ${index + 1} action`}
                      multiline
                      rows={3}
                      value={shot.action}
                      disabled={shot.locked}
                      onSave={(action) =>
                        commit(
                          (d) => changeShot(d, id, { action }),
                          "Shot action saved",
                        )
                      }
                    />
                    <label className="dd-plan-angle">
                      Camera angle
                      <select
                        aria-label={`Shot ${index + 1} camera angle`}
                        value={shot.framing || "Medium"}
                        disabled={shot.locked}
                        onChange={(e) =>
                          commit(
                            (d) =>
                              changeShotCamera(d, id, {
                                framing: e.target.value,
                              }),
                            "Camera angle saved",
                          )
                        }
                      >
                        {[
                          "Wide",
                          "Full body",
                          "Medium",
                          "Close-up",
                          "Detail",
                        ].map((value) => (
                          <option key={value}>{value}</option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="ds-icon"
                      aria-label={`Remove ${shot.title}`}
                      disabled={shot.locked || scene.shotIds.length < 2}
                      onClick={() =>
                        commit((d) => {
                          deleteCardSelection(d, [`shot:${id}`]);
                        }, "Shot removed · Undo to restore")
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </SortableItem>
              );
            })}
          </div>
        </SortableList>
      </section>
      {panel === "enhance" || panel === "shots" ? (
        <AiScenePanel
          key={`${scene.id}:${panel}`}
          sceneId={scene.id}
          kind={panel}
          onClose={() => setPanel(null)}
        />
      ) : panel === "notes" ? (
        <aside className="dd-controls">
          <header className="dd-inspector-heading">
            <h2>Scene notes</h2>
            <button className="ds-text" onClick={() => setPanel(null)}>
              Back to foundations
            </button>
          </header>
          <p className="ds-muted">
            Notes for this scene’s performance and production.
          </p>
          <label className="ds-field">
            Creative notes
            <DraftField
              label="Scene notes"
              value={scene.creativeNotes || ""}
              multiline
              rows={9}
              onSave={(creativeNotes) =>
                commit(
                  (d) => updateScenePlan(d, scene.id, { creativeNotes }),
                  "Scene notes saved",
                )
              }
            />
          </label>
          <label className="ds-field">
            Setting notes
            <DraftField
              label="Setting notes"
              value={scene.settingDescription || ""}
              multiline
              onSave={(settingDescription) =>
                commit(
                  (d) => changeScene(d, scene.id, { settingDescription }),
                  "Setting saved",
                )
              }
            />
          </label>
        </aside>
      ) : (
        <SceneFoundations sceneId={scene.id} onContinue={onContinue} />
      )}
    </div>
  );
}

export function SceneFoundations({
  sceneId,
  onContinue,
  mode = "editor",
}: {
  sceneId: string;
  onContinue(): void;
  mode?: "editor" | "overview";
}) {
  const data = useStore((state) => state.data),
    scene = data.scenes[sceneId];
  const projectId = data.episodes[scene.episodeId].projectId,
    setup = data.studio.setups[sceneId];
  const inputs = generationInputs(data, sceneId);
  const [manage, setManage] = useState(false);
  const characters = Object.values(data.characters).filter(
    (c) => c.projectId === projectId,
  );
  const cast = characters.filter((c) =>
    setup?.cast.some((entry) => entry.characterId === c.id),
  );
  const locations = Object.values(data.studio.locations).filter(
    (l) => l.projectId === projectId,
  );
  const location = locations.find((l) => l.id === inputs.locationId);
  const props =
    data.projects[projectId].worldElements?.filter(
      (item) => item.kind === "prop",
    ) ?? [];
  const chosenProp = props.find((prop) =>
    scene.shotIds.some((id) =>
      data.shots[id].worldElementIds?.includes(prop.id),
    ),
  );
  const direction = setup?.direction;
  const readiness = sceneReadiness(data, sceneId);
  const seconds = sceneShots(data, sceneId).reduce(
    (sum, shot) => sum + shot.targetFrames / 30,
    0,
  );
  return (
    <aside
      className={`dd-controls dd-scene-controls ${mode === "overview" ? "scene-overview-panel" : ""}`}
      aria-label={mode === "overview" ? "Scene overview" : "Scene foundations"}
    >
      <h2>{mode === "overview" ? "Scene overview" : "Scene foundations"}</h2>
      {mode === "overview" && (
        <section className="scene-overview-intro">
          {scene.cover && <img src={scene.cover} alt="Selected scene" />}
          <div>
            <b>
              {String(
                data.episodes[scene.episodeId].sceneIds.indexOf(sceneId) + 1,
              ).padStart(2, "0")}
            </b>
            <h3 aria-label={scene.title}>
              <DraftField
                label="Scene title"
                value={scene.title}
                onSave={(title) =>
                  commit(
                    (d) => changeScene(d, scene.id, { title }),
                    "Scene renamed",
                  )
                }
              />
            </h3>
            <time>{timecode(seconds)}</time>
          </div>
          <p>{scene.description || "Add a description in the scene editor."}</p>
        </section>
      )}
      <section className="dd-foundation">
        <header>
          <h3>Cast</h3>
          <button className="ds-text" onClick={() => setManage(true)}>
            Manage cast
          </button>
        </header>
        <div className="dd-cast-grid">
          {cast.map((c) => (
            <button
              className="dd-cast-card"
              key={c.id}
              onClick={() => setManage(true)}
            >
              <img src={c.reference} alt={c.name} />
              <span>
                {characterReady(data, c.id) ? (
                  <Check className="dd-approved-check" size={20} />
                ) : (
                  <UsersRound size={18} />
                )}
                <span>
                  {c.name}
                  <small
                    className={characterReady(data, c.id) ? "ds-success" : ""}
                  >
                    {characterReady(data, c.id) ? "Approved" : "Needs review"}
                  </small>
                </span>
              </span>
            </button>
          ))}
        </div>
        {!cast.length && (
          <button className="dd-add-reference" onClick={() => setManage(true)}>
            <Plus size={18} />
            Choose your cast
          </button>
        )}
      </section>
      {mode === "editor" && (
        <>
          <section className="dd-foundation">
            <header>
              <h3>Location</h3>
              <Link
                className="ds-text"
                to={`/projects/${projectId}/world?kind=place`}
              >
                Manage
              </Link>
            </header>
            <div className="dd-foundation-card">
              {location?.assetId &&
                data.assets[location.assetId]?.url &&
                !data.assets[location.assetId]?.missing && (
                  <img
                    src={data.assets[location.assetId].url}
                    alt={location.name}
                  />
                )}
              <label>
                <MapPin size={16} />
                <select
                  aria-label="Scene location"
                  value={inputs.locationId || ""}
                  onChange={(e) =>
                    commit(
                      (d) =>
                        saveGenerationInputs(d, sceneId, {
                          locationId: e.target.value || undefined,
                          locationMode: e.target.value
                            ? "selected"
                            : "inferred",
                        }),
                      "Location saved",
                    )
                  }
                >
                  <option value="">Infer from the scene</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>
        </>
      )}
      <section className="dd-foundation">
        <header>
          <h3>Key prop</h3>
          <Link
            className="ds-text"
            to={`/projects/${projectId}/world?kind=prop`}
          >
            Manage
          </Link>
        </header>
        <div className="dd-foundation-card">
          {chosenProp?.assetId &&
            data.assets[chosenProp.assetId]?.url &&
            !data.assets[chosenProp.assetId]?.missing && (
              <img
                src={data.assets[chosenProp.assetId].url}
                alt={chosenProp.name}
              />
            )}
          {(!chosenProp?.assetId ||
            !data.assets[chosenProp.assetId]?.url ||
            data.assets[chosenProp.assetId]?.missing) && (
            <div className="scene-reference-placeholder">
              <Tag size={23} />
              <span>Choose a key prop</span>
            </div>
          )}
          <label>
            <Tag size={16} />
            <select
              aria-label="Key prop"
              value={chosenProp?.id || ""}
              onChange={(e) =>
                commit((d) => {
                  for (const id of scene.shotIds)
                    for (const prop of props)
                      if (
                        d.shots[id].worldElementIds?.includes(prop.id) ||
                        e.target.value === prop.id
                      )
                        setShotWorldElement(
                          d,
                          id,
                          "prop",
                          prop.id,
                          e.target.value === prop.id,
                        );
                }, "Key prop saved")
              }
            >
              <option value="">No key prop</option>
              {props.map((prop) => (
                <option key={prop.id} value={prop.id}>
                  {prop.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>
      {mode === "editor" && (
        <>
          <section className="dd-foundation">
            <h3>Visual direction</h3>
            <div className="dd-style-choices">
              {["Naturalistic", "Warmer", "Cooler"].map((style) => (
                <button
                  key={style}
                  aria-pressed={(direction?.style || "Naturalistic") === style}
                  onClick={() =>
                    commit(
                      (d) =>
                        updateDirection(d, sceneId, {
                          style,
                          lighting:
                            style === "Warmer"
                              ? "Warm practical"
                              : style === "Cooler"
                                ? "Cool window"
                                : "Naturalistic",
                        }),
                      "Visual direction saved",
                    )
                  }
                >
                  <div
                    className={`dd-style-preview style-${style.toLowerCase()}`}
                    style={{
                      backgroundImage: `url(${location?.assetId ? data.assets[location.assetId]?.url : scene.cover})`,
                    }}
                  />
                  {style}
                </button>
              ))}
            </div>
          </section>
        </>
      )}
      <label className="ds-field">
        Continuity
        <DraftField
          label="Continuity"
          value={direction?.notes || ""}
          multiline
          rows={3}
          maxLength={2000}
          placeholder="What must stay consistent?"
          onSave={(notes) =>
            commit(
              (d) => updateDirection(d, sceneId, { notes }),
              "Continuity saved",
            )
          }
        />
        <small className="scene-continuity-count">
          {(direction?.notes || "").length}/2000
        </small>
      </label>
      {mode === "overview" && (
        <section className="scene-readiness">
          <h3>Scene readiness</h3>
          <ReadinessRow
            label="Script complete"
            count={Number(readiness.script)}
            total={1}
          />
          <ReadinessRow
            label="All shots framed"
            count={readiness.frames}
            total={readiness.total}
          />
          <ReadinessRow
            label="Generate final videos"
            count={readiness.videos}
            total={readiness.total}
          />
        </section>
      )}
      <button
        className="ds-button ds-primary dd-inspector-continue"
        aria-label={
          mode === "overview" ? "Open scene" : "Compose starting frame"
        }
        onClick={onContinue}
      >
        {mode === "overview" ? "Open scene" : "Continue to starting frame"}
        <ArrowRight size={17} />
      </button>
      <Dialog open={manage} onOpenChange={setManage}>
        <DialogContent className="st-dialog">
          <DialogTitle>Scene cast</DialogTitle>
          <DialogDescription>
            Choose the identities to use in this scene.
          </DialogDescription>
          <div className="dd-cast-picker">
            {characters.map((c) => (
              <label key={c.id}>
                <img src={c.reference} alt="" />
                <span>
                  {c.name}
                  <small>{c.description}</small>
                </span>
                <input
                  type="checkbox"
                  checked={
                    !!setup?.cast.some((entry) => entry.characterId === c.id)
                  }
                  onChange={(e) =>
                    commit(
                      (d) =>
                        setWorkspaceSceneCast(
                          d,
                          sceneId,
                          c.id,
                          e.target.checked,
                        ),
                      "Scene cast updated",
                    )
                  }
                />
              </label>
            ))}
          </div>
          <Link className="ds-button" to={`/projects/${projectId}/world`}>
            Open cast & world
            <ArrowRight size={16} />
          </Link>
          <button
            className="ds-button ds-primary"
            onClick={() => setManage(false)}
          >
            Done
          </button>
        </DialogContent>
      </Dialog>
    </aside>
  );
}

function ReadinessRow({
  label,
  count,
  total,
}: {
  label: string;
  count: number;
  total: number;
}) {
  const complete = total > 0 && count === total;
  return (
    <p className={complete ? "is-complete" : count > 0 ? "is-partial" : ""}>
      {complete ? <Check size={20} /> : <Circle size={20} />}
      <span>{label}</span>
      <small>{total > 1 ? `${count}/${total}` : ""}</small>
    </p>
  );
}
