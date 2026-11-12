import { useState, type ReactNode } from "react";
import { useStore } from "../stores/store";
import { useSelection, useStudio, entity } from "./selection";
import { useCommands, CommandButton } from "./commands";
import { commit, useGenerate } from "./generation";
import {
  shotStatus,
  changeShot,
  changeShotCamera,
  setShotDuration,
  changeScene,
  changeEpisode,
  setEpisodeFormat,
  assignWorld,
  selectedWorkspaceShots,
  setShotWorldElement,
  changeShotInputs,
  restoreWorkspaceSceneCast,
  setWorkspaceContinuity,
  setWorkspaceSceneCast,
  useWorkspaceTake,
  discardWorkspaceTake,
} from "../domain/workspace";
import {
  generationInputs,
  saveGenerationCast,
  saveGenerationInputs,
} from "../domain/generation-inputs";
import { effectiveCast, characterLooks } from "../domain/studio-selectors";
import { Director } from "../features/Director";
import {
  FrameControls,
  type FrameKind,
} from "../features/generation/FrameControls";
import { ImageWorkspace } from "../features/generation/ImageWorkspace";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../components/ui/dialog";
import { CONFIG, type Shot } from "../domain/types";
export function Field({
  label,
  value,
  onSave,
  multiline = false,
  type = "text",
}: {
  label: string;
  value: string | number;
  onSave(value: string): void;
  multiline?: boolean;
  type?: string;
}) {
  return (
    <label className="st-field">
      {label}
      {multiline ? (
        <textarea
          key={String(value)}
          aria-label={label}
          defaultValue={value}
          onBlur={(e) => {
            if (e.target.value !== String(value)) onSave(e.target.value);
          }}
        />
      ) : (
        <input
          key={String(value)}
          aria-label={label}
          type={type}
          defaultValue={value}
          onBlur={(e) => {
            if (e.target.value !== String(value)) onSave(e.target.value);
          }}
        />
      )}
    </label>
  );
}
type Section = {
  id: string;
  title: string;
  advanced?: boolean;
  render(ctx: { id: string; episodeId: string; projectId: string }): ReactNode;
};
const sections: Record<string, Section[]> = {};
export function registerInspector(type: string, section: Section) {
  (sections[type] ??= []).push(section);
}
function EpisodeFields({ id }: { id: string }) {
  const data = useStore((s) => s.data),
    ep = data.episodes[id];
  if (!ep) return null;
  return (
    <>
      <Field
        label="Episode title"
        value={ep.title}
        onSave={(title) =>
          commit((d) => changeEpisode(d, id, { title }), "Episode renamed")
        }
      />
      <Field
        label="Visual style"
        value={ep.style ?? ""}
        multiline
        onSave={(style) =>
          commit((d) => changeEpisode(d, id, { style }), "Style updated")
        }
      />
      <Field
        label="Episode target seconds"
        value={ep.targetSeconds}
        type="number"
        onSave={(v) =>
          commit(
            (d) => changeEpisode(d, id, { targetSeconds: Number(v) }),
            "Target updated",
          )
        }
      />
      <label className="st-field">
        Aspect ratio
        <select
          aria-label="Episode aspect ratio"
          value={
            ep.sceneIds[0]
              ? generationInputs(data, ep.sceneIds[0]).aspectRatio
              : "9:16"
          }
          onChange={(e) =>
            commit(
              (d) =>
                setEpisodeFormat(
                  d,
                  id,
                  e.target.value as "9:16" | "16:9" | "1:1",
                ),
              "Output format updated",
            )
          }
        >
          <option>9:16</option>
          <option>16:9</option>
          <option>1:1</option>
        </select>
      </label>
      <div className="st-episode-progress">
        {["Draft", "Still", "Video", "Locked"].map((status) => (
          <span key={status}>
            <b>
              {
                ep.sceneIds
                  .flatMap((sid) => data.scenes[sid].shotIds)
                  .filter((q) => shotStatus(data, data.shots[q]) === status)
                  .length
              }
            </b>
            {status}
          </span>
        ))}
      </div>
      <p className="st-muted">{ep.sceneIds.length} scenes</p>
    </>
  );
}
function SceneFields({ id, projectId }: { id: string; projectId: string }) {
  const d = useStore((s) => s.data),
    sc = d.scenes[id];
  if (!sc) return null;
  const setup = d.studio.setups[id];
  return (
    <>
      <Field
        label="Scene title"
        value={sc.title}
        onSave={(title) =>
          commit((data) => changeScene(data, id, { title }), "Scene renamed")
        }
      />
      <Field
        label="Scene description"
        value={sc.description}
        multiline
        onSave={(description) =>
          commit(
            (data) => changeScene(data, id, { description }),
            "Scene updated",
          )
        }
      />
      <h3>Cast</h3>
      {Object.values(d.characters)
        .filter((c) => c.projectId === projectId)
        .map((c) => (
          <label className="st-check" key={c.id}>
            <input
              type="checkbox"
              checked={!!setup?.cast.some((a) => a.characterId === c.id)}
              onChange={(e) =>
                commit(
                  (data) =>
                    setWorkspaceSceneCast(data, id, c.id, e.target.checked),
                  "Scene cast updated",
                )
              }
            />
            {c.name}
          </label>
        ))}
      <label className="st-field">
        Place
        <select
          aria-label="Scene place"
          value={setup?.locationId ?? ""}
          onChange={(e) =>
            commit(
              (data) =>
                saveGenerationInputs(data, id, {
                  locationMode: e.target.value ? "selected" : "inferred",
                  locationId: e.target.value || undefined,
                }),
              "Place updated",
            )
          }
        >
          <option value="">From description</option>
          {Object.values(d.studio.locations)
            .filter((l) => l.projectId === projectId)
            .map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
        </select>
      </label>
      <p className="st-muted">
        {sc.shotIds.reduce((n, q) => n + d.shots[q].targetFrames / 30, 0)}s ·{" "}
        {sc.shotIds.length} shots
      </p>
    </>
  );
}
function ShotPrompt({ shot }: { shot: Shot }) {
  const d = useStore((s) => s.data);
  const [value, setValue] = useState(shot.action);
  const mention = value.match(/@([\w ]*)$/)?.[1];
  const chars = Object.values(d.characters).filter(
    (c) =>
      c.projectId === d.episodes[d.scenes[shot.sceneId].episodeId].projectId,
  );
  return (
    <label className="st-field">
      Prompt
      <textarea
        aria-label="Shot prompt"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          if (value !== shot.action)
            commit(
              (data) => changeShot(data, shot.id, { action: value }),
              "Prompt updated",
            );
        }}
      />
      {mention !== undefined && (
        <div className="st-mentions">
          {chars
            .filter((c) => c.name.toLowerCase().includes(mention.toLowerCase()))
            .map((c) => (
              <button
                key={c.id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  const next = value.replace(/@[\w ]*$/, `@${c.name} `);
                  setValue(next);
                  commit((data) => {
                    changeShot(data, shot.id, { action: next });
                    assignWorld(data, [shot.id], "character", c.id);
                  }, "Character mentioned");
                }}
              >
                {c.name}
              </button>
            ))}
        </div>
      )}
      <small>@ to mention a character</small>
    </label>
  );
}
function ShotProperties({ id, projectId }: { id: string; projectId: string }) {
  const d = useStore((s) => s.data),
    s = d.shots[id];
  if (!s) return null;
  const cast = effectiveCast(d, id);
  return (
    <>
      <Field
        label="Shot title"
        value={s.title}
        onSave={(title) =>
          commit((data) => changeShot(data, id, { title }), "Shot renamed")
        }
      />
      <ShotPrompt key={id + "-" + s.revision} shot={s} />
      <h3>
        Cast{" "}
        <small>{s.castOverride ? "Override" : "Inherited from scene"}</small>
      </h3>
      {Object.values(d.characters)
        .filter((c) => c.projectId === projectId)
        .map((c) => {
          const selected = cast.some((a) => a.characterId === c.id);
          return (
            <div key={c.id}>
              <label className="st-check">
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={(e) =>
                    commit(
                      (data) =>
                        saveGenerationCast(
                          data,
                          s.sceneId,
                          e.target.checked
                            ? [...cast, { characterId: c.id }]
                            : cast.filter((a) => a.characterId !== c.id),
                          id,
                        ),
                      "Shot cast updated",
                    )
                  }
                />
                {c.name}
              </label>
              {selected && (
                <select
                  aria-label={`Look for ${c.name}`}
                  value={cast.find((a) => a.characterId === c.id)?.lookId ?? ""}
                  onChange={(e) =>
                    commit(
                      (data) =>
                        saveGenerationCast(
                          data,
                          s.sceneId,
                          cast.map((a) =>
                            a.characterId === c.id
                              ? { ...a, lookId: e.target.value || undefined }
                              : a,
                          ),
                          id,
                        ),
                      "Look updated",
                    )
                  }
                >
                  <option value="">Identity</option>
                  {characterLooks(d, c.id, d.scenes[s.sceneId].episodeId).map(
                    (l) => (
                      <option value={l.id} key={l.id}>
                        {l.name}
                      </option>
                    ),
                  )}
                </select>
              )}
            </div>
          );
        })}
      {s.castOverride && (
        <button
          className="st-text-button"
          onClick={() =>
            commit((data) => {
              restoreWorkspaceSceneCast(data, id);
            }, "Scene cast restored")
          }
        >
          Use scene cast
        </button>
      )}
    </>
  );
}
function ShotCamera({ id }: { id: string }) {
  const s = useStore((store) => store.data.shots[id]);
  if (!s) return null;
  return (
    <>
      <label className="st-field">
        Framing
        <select
          aria-label="Shot framing"
          value={s.framing ?? "Medium"}
          onChange={(e) =>
            commit(
              (d) => changeShotCamera(d, id, { framing: e.target.value }),
              "Framing updated",
            )
          }
        >
          {["Wide", "Full body", "Medium", "Close-up", "Detail"].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      <label className="st-field">
        Movement
        <select
          aria-label="Camera movement"
          value={s.movement ?? "Static"}
          onChange={(e) =>
            commit(
              (d) => changeShotCamera(d, id, { movement: e.target.value }),
              "Camera updated",
            )
          }
        >
          {["Static", "Pan", "Tracking", "Push in", "Handheld"].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      <Field
        label="Duration seconds"
        type="number"
        value={(s.currentTakeId ? s.outFrame - s.inFrame : s.targetFrames) / 30}
        onSave={(v) =>
          commit((d) => setShotDuration(d, id, Number(v)), "Duration updated")
        }
      />
    </>
  );
}
function ShotTakes({ id }: { id: string }) {
  const d = useStore((s) => s.data),
    [compare, setCompare] = useState(false);
  const shot = d.shots[id];
  if (!shot) return null;
  const takes = Object.values(d.takes)
    .filter((t) => t.shotId === id && !shot.discardedTakeIds?.includes(t.id))
    .sort((a, b) => b.createdAt - a.createdAt);
  const selected = takes.find(
    (t) =>
      t.id === (shot.candidateTakeId ?? shot.currentTakeId ?? shot.imageTakeId),
  );
  const current = shot.currentTakeId ? d.takes[shot.currentTakeId] : undefined;
  return (
    <>
      <div className={`st-take-preview ${compare ? "st-compare" : ""}`}>
        {[
          ...(compare && current ? [current] : []),
          ...(selected ? [selected] : []),
        ].map((t, i) => {
          const a = d.assets[t.assetId];
          return a?.kind === "video" ? (
            <video key={i} src={a.url} controls />
          ) : (
            <img
              key={i}
              src={a?.url ?? d.scenes[shot.sceneId].cover}
              alt={
                compare ? `${i === 0 ? "Current" : "New"} take` : "Shot preview"
              }
            />
          );
        })}
        {!selected && <div className="st-empty-preview">Draft</div>}
      </div>
      <div className="st-inline">
        <span className="st-status">{shotStatus(d, shot)}</span>
        {current && selected?.id !== current.id && (
          <button
            className="st-text-button"
            onClick={() => setCompare(!compare)}
          >
            {compare ? "Single" : "Compare"}
          </button>
        )}
      </div>
      {takes.length > 0 && (
        <div className="st-takes">
          {takes.map((t) => (
            <div className="st-take" key={t.id}>
              <img src={d.assets[t.assetId]?.url} alt="" />
              <span>
                {t.kind === "image" ? "Still" : "Video"}
                <small>
                  {t.id === shot.currentTakeId
                    ? "In edit"
                    : t.id === shot.candidateTakeId
                      ? "New take"
                      : new Date(t.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                </small>
              </span>
              <button
                className="st-button"
                onClick={() =>
                  commit(
                    (data) => useWorkspaceTake(data, id, t.id),
                    "Take selected",
                  )
                }
              >
                Use
              </button>
              <button
                className="st-text-button"
                onClick={() =>
                  commit(
                    (data) => discardWorkspaceTake(data, id, t.id),
                    "Take discarded",
                  )
                }
              >
                Discard
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
function ShotAdvanced({ id, projectId }: { id: string; projectId: string }) {
  const d = useStore((s) => s.data),
    s = d.shots[id];
  const [image, setImage] = useState<{
    shotId: string;
    kind: FrameKind;
  } | null>(null);
  if (!s) return null;
  const input = generationInputs(d, s.sceneId, id);
  return (
    <>
      <FrameControls
        ids={[id]}
        onCreate={(shotId, kind) => setImage({ shotId, kind })}
      />
      <h3>Props & notes</h3>
      {(d.projects[projectId].worldElements ?? []).map((element) => (
        <label className="st-check" key={element.id}>
          <input
            type="checkbox"
            checked={!!s.worldElementIds?.includes(element.id)}
            onChange={(e) =>
              commit(
                (data) =>
                  setShotWorldElement(
                    data,
                    id,
                    element.kind,
                    element.id,
                    e.target.checked,
                  ),
                "World assignment updated",
              )
            }
          />
          {element.name}
        </label>
      ))}
      <label className="st-field">
        Continuity
        <select
          aria-label="Continuity source"
          value={s.dependsOn ?? ""}
          onChange={(e) =>
            commit((data) => {
              setWorkspaceContinuity(data, id, e.target.value || undefined);
            }, "Continuity updated")
          }
        >
          <option value="">Independent</option>
          {d.scenes[s.sceneId].shotIds
            .slice(0, d.scenes[s.sceneId].shotIds.indexOf(id))
            .map((q) => (
              <option key={q} value={q}>
                {d.shots[q].title}
              </option>
            ))}
        </select>
      </label>
      <label className="st-field">
        Model
        <select aria-label="Shot model" value="demo" onChange={() => {}}>
          <option value="demo">Local multimodal demo</option>
        </select>
      </label>
      <label className="st-field">
        Additional reference
        <select
          aria-label="Add shot reference"
          value=""
          onChange={(e) => {
            if (e.target.value)
              commit(
                (data) =>
                  changeShotInputs(data, id, {
                    referenceInputs: [
                      ...input.referenceInputs,
                      { assetId: e.target.value, purpose: "visual_style" },
                    ],
                  }),
                "Reference added",
              );
          }}
        >
          <option value="">Choose media…</option>
          {Object.values(d.assets)
            .filter(
              (a) =>
                a.projectId === projectId && !a.missing && a.kind !== "audio",
            )
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
        </select>
      </label>
      {input.referenceInputs.map((r) => (
        <div className="st-inline" key={r.assetId}>
          <span>{d.assets[r.assetId]?.title}</span>
          <button
            className="st-text-button"
            onClick={() =>
              commit(
                (data) =>
                  changeShotInputs(data, id, {
                    referenceInputs: input.referenceInputs.filter(
                      (x) => x.assetId !== r.assetId,
                    ),
                  }),
                "Reference removed",
              )
            }
          >
            Remove
          </button>
        </div>
      ))}
      <Dialog
        open={!!image}
        onOpenChange={(v) => {
          if (!v) setImage(null);
        }}
      >
        <DialogContent className="video-generation-dialog">
          {image ? (
            <ImageWorkspace {...image} back={() => setImage(null)} />
          ) : (
            <>
              <DialogTitle>Image</DialogTitle>
              <DialogDescription>Frame composition</DialogDescription>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
registerInspector("episode", {
  id: "episode",
  title: "Episode",
  render: (ctx) => <EpisodeFields id={ctx.episodeId} />,
});
registerInspector("shot", {
  id: "takes",
  title: "Preview & takes",
  render: (ctx) => <ShotTakes {...ctx} />,
});
registerInspector("shot", {
  id: "prompt",
  title: "Prompt & cast",
  render: (ctx) => <ShotProperties {...ctx} />,
});
registerInspector("shot", {
  id: "camera",
  title: "Camera",
  render: (ctx) => <ShotCamera {...ctx} />,
});
registerInspector("shot", {
  id: "advanced",
  title: "Frames, references & continuity",
  advanced: true,
  render: (ctx) => <ShotAdvanced {...ctx} />,
});
registerInspector("scene", {
  id: "scene",
  title: "Scene",
  render: (ctx) => <SceneFields {...ctx} />,
});
export function RegisteredInspectorSections({
  type,
  id,
  projectId,
  episodeId = "",
}: {
  type: string;
  id: string;
  projectId: string;
  episodeId?: string;
}) {
  const advanced = useStore((s) => s.ui.inspectorAdvanced);
  return (
    <>
      {(sections[type] ?? [])
        .filter((section) => !section.advanced || advanced)
        .map((section) => (
          <details
            key={`${type}:${id}:${section.id}`}
            className="st-inspector-section"
            open
          >
            <summary>{section.title}</summary>
            {section.render({ id, projectId, episodeId })}
          </details>
        ))}
    </>
  );
}
export function Inspector({
  episodeId,
  projectId,
}: {
  episodeId: string;
  projectId: string;
}) {
  const d = useStore((s) => s.data),
    advanced = useStore((s) => s.ui.inspectorAdvanced),
    keys = useSelection((s) => s.keys),
    tab = useStudio((s) => s.inspectorTab),
    generate = useGenerate();
  useCommands();
  const selection = entity(keys.at(-1)),
    type =
      keys.length === 1 && ["scene", "shot"].includes(selection.type)
        ? selection.type
        : "episode",
    id = type === "episode" ? episodeId : selection.id;
  const sid =
    type === "scene" ? id : type === "shot" ? d.shots[id]?.sceneId : undefined;
  const shotIds = selectedWorkspaceShots(d, keys, episodeId);
  return (
    <aside className="st-inspector" aria-label="Inspector">
      <header className="st-inspector-tabs">
        <button
          aria-pressed={tab === "properties"}
          onClick={() =>
            useStudio.getState().set({ inspectorTab: "properties" })
          }
        >
          Inspector{keys.length > 1 ? ` · ${keys.length}` : ""}
        </button>
        <button
          aria-pressed={tab === "director"}
          onClick={() => useStudio.getState().set({ inspectorTab: "director" })}
        >
          AI Director
        </button>
        <button
          className="st-inspector-close"
          aria-label="Hide inspector"
          onClick={() => useStudio.getState().set({ inspector: false })}
        >
          ×
        </button>
      </header>
      {tab === "director" ? (
        <Director
          projectId={projectId}
          episodeId={episodeId}
          sceneId={sid}
          onGenerate={(ids, replacement, proposalId) =>
            generate(
              ids,
              replacement || ids.every((id) => d.shots[id]?.imageTakeId)
                ? "video"
                : "image",
              proposalId,
            )
          }
        />
      ) : (
        <>
          <div className="st-inspector-mode">
            <button
              aria-pressed={!advanced}
              onClick={() =>
                useStore.getState().setUI({ inspectorAdvanced: false })
              }
            >
              Simple
            </button>
            <button
              aria-pressed={!!advanced}
              onClick={() =>
                useStore.getState().setUI({ inspectorAdvanced: true })
              }
            >
              Advanced
            </button>
          </div>
          <div className="st-panel-scroll">
            {keys.length > 1 && (
              <section className="st-inspector-section">
                <h3>{shotIds.length} shots selected</h3>
                <button
                  className="st-button st-primary"
                  onClick={() => generate(shotIds, "image")}
                >
                  Generate stills · {shotIds.length * CONFIG.imageCost} cr
                </button>
                <button
                  className="st-button"
                  onClick={() => generate(shotIds, "video")}
                >
                  Animate · {shotIds.length * CONFIG.videoCost} cr
                </button>
              </section>
            )}
            {(sections[type] ?? sections.episode)
              .filter((s) => !s.advanced || advanced)
              .map((s) => (
                <details
                  className="st-inspector-section"
                  key={`${type}:${id}:${s.id}`}
                  open
                >
                  <summary>{s.title}</summary>
                  {s.render({ id, episodeId, projectId })}
                </details>
              ))}
          </div>
          <footer>
            {type === "shot" ? (
              <>
                <CommandButton
                  id={`${d.shots[id]?.imageTakeId ? "animate" : "generate"}:${id}`}
                  className="st-primary"
                />
                <CommandButton id="selection.lock" />
              </>
            ) : type === "scene" ? (
              <CommandButton
                id={`generate-scene:${id}`}
                className="st-primary"
              />
            ) : (
              <CommandButton id="episode.generate" className="st-primary" />
            )}
          </footer>
        </>
      )}
    </aside>
  );
}
