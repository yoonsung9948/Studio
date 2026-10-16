import { useEffect, useRef } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock,
  FileText,
  ImageIcon,
  Scissors,
  Sparkles,
} from "lucide-react";
import { openDirector } from "../stores/director";
import { useStore } from "../stores/store";
import { Button } from "../components/ui/button";
import { useActions } from "../components/Actions";
import { EpisodeNavigation } from "./EpisodeNavigation";
import { GenerationDialog } from "./generation/GenerationDialog";
import { NotFound } from "./Gallery";
import { ensureSetup, updateShotPlan } from "../domain/scene-preflight";
import {
  approveScenePlan,
  scriptApproved,
  scenePlanApproved,
  updateScenePlan,
  splitScene,
  mergeSceneWithNext,
} from "../domain/workflow";
import {
  saveGenerationCast,
  saveGenerationInputs,
} from "../domain/generation-inputs";
import { updateDirection } from "../domain/studio-commands";
import { approveTake, cancelJob, retryJob } from "../domain/commands";
import {
  characterLooks,
  characterReady,
  lookReady,
  versionAsset,
} from "../domain/studio-selectors";
import { active } from "../domain/selectors";
export function SceneWorkspace() {
  const { projectId = "", episodeId = "", sceneId = "" } = useParams();
  const d = useStore((s) => s.data),
    mutate = useStore((s) => s.mutate);
  const [params, setParams] = useSearchParams();
  const workspace = useRef<HTMLDivElement>(null);
  useEffect(() => {
    workspace.current?.scrollTo?.({ top: 0 });
  }, [sceneId, params.get("step")]);
  const navigate = useNavigate(),
    modal = useActions();
  const sc = d.scenes[sceneId],
    ep = d.episodes[episodeId];
  const valid =
    !!sc && sc.episodeId === episodeId && ep?.projectId === projectId;
  useEffect(() => {
    if (valid && !d.studio.setups[sceneId])
      mutate((d) => {
        ensureSetup(d, sceneId);
      });
  }, [sceneId, valid]);
  useEffect(() => {
    const show = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.sceneId === sceneId) setParams({ step: "results" });
    };
    window.addEventListener("dotori-generation-results", show);
    return () => window.removeEventListener("dotori-generation-results", show);
  }, [sceneId, setParams]);
  if (!valid) return <NotFound />;
  const ready = scenePlanApproved(d, sceneId),
    step = (
      ["plan", "references", "results"].includes(params.get("step") ?? "")
        ? params.get("step")
        : "plan"
    ) as "plan" | "references" | "results";
  const setup = d.studio.setups[sceneId];
  if (!setup) return <p className="empty">Preparing the scene…</p>;
  const select = (step: string) => setParams({ step });
  const index = ep.sceneIds.indexOf(sceneId),
    shotId = params.get("shot") ?? undefined;
  const ids = shotId && sc.shotIds.includes(shotId) ? [shotId] : sc.shotIds;
  const hasFootage = sc.shotIds.some((id) => d.shots[id].currentTakeId);
  const suggestedCast = Object.values(d.characters).filter(
    (c) =>
      c.projectId === projectId &&
      characterReady(d, c.id) &&
      !setup.cast.some((a) => a.characterId === c.id) &&
      `${sc.title} ${sc.description} ${sc.dialogue}`
        .toLowerCase()
        .includes(c.name.split(" ")[0].toLowerCase()),
  );
  const suggestedLocation = !setup.locationId
    ? Object.values(d.studio.locations).find(
        (l) =>
          l.projectId === projectId &&
          l.assetId &&
          `${sc.description} ${sc.settingDescription}`
            .toLowerCase()
            .includes(l.name.toLowerCase()),
      )
    : undefined;
  return (
    <div className="scene-workspace" ref={workspace}>
      <EpisodeNavigation
        projectId={projectId}
        episodeId={episodeId}
        active="scenes"
      />
      <header className="scene-workspace-header">
        <Link
          className="scene-back"
          to={`/projects/${projectId}/episodes/${episodeId}?tab=scenes`}
        >
          <ArrowLeft size={13} />
          All scenes
        </Link>
        <div className="page-heading">
          <div>
            <span className="eyebrow">
              SCENE {String(index + 1).padStart(2, "0")} / {ep.title}
            </span>
            <h1>{sc.title}</h1>
            <div className="scene-workspace-meta">
              <span>
                <Clock size={12} />
                {setup.targetSeconds}s target
              </span>
              <span>{sc.shotIds.length} shots</span>
              <span className={`status ${ready ? "green" : "amber"}`}>
                {ready ? (
                  <>
                    <Check size={12} />
                    Plan approved
                  </>
                ) : (
                  "Plan needs review"
                )}
              </span>
            </div>
          </div>
          <div className="scene-heading-actions">
            <Button
              variant="default"
              onClick={() => modal({ kind: "video", episodeId, sceneId })}
            >
              <Sparkles size={14} />
              Generate scene
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                openDirector(
                  "Help me edit this scene's plan, action, dialogue, and creative direction.",
                )
              }
            >
              <Sparkles size={14} />
              Edit with AI
            </Button>
            {hasFootage && (
              <Button asChild variant="ghost">
                <Link
                  to={`/projects/${projectId}/episodes/${episodeId}/scenes/${sceneId}/edit`}
                >
                  <Scissors size={14} />
                  Open in Editor
                </Link>
              </Button>
            )}
          </div>
        </div>
      </header>
      <nav className="scene-workflow-nav" aria-label="Scene workflow">
        {(["plan", "references", "results"] as const).map((s, i) => (
          <button
            key={s}
            aria-current={step === s ? "step" : undefined}
            onClick={() => select(s)}
          >
            <span>
              {s === "plan" && ready ? (
                <Check size={12} />
              ) : (
                String(i + 1).padStart(2, "0")
              )}
            </span>
            {s[0].toUpperCase() + s.slice(1)}
            {s === "results" &&
              sc.shotIds.some((id) => d.shots[id].candidateTakeId) && <i />}
          </button>
        ))}
      </nav>
      {step === "plan" && (
        <div className="scene-plan-workspace">
          <main className="scene-plan-form">
            <div className="workflow-section-heading">
              <div>
                <span className="eyebrow">THE CREATIVE BRIEF</span>
                <h2>Shape this moment.</h2>
                <p>
                  Make the action, dialogue, setting, and timing clear before
                  choosing references.
                </p>
              </div>
            </div>
            {!scriptApproved(ep) && (
              <div className="workflow-notice">
                <FileText size={18} />
                <div>
                  <b>The script needs approval.</b>
                  <p>
                    Review the current version before approving this scene plan.
                  </p>
                </div>
                <Button asChild>
                  <Link
                    to={`/projects/${projectId}/episodes/${episodeId}?tab=script`}
                  >
                    Review script
                  </Link>
                </Button>
              </div>
            )}
            {sc.sourceScriptRevision !== (ep.scriptRevision ?? 1) && (
              <p className="notice-inline amber">
                The script has changed since this scene was planned. Review the
                details below, then approve the plan for the current script.
              </p>
            )}
            <div className="scene-plan-fields">
              {(
                [
                  ["title", "Scene title"],
                  ["description", "Detailed action"],
                  ["dialogue", "Dialogue"],
                  ["settingDescription", "Setting description"],
                  ["creativeNotes", "Creative direction"],
                ] as const
              ).map(([key, label]) => (
                <label key={sceneId + key}>
                  {label}
                  {key === "title" ? (
                    <input
                      defaultValue={sc[key] ?? ""}
                      key={sc[key]}
                      onBlur={(e) =>
                        mutate(
                          (d) =>
                            updateScenePlan(d, sceneId, {
                              [key]: e.target.value,
                            }),
                          true,
                        )
                      }
                    />
                  ) : (
                    <textarea
                      key={sc[key]}
                      defaultValue={sc[key] ?? ""}
                      rows={key === "description" ? 6 : 3}
                      placeholder={
                        key === "settingDescription"
                          ? "Describe the environment. You’ll choose its visual reference next."
                          : key === "dialogue"
                            ? "Spoken lines, if any…"
                            : "Describe the feeling, performance, and visual direction…"
                      }
                      onBlur={(e) =>
                        mutate(
                          (d) =>
                            updateScenePlan(d, sceneId, {
                              [key]: e.target.value,
                            }),
                          true,
                        )
                      }
                    />
                  )}
                </label>
              ))}
            </div>
            <details className="scene-atmosphere">
              <summary>Lighting, camera & atmosphere</summary>
              <div className="generation-direction">
                {(
                  [
                    "time",
                    "lighting",
                    "mood",
                    "style",
                    "camera",
                    "notes",
                  ] as const
                ).map((key) => (
                  <label key={key}>
                    {
                      {
                        time: "Time of day",
                        lighting: "Lighting",
                        mood: "Mood",
                        style: "Visual style",
                        camera: "Camera direction",
                        notes: "Direction notes",
                      }[key]
                    }
                    <input
                      defaultValue={setup.direction[key]}
                      key={setup.direction[key]}
                      onBlur={(e) =>
                        mutate(
                          (d) =>
                            updateDirection(d, sceneId, {
                              [key]: e.target.value,
                            }),
                          true,
                        )
                      }
                    />
                  </label>
                ))}
              </div>
            </details>
            <details className="scene-shot-breakdown">
              <summary>
                Shot breakdown{" "}
                <span>{sc.shotIds.length} shots · optional detail</span>
              </summary>
              {sc.shotIds.map((id, i) => {
                const s = d.shots[id];
                return (
                  <div className="scene-shot-plan" key={id}>
                    <span>{String(i + 1).padStart(2, "0")}</span>
                    <div>
                      <b>{s.title}</b>
                      <label>
                        Action
                        <textarea
                          defaultValue={s.action}
                          key={s.action}
                          onBlur={(e) => {
                            if (e.target.value !== s.action)
                              mutate((d) => {
                                d.shots[id].action = e.target.value;
                                updateScenePlan(d, sceneId, {
                                  creativeNotes: sc.creativeNotes ?? "",
                                });
                                d.scenes[sceneId].planRevision =
                                  (d.scenes[sceneId].planRevision ?? 1) + 1;
                                d.shots[id].revision++;
                                d.shots[id].stale =
                                  !!s.currentTakeId || !!s.imageTakeId;
                                d.projects[projectId].revision++;
                              }, true);
                          }}
                        />
                      </label>
                      <label>
                        Target seconds
                        <input
                          type="number"
                          aria-label={`Shot target ${s.title}`}
                          min={1}
                          max={30}
                          step={1 / 30}
                          key={s.targetFrames}
                          defaultValue={s.targetFrames / 30}
                          onBlur={(e) => {
                            const n = Math.round(Number(e.target.value) * 30);
                            if (n !== s.targetFrames)
                              mutate(
                                (d) =>
                                  updateShotPlan(d, id, { targetFrames: n }),
                                true,
                              );
                          }}
                        />
                      </label>
                      <label>
                        Continuation
                        <select
                          value={s.dependsOn ?? ""}
                          onChange={(e) =>
                            mutate(
                              (d) =>
                                updateShotPlan(d, id, {
                                  dependsOn: e.target.value || undefined,
                                }),
                              true,
                            )
                          }
                        >
                          <option value="">Independent</option>
                          {sc.shotIds.slice(0, i).map((id) => (
                            <option key={id} value={id}>
                              {d.shots[id].title}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>
                );
              })}
            </details>
            <details className="workflow-history">
              <summary>
                Approved plan versions · {sc.planHistory?.length ?? 0}
              </summary>
              {sc.planHistory?.map((v, i) => (
                <details key={i}>
                  <summary>
                    Plan {v.revision} · Script {v.scriptRevision} ·{" "}
                    {v.targetSeconds}s
                  </summary>
                  <p>{v.title}</p>
                  <pre>{v.description}</pre>
                  <pre>{v.dialogue}</pre>
                </details>
              ))}
            </details>
          </main>
          <aside className="scene-plan-summary">
            <span className="eyebrow">SCENE PLAN</span>
            <h3>Timing & approval</h3>
            <label>
              Target duration
              <div>
                <input
                  type="number"
                  aria-label="Scene duration seconds"
                  min={3}
                  max={90}
                  step={1 / 30}
                  key={setup.targetSeconds}
                  defaultValue={setup.targetSeconds}
                  onBlur={(e) =>
                    mutate(
                      (d) =>
                        updateScenePlan(d, sceneId, {}, Number(e.target.value)),
                      true,
                    )
                  }
                />
                <span>seconds</span>
              </div>
            </label>
            <p>
              Changing the scene duration redistributes shot targets. Existing
              timeline trims stay intact.
            </p>
            <div className="plan-summary-fact">
              <span>Shot targets</span>
              <b>
                {Number(
                  sc.shotIds
                    .reduce((n, id) => n + d.shots[id].targetFrames / 30, 0)
                    .toFixed(2),
                )}
                s
              </b>
            </div>
            <div className="plan-summary-fact">
              <span>Based on script</span>
              <b>v{sc.sourceScriptRevision ?? 1}</b>
            </div>
            <div className="plan-summary-fact">
              <span>Current script</span>
              <b>
                v{ep.scriptRevision ?? 1}
                {scriptApproved(ep) ? " · Approved" : " · Draft"}
              </b>
            </div>
            <Button
              variant="default"
              disabled={!scriptApproved(ep)}
              onClick={() => {
                if (mutate((d) => approveScenePlan(d, sceneId), true))
                  select("references");
              }}
            >
              {ready ? "Choose references" : "Approve Scene Plan"}
              <ArrowRight size={14} />
            </Button>
            <small>
              Approval unlocks reference selection. You can revise this plan at
              any time.
            </small>
            <div className="scene-plan-secondary">
              <Button
                variant="ghost"
                size="sm"
                disabled={sc.shotIds.length < 2}
                onClick={() =>
                  modal({
                    kind: "confirm",
                    title: "Split this scene?",
                    description:
                      "Move the latter shots into a new scene. Both plans need approval.",
                    action: (d) => {
                      splitScene(d, sceneId);
                    },
                  })
                }
              >
                Split scene
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={index === ep.sceneIds.length - 1}
                onClick={() =>
                  modal({
                    kind: "confirm",
                    title: "Merge with the next scene?",
                    description:
                      "Combine the plans while keeping their footage and shot reference inputs.",
                    action: (d) => mergeSceneWithNext(d, sceneId),
                  })
                }
              >
                Merge with next
              </Button>
            </div>
          </aside>
        </div>
      )}
      {step === "references" &&
        (!ready ? (
          <div className="workflow-empty">
            <FileText size={32} />
            <h2>Approve the scene plan first.</h2>
            <p>
              Reference inputs stay saved while you review the plan for the
              current script.
            </p>
            <Button variant="default" onClick={() => select("plan")}>
              Review plan
              <ArrowLeft size={13} />
            </Button>
          </div>
        ) : (
          <>
            <div className="scene-reference-intro">
              <span className="eyebrow">MAKE IT VISUAL</span>
              <h2>Choose what guides this scene.</h2>
              <p>
                Use the characters, Looks, settings, and media you’ve created.
                Scene choices are saved and inherited by each shot.
              </p>
              {(suggestedCast.length > 0 || suggestedLocation) && (
                <div className="scene-reference-suggestions">
                  <Sparkles size={13} />
                  <span>Suggested from your plan</span>
                  {suggestedCast.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        const looks = characterLooks(d, c.id),
                          summer = looks.find(
                            (l) =>
                              /summer/i.test(
                                `${sc.description} ${sc.creativeNotes}`,
                              ) &&
                              /summer/i.test(l.name) &&
                              lookReady(d, l.id),
                          );
                        mutate(
                          (d) =>
                            saveGenerationCast(d, sceneId, [
                              ...setup.cast,
                              { characterId: c.id, lookId: summer?.id },
                            ]),
                          true,
                        );
                      }}
                    >
                      {versionAsset(d, c.canonicalVersionId)?.url && (
                        <img
                          src={versionAsset(d, c.canonicalVersionId)!.url}
                          alt=""
                        />
                      )}
                      Add {c.name}
                    </button>
                  ))}
                  {suggestedLocation && (
                    <button
                      onClick={() =>
                        mutate(
                          (d) =>
                            saveGenerationInputs(d, sceneId, {
                              locationId: suggestedLocation.id,
                              locationMode: "selected",
                            }),
                          true,
                        )
                      }
                    >
                      Use {suggestedLocation.name}
                    </button>
                  )}
                </div>
              )}
            </div>
            {shotId && !sc.shotIds.includes(shotId) ? (
              <p className="empty">
                This shot does not belong to the scene.{" "}
                <button onClick={() => select("references")}>
                  Use the scene inputs
                </button>
              </p>
            ) : (
              <GenerationDialog
                key={sceneId + ids.join(",") + params.get("replace")}
                embedded
                videoMode
                initialShotId={shotId}
                ids={ids}
                replacement={params.get("replace") === "1"}
                proposalId={params.get("proposal") ?? undefined}
                close={() => select("results")}
              />
            )}
          </>
        ))}
      {step === "results" && (
        <SceneResults
          sceneId={sceneId}
          projectId={projectId}
          onInputs={() => select("references")}
        />
      )}
      <footer className="scene-workspace-footer">
        {index > 0 ? (
          <Link
            to={`/projects/${projectId}/episodes/${episodeId}/scenes/${ep.sceneIds[index - 1]}`}
          >
            <ArrowLeft size={13} />
            Previous scene
          </Link>
        ) : (
          <span />
        )}
        <span>
          {index + 1} of {ep.sceneIds.length} scenes
        </span>
        {index < ep.sceneIds.length - 1 ? (
          <Link
            to={`/projects/${projectId}/episodes/${episodeId}/scenes/${ep.sceneIds[index + 1]}`}
          >
            Next scene
            <ArrowRight size={13} />
          </Link>
        ) : (
          <button
            onClick={() =>
              navigate(`/projects/${projectId}/episodes/${episodeId}?tab=edit`)
            }
          >
            Go to Edit
            <ArrowRight size={13} />
          </button>
        )}
      </footer>
    </div>
  );
}
function SceneResults({
  sceneId,
  projectId,
  onInputs,
}: {
  sceneId: string;
  projectId: string;
  onInputs: () => void;
}) {
  const d = useStore((s) => s.data),
    mutate = useStore((s) => s.mutate),
    modal = useActions();
  const s = d.scenes[sceneId];
  const jobs = Object.values(d.jobs).filter(
    (j) => j.sceneId === sceneId && !j.target,
  );
  return (
    <div className="scene-results">
      <div className="workflow-section-heading">
        <div>
          <span className="eyebrow">REVIEW THE MOMENT</span>
          <h2>Your scene, taking shape.</h2>
          <p>
            Compare results, approve each take, and send the scene to your
            episode edit.
          </p>
        </div>
        <Button onClick={onInputs}>
          <Sparkles size={14} />
          Generate / adjust inputs
        </Button>
      </div>
      {!s.shotIds.some(
        (id) =>
          d.shots[id].currentTakeId ||
          d.shots[id].imageTakeId ||
          d.shots[id].candidateTakeId,
      ) &&
        !jobs.some(active) && (
          <div className="workflow-empty">
            <ImageIcon size={32} />
            <h3>No results yet.</h3>
            <p>
              Approve the plan and choose references to generate your first
              take.
            </p>
            <Button variant="default" onClick={onInputs}>
              Choose references
            </Button>
          </div>
        )}
      {s.shotIds.map((id, i) => {
        const shot = d.shots[id],
          candidateId =
            shot.candidateTakeId ??
            (shot.imageTakeId && !d.takes[shot.imageTakeId]?.approved
              ? shot.imageTakeId
              : undefined);
        const candidate = candidateId ? d.takes[candidateId] : undefined,
          current = shot.currentTakeId
            ? d.takes[shot.currentTakeId]
            : undefined,
          j = jobs.filter((j) => j.shotId === id).at(-1);
        const history = Object.values(d.takes).filter((t) => t.shotId === id);
        return (
          <section className="scene-result-card" key={id}>
            <header>
              <span>{String(i + 1).padStart(2, "0")}</span>
              <div>
                <h3>{shot.title}</h3>
                <p>
                  {shot.targetFrames / 30}s ·{" "}
                  {shot.stale
                    ? "Inputs or plan changed · current footage preserved"
                    : candidate
                      ? "Candidate ready for review"
                      : current
                        ? "Approved for Edit"
                        : shot.imageTakeId &&
                            d.takes[shot.imageTakeId]?.approved
                          ? "Image approved · ready for video"
                          : "Awaiting generation"}
                </p>
              </div>
              {current && (
                <span className="status green">
                  <Check size={12} />
                  In Edit
                </span>
              )}
            </header>
            {j && active(j) && (
              <div className="result-job-progress">
                <span>
                  {j.state === "waiting"
                    ? "Waiting for source approval"
                    : j.state === "running"
                      ? "Generating demo result"
                      : "Queued"}
                </span>
                <progress value={j.progress ?? undefined} max={100} />
                <Button
                  size="sm"
                  onClick={() => mutate((d) => cancelJob(d, j.id))}
                >
                  Cancel job
                </Button>
              </div>
            )}
            {j && ["failed", "canceled"].includes(j.state) && (
              <div className="notice-inline amber">
                <p>{j.error ?? "This attempt was canceled."}</p>
                <Button
                  size="sm"
                  onClick={() =>
                    modal({
                      kind: "confirm",
                      title: `Retry · ${j.cost} demo credits?`,
                      description:
                        "The current scene plan and reference readiness will be checked before submitting a new attempt.",
                      action: (d) => retryJob(d, j.id),
                    })
                  }
                >
                  Retry
                </Button>
              </div>
            )}
            {(current || candidate) && (
              <div className="scene-result-comparison">
                {current && (
                  <figure>
                    <img
                      src={d.assets[current.assetId]?.url || undefined}
                      alt={`${shot.title} approved result`}
                    />
                    <figcaption>
                      Current approved take · kept in Edit
                    </figcaption>
                  </figure>
                )}
                {candidate && (
                  <figure>
                    <img
                      src={d.assets[candidate.assetId]?.url || undefined}
                      alt={`${shot.title} candidate`}
                    />
                    <figcaption>
                      {candidate.kind === "image"
                        ? "Reference image candidate"
                        : "Video candidate · still-image demo"}
                      {candidate.revision !== shot.revision
                        ? " · Previous inputs"
                        : ""}
                    </figcaption>
                  </figure>
                )}
              </div>
            )}
            {candidate && (
              <div className="scene-result-actions">
                <Button
                  onClick={() =>
                    mutate((d) => {
                      if (d.shots[id].candidateTakeId === candidate.id)
                        d.shots[id].candidateTakeId = undefined;
                      else if (d.shots[id].imageTakeId === candidate.id)
                        d.shots[id].imageTakeId = undefined;
                    }, true)
                  }
                >
                  {current ? "Keep current take" : "Reject candidate"}
                </Button>
                <Button
                  variant="default"
                  disabled={
                    candidate.revision !== shot.revision ||
                    !scenePlanApproved(d, sceneId)
                  }
                  onClick={() =>
                    mutate((d) => approveTake(d, id, candidate.id), true)
                  }
                >
                  <Check size={13} />
                  {candidate.kind === "image"
                    ? "Approve image"
                    : "Approve for Edit"}
                </Button>
              </div>
            )}
            {history.length > 0 && (
              <details className="workflow-history">
                <summary>Take history · {history.length}</summary>
                <div className="result-history-grid">
                  {history.map((t) => (
                    <div key={t.id}>
                      <img
                        src={d.assets[t.assetId]?.url || undefined}
                        alt="Saved take"
                      />
                      <span>
                        {t.kind} · revision {t.revision} ·{" "}
                        {t.approved ? "Approved" : "Unapproved"}
                      </span>
                      {t.approved &&
                        t.kind === "video" &&
                        t.revision === shot.revision &&
                        t.id !== shot.currentTakeId && (
                          <Button
                            size="sm"
                            onClick={() =>
                              mutate((d) => approveTake(d, id, t.id), true)
                            }
                          >
                            Use this take
                          </Button>
                        )}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </section>
        );
      })}
      <div className="scene-results-footer">
        <Button variant="default" asChild>
          <Link to={`/projects/${projectId}/episodes/${s.episodeId}?tab=edit`}>
            Go to episode Edit
            <Scissors size={14} />
          </Link>
        </Button>
      </div>
    </div>
  );
}
