import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Info,
  LockKeyhole,
  RefreshCw,
} from "lucide-react";
import { useStore } from "../../stores/store";
import {
  applySceneSuggestion,
  proposeSceneAssistance,
} from "../../domain/scene-assistance";
import { commit } from "../generation";

export function AiScenePanel({
  sceneId,
  kind,
  onClose,
}: {
  sceneId: string;
  kind: "enhance" | "shots";
  onClose(): void;
}) {
  const data = useStore((state) => state.data);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
    if (window.innerWidth < 768)
      panel.current?.scrollIntoView({
        block: "start",
        behavior:
          useStore.getState().ui.reducedMotion ||
          window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
      });
  }, []);
  const variation = useRef(0);
  const [scope, setScope] = useState("Action and atmosphere");
  const [proposal, setProposal] = useState(() =>
    proposeSceneAssistance(data, sceneId),
  );
  const locked =
    kind === "enhance" &&
    data.scenes[sceneId].shotIds.some((id) => data.shots[id].locked);
  const changed =
    (data.scenes[sceneId].planRevision ?? 1) !== proposal.sourceRevision;
  const regenerate = (next = scope) => {
    variation.current++;
    setProposal(
      proposeSceneAssistance(
        useStore.getState().data,
        sceneId,
        next,
        variation.current,
      ),
    );
  };
  const excerpt =
    proposal.original
      .trim()
      .split(/\n\s*\n/)
      .at(-1) || proposal.original;
  const addition = proposal.revision
    .slice(proposal.original.length)
    .trim()
    .replace(/^VISUAL DIRECTION\n/, "");
  const continuity = data.studio.setups[sceneId]?.direction.notes.trim();
  return (
    <aside
      ref={panel}
      tabIndex={-1}
      className="dd-controls dd-ai-panel"
      aria-label={
        kind === "enhance"
          ? "Enhance prompt proposal"
          : "Suggested shots proposal"
      }
    >
      <header className="dd-inspector-heading">
        <h2>{kind === "enhance" ? "Enhance prompt" : "Suggest shots"}</h2>
        <button className="ds-text" onClick={onClose}>
          <ArrowLeft size={14} />
          Back to foundations
        </button>
      </header>
      <p className="ds-muted">
        {kind === "enhance"
          ? "Clarify the scene while keeping your intent."
          : "Preview additional coverage before adding it to your plan."}
      </p>
      {kind === "enhance" && (
        <label className="ds-field">
          Scope
          <select
            value={scope}
            onChange={(e) => {
              setScope(e.target.value);
              regenerate(e.target.value);
            }}
          >
            {[
              "Action and atmosphere",
              "Pacing and performance",
              "Visual clarity",
            ].map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
      )}
      <div className="dd-locked-facts">
        <span>
          <LockKeyhole size={14} />
          Dialogue preserved
        </span>
        <span>
          <LockKeyhole size={14} />
          {continuity || "Continuity preserved"}
        </span>
      </div>
      {kind === "enhance" ? (
        <>
          <section>
            <h3>Original</h3>
            <pre className="dd-original-excerpt">{excerpt}</pre>
            <details className="dd-proposal-source">
              <summary>View full scene</summary>
              <pre>{proposal.original}</pre>
            </details>
          </section>
          <section>
            <h3 className="ds-amber">Proposed revision</h3>
            <pre className="dd-proposal-copy">{addition}</pre>
            <small className="dd-proposal-caption">
              Adds visual direction to the original scene.
            </small>
          </section>
        </>
      ) : (
        <>
          <p className="ds-muted">
            Adds {proposal.shots.length} shots. Existing shots, locked shots,
            and approved takes remain in the plan.
          </p>
          {proposal.shots.map((shot, index) => (
            <article className="dd-proposed-shot" key={shot.title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <b>{shot.title}</b>
                <small>
                  {shot.framing} · {shot.seconds}s
                </small>
                <p>{shot.action}</p>
              </div>
            </article>
          ))}
        </>
      )}
      <p className="dd-ai-disclosure">
        <Info size={16} />
        Local demo suggestion. Cast, location, and story facts are preserved.
      </p>
      {locked && (
        <p className="dd-readiness">
          Unlock this scene’s shots before changing their source screenplay.
        </p>
      )}
      {changed && (
        <p role="alert" className="ds-error">
          The scene changed. Regenerate this proposal before applying.
        </p>
      )}
      <div className="dd-ai-actions">
        <small>Proposal only · no generation credits</small>
        <button
          className="ds-button ds-primary"
          disabled={changed || locked}
          onClick={() => {
            if (
              commit(
                (d) => applySceneSuggestion(d, proposal, kind),
                kind === "enhance"
                  ? "Enhancement applied · Undo to restore"
                  : "Suggested coverage added · Undo to restore",
              )
            )
              onClose();
          }}
        >
          {kind === "enhance" ? "Apply enhancement" : "Add suggested shots"}
          <ArrowRight size={16} />
        </button>
        <button className="ds-button" onClick={onClose}>
          Keep original
        </button>
        <button className="ds-text" onClick={() => regenerate()}>
          <RefreshCw size={15} />
          Regenerate
        </button>
      </div>
    </aside>
  );
}
