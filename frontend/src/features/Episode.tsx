import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  ChevronLeft,
  Clapperboard,
  Clock,
  FileText,
  Plus,
  Scissors,
  Sparkles,
} from "lucide-react";
import { useStore } from "../stores/store";
import { Button } from "../components/ui/button";
import { useActions } from "../components/Actions";
import { openDirector } from "../stores/director";
import { SortableList, SortableItem } from "../components/Sortable";
import { duration, shotsOfEpisode, shotsOfScene } from "../domain/selectors";
import { updateScript } from "../domain/commands";
import {
  approveScript,
  scriptApproved,
  scenePlanApproved,
  sceneWorkflowLabel,
  approveEpisodePlans,
  planScenes,
  draftScript,
  createPlannedScene,
  splitScene,
  mergeSceneWithNext,
} from "../domain/workflow";
import { EpisodeNavigation } from "./EpisodeNavigation";
import { NotFound } from "./Gallery";
import { Player } from "./Player";
export function EpisodePage() {
  const { projectId = "", episodeId = "" } = useParams();
  const d = useStore((s) => s.data),
    mutate = useStore((s) => s.mutate);
  const ep = d.episodes[episodeId];
  const [params, setParams] = useSearchParams(),
    [busy, setBusy] = useState<"script" | "scenes" | null>(null),
    [count, setCount] = useState(3),
    [scenePage, setScenePage] = useState(0);
  const modal = useActions();
  useEffect(() => {
    const showResults = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.episodeId === episodeId) setParams({ tab: "scenes" });
    };
    window.addEventListener("dotori-generation-results", showResults);
    return () =>
      window.removeEventListener("dotori-generation-results", showResults);
  }, [episodeId, setParams]);
  if (!ep || ep.projectId !== projectId) return <NotFound />;
  const requestedTab = (
    ["script", "scenes", "edit"].includes(params.get("tab") ?? "")
      ? params.get("tab")
      : "script"
  ) as "script" | "scenes" | "edit";
  const shots = shotsOfEpisode(d, episodeId),
    approved = scriptApproved(ep),
    approvedPlans = ep.sceneIds.filter((id) => scenePlanApproved(d, id)).length;
  const hasFootage = shots.some((shot) => {
    const take = shot.currentTakeId ? d.takes[shot.currentTakeId] : undefined;
    return take?.kind === "video" && take.approved;
  });
  const tab =
    requestedTab === "scenes" && !ep.sceneIds.length
      ? "script"
      : requestedTab === "edit" && !hasFootage
        ? ep.sceneIds.length
          ? "scenes"
          : "script"
        : requestedTab;
  const pageSize = 6;
  const pageCount = Math.max(1, Math.ceil(ep.sceneIds.length / pageSize));
  const page = Math.min(scenePage, pageCount - 1);
  const visibleSceneIds = ep.sceneIds.slice(
    page * pageSize,
    (page + 1) * pageSize,
  );
  const toTab = (tab: string) => setParams({ tab });
  const reorder = (ids: string[]) =>
    mutate((d) => {
      d.episodes[episodeId].sceneIds = ids;
      d.episodes[episodeId].timelineVersion++;
      d.projects[projectId].revision++;
    }, true);
  async function generate(kind: "script" | "scenes") {
    const revision = ep.scriptRevision ?? 1,
      setIds = JSON.stringify(ep.sceneIds);
    setBusy(kind);
    await new Promise((r) => setTimeout(r, 500));
    mutate((d) => {
      const current = d.episodes[episodeId];
      if (
        !current ||
        (current.scriptRevision ?? 1) !== revision ||
        JSON.stringify(current.sceneIds) !== setIds
      )
        throw Error(
          "The episode changed. Review it before generating another draft.",
        );
      if (kind === "script") updateScript(d, episodeId, draftScript(current));
      else {
        approveScript(d, episodeId);
        planScenes(d, episodeId, count);
      }
    }, true);
    setBusy(null);
    if (kind === "scenes") toTab("scenes");
  }
  const refreshPlans = () =>
    ep.sceneIds.length
      ? modal({
          kind: "confirm",
          title: "Refresh scene plans from the current script?",
          description:
            "Existing scene and shot IDs, references, takes, and timeline edits are kept. Updated plans will need your approval.",
          action: (d) => {
            approveScript(d, episodeId);
            planScenes(d, episodeId, ep.sceneIds.length);
            toTab("scenes");
          },
        })
      : void generate("scenes");
  return (
    <div className="episode-workspace">
      <header className="episode-header">
        <div className="eyebrow">
          EPISODE{" "}
          {String(
            d.projects[projectId].episodeIds.indexOf(episodeId) + 1,
          ).padStart(2, "0")}{" "}
          / YOUR STORY, ONE SCENE AT A TIME
        </div>
        <div className="page-heading">
          <div>
            <h1>{ep.title}</h1>
            <p>{ep.synopsis || "Start with an idea. Shape it into a film."}</p>
          </div>
          <span className="workflow-duration">
            <Clock size={13} />
            {ep.targetSeconds}s target
          </span>
        </div>
        <div className="workflow-progress">
          <span className={approved ? "complete" : ""}>
            <Check size={12} />
            Script {approved ? "approved" : "in development"}
          </span>
          <span>
            {approvedPlans}/{ep.sceneIds.length} scene plans approved
          </span>
          <span>
            {shots.filter((s) => s.currentTakeId && !s.stale).length}/
            {shots.length} shots ready to edit
          </span>
        </div>
      </header>
      <EpisodeNavigation
        projectId={projectId}
        episodeId={episodeId}
        active={tab}
      />
      {tab === "script" && (
        <div className="workflow-script">
          <div className="workflow-section-heading">
            <div>
              <span className="eyebrow">01 / DEVELOP THE STORY</span>
              <h2>Your screenplay</h2>
              <p>
                Write it yourself or start with a draft from your episode idea.
              </p>
            </div>
            <Button
              disabled={!!busy}
              onClick={() =>
                ep.script.trim()
                  ? openDirector(
                      "Help me draft a new version of this episode's script. Let's discuss the changes before replacing the current draft.",
                    )
                  : void generate("script")
              }
            >
              <Sparkles size={14} />
              {busy === "script"
                ? "Drafting…"
                : ep.script.trim()
                  ? "Draft new version"
                  : "Generate script"}
            </Button>
          </div>
          <div className="row-actions script-primary-actions">
            {!ep.sceneIds.length && (
              <label className="scene-count-select">
                Scenes
                <select
                  aria-label="Number of scenes"
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                >
                  {[1, 2, 3, 4, 5, 6]
                    .filter((n) => n * 3 <= ep.targetSeconds)
                    .map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                </select>
              </label>
            )}
            <Button
              variant="secondary"
              disabled={!!busy || !ep.script.trim()}
              onClick={refreshPlans}
            >
              <Clapperboard size={14} />
              {busy === "scenes"
                ? "Planning…"
                : ep.sceneIds.length
                  ? "Refresh scene plans"
                  : "Create scene plans"}
            </Button>
            <Button
              variant="default"
              disabled={!!busy || !ep.script.trim()}
              onClick={() =>
                modal({ kind: "video", episodeId, fromScript: true })
              }
            >
              <Sparkles size={14} />
              Generate episode
            </Button>
          </div>
          <div className="script-sheet">
            <div className="script-sheet-header">
              <FileText size={14} />
              <span>SCRIPT / VERSION {ep.scriptRevision ?? 1}</span>
              <span className={`status ${approved ? "green" : "amber"}`}>
                {approved ? "Approved" : "Draft for review"}
              </span>
            </div>
            <textarea
              className="screenplay"
              aria-label="Episode screenplay"
              placeholder="INT. A PLACE — DAY\n\nStart your story here…"
              key={ep.id + "-" + ep.scriptRevision}
              defaultValue={ep.script}
              maxLength={50000}
              disabled={!!busy}
              onBlur={(e) =>
                mutate((d) => updateScript(d, episodeId, e.target.value), true)
              }
            />
          </div>
          <div className="script-approval-bar">
            <div>
              <h3>
                {ep.sceneIds.length
                  ? "Keep your scene plans in sync."
                  : "Ready to shape the scenes?"}
              </h3>
              <p>
                Creating or refreshing plans uses this script as the approved
                version. Review each scene plan before generating.
              </p>
            </div>
          </div>
          <p className="workflow-demo-note">
            Drafting and planning use a local demonstration. Review and edit the
            writing before approving.
          </p>
          {!!ep.scriptHistory?.length && (
            <details className="workflow-history">
              <summary>
                Approved script versions · {ep.scriptHistory.length}
              </summary>
              {ep.scriptHistory.map((v, i) => (
                <details key={i}>
                  <summary>
                    Version {v.revision}
                    {v.revision === ep.scriptApprovedRevision
                      ? " · Last approved"
                      : ""}
                  </summary>
                  <pre>{v.script}</pre>
                </details>
              ))}
            </details>
          )}
        </div>
      )}
      {tab === "scenes" && (
        <div className="workflow-scenes">
          <div className="workflow-section-heading">
            <div>
              <span className="eyebrow">02 / SHAPE EACH MOMENT</span>
              <h2>Scene plans</h2>
              <p>
                Review the story beats and timing. Choose references after
                approving each plan.
              </p>
            </div>
            {ep.sceneIds.length > 0 && (
              <div className="scene-board-actions">
                <Button
                  disabled={!approved || approvedPlans === ep.sceneIds.length}
                  onClick={() =>
                    mutate((d) => approveEpisodePlans(d, episodeId), true)
                  }
                >
                  <Check size={14} />
                  Approve all plans
                </Button>
                <Button
                  disabled={!approved}
                  onClick={() =>
                    modal({
                      kind: "form",
                      title: "Add scene plan",
                      fields: [
                        { key: "title", label: "Scene title", value: "" },
                        {
                          key: "description",
                          label: "Detailed action",
                          value: "",
                        },
                        {
                          key: "seconds",
                          label: "Target seconds",
                          value: "15",
                          type: "number",
                          min: 3,
                          max: 90,
                        },
                      ],
                      submit: (v, d) => {
                        const n = Number(v.seconds);
                        if (!Number.isFinite(n) || n < 3 || n > 90)
                          throw Error("Use a 3–90 second duration.");
                        createPlannedScene(
                          d,
                          episodeId,
                          v.title,
                          v.description,
                          n,
                        );
                      },
                    })
                  }
                >
                  <Plus size={14} />
                  Add scene
                </Button>
                <Button
                  variant="ghost"
                  disabled={!ep.script.trim()}
                  onClick={refreshPlans}
                >
                  Refresh from script
                </Button>
                <Button
                  variant="default"
                  disabled={!ep.script.trim()}
                  onClick={() => modal({ kind: "video", episodeId })}
                >
                  <Sparkles size={14} />
                  Generate episode
                </Button>
              </div>
            )}
          </div>
          {!approved && (
            <div className="workflow-notice">
              <FileText size={18} />
              <div>
                <b>
                  {ep.scriptApprovedRevision
                    ? "The script changed. Review this version first."
                    : "Use your current script to refresh the plans."}
                </b>
                <p>Existing scenes and generated footage remain available.</p>
              </div>
              <Button asChild>
                <Link to={`?tab=script`}>
                  Review script
                  <ChevronRight size={13} />
                </Link>
              </Button>
            </div>
          )}
          {!ep.sceneIds.length ? (
            <div className="workflow-empty">
              <Clapperboard size={34} />
              <h2>A scene is a moment worth shaping.</h2>
              <p>
                Turn your approved screenplay into scene plans with detailed
                action, dialogue, and duration.
              </p>
              <label>
                Number of scenes
                <select
                  aria-label="Number of scenes"
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                >
                  {[1, 2, 3, 4, 5, 6]
                    .filter((n) => n * 3 <= ep.targetSeconds)
                    .map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                </select>
              </label>
              <Button
                variant="default"
                disabled={!approved || !!busy}
                onClick={() => void generate("scenes")}
              >
                <Sparkles size={14} />
                {busy === "scenes" ? "Planning scenes…" : "Create scene plans"}
              </Button>
            </div>
          ) : (
            <>
              <div className="scene-plan-list">
                <SortableList
                  ids={visibleSceneIds}
                  onReorder={(ids) => {
                    const order = [...ep.sceneIds];
                    order.splice(
                      page * pageSize,
                      visibleSceneIds.length,
                      ...ids,
                    );
                    reorder(order);
                  }}
                >
                  {visibleSceneIds.map((sid, localIndex) => {
                    const i = page * pageSize + localIndex;
                    const s = d.scenes[sid],
                      ss = shotsOfScene(d, sid),
                      ready = scenePlanApproved(d, sid),
                      status = sceneWorkflowLabel(d, sid);
                    return (
                      <SortableItem
                        id={sid}
                        key={sid}
                        className="scene-plan-card"
                      >
                        <span className="scene-plan-number">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <div className="scene-plan-card-copy">
                          {ss.some(
                            (shot) =>
                              shot.currentTakeId ||
                              shot.candidateTakeId ||
                              shot.imageTakeId,
                          ) && (
                            <div
                              className="scene-generated-shots"
                              aria-label={`${s.title} generated shots`}
                            >
                              {ss.map((shot, index) => {
                                const takeId =
                                  shot.currentTakeId ||
                                  shot.candidateTakeId ||
                                  shot.imageTakeId;
                                const take = takeId
                                  ? d.takes[takeId]
                                  : undefined;
                                const asset = take
                                  ? d.assets[take.assetId]
                                  : undefined;
                                if (!asset?.url || asset.missing) return null;
                                return (
                                  <figure key={shot.id}>
                                    {asset.kind === "video" ? (
                                      <video
                                        src={asset.url}
                                        controls
                                        preload="metadata"
                                        playsInline
                                        aria-label={`${shot.title} generated video`}
                                      />
                                    ) : (
                                      <img
                                        src={asset.url}
                                        alt={`${shot.title} generated shot`}
                                        loading="lazy"
                                      />
                                    )}
                                    <figcaption>
                                      Shot {index + 1} ·{" "}
                                      {take?.approved && take.kind === "video"
                                        ? shot.stale
                                          ? "Needs review"
                                          : "Ready to edit"
                                        : "Review result"}
                                    </figcaption>
                                  </figure>
                                );
                              })}
                            </div>
                          )}
                          <div className="scene-plan-status">
                            <span
                              className={`status ${ready ? "green" : "amber"}`}
                            >
                              {status}
                            </span>
                            <span className="muted">
                              {d.studio.setups[sid]?.targetSeconds ??
                                ss.reduce((n, s) => n + s.targetFrames / 30, 0)}
                              s · {ss.length} shots
                            </span>
                          </div>
                          <Link
                            to={`/projects/${projectId}/episodes/${episodeId}/scenes/${sid}`}
                          >
                            <h3>
                              {s.title}
                              <ChevronRight size={15} />
                            </h3>
                          </Link>
                          <p>{s.description}</p>
                          <small>
                            {s.settingDescription ||
                              "Setting to be chosen during reference selection"}
                          </small>
                          <div className="scene-plan-card-footer">
                            <span>
                              {ready ? (
                                <>
                                  <Check size={11} />
                                  Plan approved
                                </>
                              ) : s.sourceScriptRevision !==
                                (ep.scriptRevision ?? 1) ? (
                                "Updated script · plan needs review"
                              ) : (
                                "Draft plan · your approval needed"
                              )}
                            </span>
                            <Link
                              to={`/projects/${projectId}/episodes/${episodeId}/scenes/${sid}`}
                              className="button small"
                            >
                              {ready ? "Open scene" : "Review plan"}
                              <ChevronRight size={12} />
                            </Link>
                          </div>
                        </div>
                        <div className="scene-plan-controls">
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={i === 0}
                            aria-label={`Move ${s.title} up`}
                            onClick={() => {
                              const order = [...ep.sceneIds];
                              [order[i - 1], order[i]] = [
                                order[i],
                                order[i - 1],
                              ];
                              reorder(order);
                            }}
                          >
                            <ArrowUp size={13} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={i === ep.sceneIds.length - 1}
                            aria-label={`Move ${s.title} down`}
                            onClick={() => {
                              const order = [...ep.sceneIds];
                              [order[i + 1], order[i]] = [
                                order[i],
                                order[i + 1],
                              ];
                              reorder(order);
                            }}
                          >
                            <ArrowDown size={13} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={s.shotIds.length < 2}
                            onClick={() =>
                              modal({
                                kind: "confirm",
                                title: "Split this scene?",
                                description:
                                  "The latter shots become a new scene. Existing footage is kept and both plans need review.",
                                action: (d) => {
                                  splitScene(d, sid);
                                },
                              })
                            }
                          >
                            Split
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={i === ep.sceneIds.length - 1}
                            onClick={() =>
                              modal({
                                kind: "confirm",
                                title: "Merge with the next scene?",
                                description:
                                  "Combine the plans and preserve their shots and reference inputs. The combined plan needs approval.",
                                action: (d) => mergeSceneWithNext(d, sid),
                              })
                            }
                          >
                            Merge
                          </Button>
                        </div>
                      </SortableItem>
                    );
                  })}
                </SortableList>
              </div>
              <nav className="scene-pagination" aria-label="Scene pages">
                <span>
                  {ep.sceneIds.length} scenes · Page {page + 1} of {pageCount}
                </span>
                <div className="row-actions">
                  <Button
                    size="icon"
                    aria-label="Previous scene page"
                    disabled={page === 0}
                    onClick={() => setScenePage(page - 1)}
                  >
                    <ChevronLeft size={16} />
                  </Button>
                  <Button
                    size="icon"
                    aria-label="Next scene page"
                    disabled={page === pageCount - 1}
                    onClick={() => setScenePage(page + 1)}
                  >
                    <ChevronRight size={16} />
                  </Button>
                </div>
              </nav>
            </>
          )}
        </div>
      )}
      {tab === "edit" && (
        <div className="workflow-edit">
          <div className="workflow-section-heading">
            <div>
              <span className="eyebrow">03 / BRING IT TOGETHER</span>
              <h2>Your episode edit</h2>
              <p>Arrange and refine the results you’ve approved.</p>
            </div>
            <span className="muted">
              {Number(duration(shots).toFixed(2))}s timeline
            </span>
          </div>
          {shots.some((s) => s.currentTakeId) ? (
            <>
              <Player shotIds={shots.map((s) => s.id)} />
              <div className="episode-edit-scenes">
                <SortableList ids={ep.sceneIds} onReorder={reorder}>
                  {ep.sceneIds.map((sid, i) => {
                    const s = d.scenes[sid],
                      has = s.shotIds.some((id) => d.shots[id].currentTakeId);
                    return (
                      <SortableItem
                        key={sid}
                        id={sid}
                        className="episode-edit-scene"
                      >
                        <span>{String(i + 1).padStart(2, "0")}</span>
                        <img src={s.cover} alt="" />
                        <div>
                          <h3>{s.title}</h3>
                          <p>
                            {has
                              ? "Approved footage available"
                              : "Awaiting approved results"}{" "}
                            ·{" "}
                            {Number(duration(shotsOfScene(d, sid)).toFixed(2))}s
                          </p>
                        </div>
                        <Button asChild>
                          <Link
                            to={`/projects/${projectId}/episodes/${episodeId}/scenes/${sid}${has ? "/edit" : "?step=results"}`}
                          >
                            {has ? (
                              <>
                                <Scissors size={13} />
                                Edit scene
                              </>
                            ) : (
                              <>
                                Review scene
                                <ChevronRight size={12} />
                              </>
                            )}
                          </Link>
                        </Button>
                      </SortableItem>
                    );
                  })}
                </SortableList>
              </div>
            </>
          ) : (
            <div className="workflow-empty">
              <Scissors size={34} />
              <h2>Your edit starts with an approved result.</h2>
              <p>
                Plan a scene, choose its references, then generate and approve a
                take. It will appear here.
              </p>
              <Button asChild variant="default">
                <Link to="?tab=scenes">
                  Go to scenes
                  <ChevronRight size={13} />
                </Link>
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
