import { SceneTitleHeading } from "./SceneTitleHeading";
import { sceneOutlineSummary } from "../../domain/scene-text";
import { ScriptEnhancement } from "./ScriptEnhancement";
import { deleteCardSelection } from "../../domain/card-deletion";
import { ShotPlanInspector } from "./ShotPlanInspector";
import { SuggestedShotPlan } from "./SuggestedShotPlan";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { SortableList, SortableItem } from "../../components/Sortable";
import {
  addWorkspaceScene,
  addWorkspaceShot,
  reorderShots,
} from "../../domain/workspace";
import { updateScenePlan } from "../../domain/workflow";
import {
  sceneScreenplay,
  proposeSceneAssistance,
  applySceneSuggestion,
  type SceneSuggestion,
} from "../../domain/scene-assistance";
import { scenePreview } from "../../domain/produce";
import { commit } from "../generation";
import { SaveStatus } from "../design/SavingState";
import { DraftField } from "../design/Primitives";
import { SceneFoundations } from "./SceneFoundations";
import { ReferencePicker } from "./ReferencePicker";
import type { ProduceContext } from "./useProduce";

export function ScenePlan({ context }: { context: ProduceContext }) {
  const { data, episode, scene, scenes, shots, shot, go } = context;
  const foundationsRef = useRef<HTMLElement>(null);
  const [foundationsHeight, setFoundationsHeight] = useState<number>();
  useLayoutEffect(() => {
    const panel = foundationsRef.current;
    if (!panel) return;
    const measure = () => {
      const height = panel.getBoundingClientRect().height;
      setFoundationsHeight(height || undefined);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [scene?.id]);
  const [references, setReferences] = useState(false),
    [enhancing, setEnhancing] = useState(false);
  const [proposals, setProposals] = useState<Record<string, SceneSuggestion>>(
    {},
  );
  const suggestion = scene ? proposals[scene.id] : undefined;
  const setSuggestion = (proposal: SceneSuggestion | null) => {
    if (!scene) return;
    setProposals((current) => {
      const next = { ...current };
      if (proposal) next[scene.id] = proposal;
      else delete next[scene.id];
      return next;
    });
  };
  useEffect(() => {
    setReferences(false);
    setEnhancing(false);
  }, [scene?.id]);
  const addScene = () => {
    let id = "";
    if (
      commit((d) => {
        id = addWorkspaceScene(d, episode.id);
      }, "Scene added")
    )
      go("plan", id, undefined);
  };
  if (!scene)
    return (
      <div className="produce-empty">
        <h2>Every story starts with a scene.</h2>
        <p>Add a scene, describe what happens, and plan its shots.</p>
        <button className="ds-button ds-primary" onClick={addScene}>
          <Plus size={17} />
          Add scene
        </button>
      </div>
    );
  return (
    <div className="produce-plan-layout">
      <div className="produce-plan-main">
        <aside
          className="produce-panel produce-outline"
          aria-label="Scene outline"
          style={{ height: foundationsHeight }}
        >
          <h2>Scene outline</h2>
          <div className="produce-outline-scenes">
            {scenes.map((item, index) => {
              const preview = scenePreview(data, item.id);
              return (
                <article
                  key={item.id}
                  className={scene.id === item.id ? "is-selected" : ""}
                >
                  <header className="produce-outline-card-heading">
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <SceneTitleHeading
                      sceneId={item.id}
                      title={item.title}
                      compact
                      onSelect={() => go("plan", item.id)}
                    />
                    <button
                      className="ds-icon produce-delete-scene"
                      aria-label={`Delete scene ${item.title}`}
                      title="Delete scene"
                      onClick={() => {
                        const remaining = scenes.filter(
                          (entry) => entry.id !== item.id,
                        );
                        const next =
                          remaining[Math.min(index, remaining.length - 1)];
                        if (
                          commit((d) => {
                            deleteCardSelection(d, [`scene:${item.id}`]);
                          }, "Scene deleted") &&
                          scene.id === item.id
                        )
                          go("plan", next?.id);
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </header>
                  <button
                    className="produce-scene-select"
                    aria-label={`Plan ${item.title}`}
                    aria-pressed={scene.id === item.id}
                    onClick={() => go("plan", item.id)}
                  >
                    <span className="produce-scene-preview">
                      <img src={preview.url} alt="" />
                      {preview.status && <small>{preview.status}</small>}
                    </span>
                    <span className="produce-scene-summary">
                      {sceneOutlineSummary(data, item.id) ||
                        "Write the script to preview this scene."}
                    </span>
                  </button>
                  {!preview.sample && (
                    <Link
                      className="produce-link produce-open-shot"
                      aria-label={`Open generated shot for ${item.title}`}
                      to={context.href("shots", item.id, preview.shotId)}
                    >
                      Open shot ↗
                    </Link>
                  )}
                </article>
              );
            })}
            <button className="produce-add-scene-card" onClick={addScene}>
              <Plus size={24} aria-hidden="true" />
              <span>Add scene</span>
            </button>
          </div>
        </aside>
        <section
          className="produce-panel produce-script"
          aria-label="Scene editor"
        >
          <div className="produce-editor-heading">
            <SceneTitleHeading
              key={scene.id}
              sceneId={scene.id}
              title={scene.title}
            />
            <div className="produce-editor-actions">
              <SaveStatus compact />
              <button
                className="ds-button produce-outline-gold"
                onClick={() => setEnhancing(true)}
              >
                <Sparkles size={14} />
                Enhance script
              </button>
            </div>
          </div>
          <DraftField
            key={scene.id}
            multiline
            rows={14}
            className="produce-screenplay"
            label="Scene screenplay"
            value={sceneScreenplay(data, scene.id)}
            onSave={(screenplay) =>
              commit(
                (d) => updateScenePlan(d, scene.id, { screenplay }),
                "Script saved",
              )
            }
          />
        </section>
        <section
          className="produce-panel produce-coverage"
          aria-label="Shot plan"
        >
          <header>
            <h2>
              Shot plan{" "}
              <small>
                · {shots.length} shots · Estimated{" "}
                {shots.reduce((sum, s) => sum + s.targetFrames / 30, 0)}s
              </small>
            </h2>
            <div className="produce-actions">
              <button
                className="ds-button produce-outline-gold"
                disabled={!!suggestion}
                onClick={() =>
                  setSuggestion(proposeSceneAssistance(data, scene.id))
                }
              >
                <Sparkles size={15} />
                Suggest shots
              </button>
              <button
                className="ds-button ds-primary"
                disabled={!!suggestion}
                onClick={() => {
                  let id = "";
                  if (
                    commit((d) => {
                      id = addWorkspaceShot(d, scene.id);
                    }, "Shot added")
                  )
                    go("plan", scene.id, id);
                }}
              >
                <Plus size={16} />
                Add shot
              </button>
            </div>
          </header>
          {suggestion ? (
            <SuggestedShotPlan
              key={suggestion.sceneId}
              proposal={suggestion}
              onChange={setSuggestion}
              existingCount={shots.length}
              stale={(scene.planRevision ?? 1) !== suggestion.sourceRevision}
              onDiscard={() => setSuggestion(null)}
              onConfirm={(proposal) => {
                let firstId: string | undefined;
                if (
                  commit((d) => {
                    const count = d.scenes[scene.id].shotIds.length;
                    applySceneSuggestion(d, proposal, "shots");
                    firstId = d.scenes[scene.id].shotIds[count];
                  }, "Suggested shots confirmed")
                ) {
                  setSuggestion(null);
                  go("plan", scene.id, firstId);
                }
              }}
            />
          ) : (
            <div className="produce-coverage-body">
              <div className="produce-shot-list">
                <SortableList
                  ids={shots.map((s) => s.id)}
                  onReorder={(ids) =>
                    commit(
                      (d) => reorderShots(d, scene.id, ids),
                      "Shot order saved",
                    )
                  }
                >
                  {shots.map((item, index) => (
                    <SortableItem
                      id={item.id}
                      key={item.id}
                      className={`produce-shot-row ${shot?.id === item.id ? "is-selected" : ""}`}
                    >
                      <button
                        aria-pressed={shot?.id === item.id}
                        onClick={() => go("plan", scene.id, item.id)}
                      >
                        <span>{String(index + 1).padStart(2, "0")}</span>
                        <span>
                          <b>{item.title}</b>
                          <small>{item.framing || "Medium"}</small>
                        </span>
                        <p>{item.action}</p>
                        <time>~ {item.targetFrames / 30}s</time>
                      </button>
                      <button
                        className="ds-icon produce-delete-shot"
                        aria-label={`Delete shot ${item.title}`}
                        title={
                          item.locked
                            ? "Unlock this shot before deleting"
                            : "Delete shot"
                        }
                        disabled={item.locked}
                        onClick={() => {
                          const remaining = shots.filter(
                            (s) => s.id !== item.id,
                          );
                          if (
                            commit((d) => {
                              deleteCardSelection(d, [`shot:${item.id}`]);
                            }, "Shot deleted")
                          )
                            go(
                              "plan",
                              scene.id,
                              shot?.id === item.id
                                ? remaining[0]?.id
                                : shot?.id,
                            );
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </SortableItem>
                  ))}
                </SortableList>
              </div>
              <section
                className="produce-shot-details produce-shot-plan-details"
                aria-label="Shot plan details"
              >
                <ShotPlanInspector key={shot?.id} context={context} />
              </section>
            </div>
          )}
        </section>
      </div>
      <SceneFoundations
        panelRef={foundationsRef}
        context={context}
        onReferences={() => setReferences(true)}
      />
      {enhancing && (
        <ScriptEnhancement
          sceneId={scene.id}
          onClose={() => setEnhancing(false)}
        />
      )}
      {references && (
        <ReferencePicker
          key={scene.id}
          sceneId={scene.id}
          onClose={() => setReferences(false)}
        />
      )}
    </div>
  );
}
