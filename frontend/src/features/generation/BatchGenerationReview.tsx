import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronRight, Sparkles, AlertCircle } from "lucide-react";
import { DialogTitle, DialogDescription } from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
import { useStore } from "../../stores/store";
import { scenePreflight } from "../../domain/scene-preflight";
import { preflight } from "../../domain/selectors";
import { enqueueGeneration } from "../../domain/commands";
export function BatchGenerationReview({
  ids,
  replacement = false,
  proposalId,
  close,
}: {
  ids: string[];
  replacement?: boolean;
  proposalId?: string;
  close: () => void;
}) {
  const d = useStore((s) => s.data),
    mutate = useStore((s) => s.mutate),
    navigate = useNavigate();
  const [error, setError] = useState("");
  const sids = [
    ...new Set(ids.flatMap((id) => (d.shots[id] ? [d.shots[id].sceneId] : []))),
  ];
  const plans = sids.map((id) => ({
    id,
    plan: scenePreflight(d, id, undefined, undefined, ids),
  }));
  const eligible = ids.filter((id) =>
      plans.some((p) => p.id === d.shots[id]?.sceneId && p.plan.ready),
    ),
    work = preflight(d, eligible, replacement),
    cost = work.reduce((n, w) => n + w.cost, 0);
  return (
    <>
      <DialogTitle>Generate ready scenes</DialogTitle>
      <DialogDescription>
        Each scene uses its approved plan and saved reference inputs. Scenes
        needing attention are excluded.
      </DialogDescription>
      <div className="batch-scene-list">
        {plans.map(({ id, plan }) => {
          const sc = d.scenes[id];
          return (
            <article key={id}>
              <div>
                {plan.ready ? <Check size={16} /> : <AlertCircle size={16} />}
                <h3>{sc.title}</h3>
                <span className={`status ${plan.ready ? "green" : "amber"}`}>
                  {plan.ready ? "Ready" : "Excluded"}
                </span>
              </div>
              {plan.issues
                .filter((i) => i.level === "blocker")
                .map((i) => (
                  <p key={i.id}>{i.message}</p>
                ))}
              <Button
                size="sm"
                onClick={() => {
                  close();
                  navigate(
                    `/projects/${d.episodes[sc.episodeId].projectId}/episodes/${sc.episodeId}/scenes/${id}?step=${plan.issues.some((i) => i.group === "Plan") ? "plan" : "references"}`,
                  );
                }}
              >
                Review scene inputs
                <ChevronRight size={12} />
              </Button>
            </article>
          );
        })}
      </div>
      <div className="cost-line">
        <span>
          {work.length} jobs · {plans.filter((p) => p.plan.ready).length} ready
          scenes
        </span>
        <b>{cost} demo credits</b>
      </div>
      <p className="muted">
        {d.credits} available · existing approved takes stay until replacements
        are approved.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="dialog-footer">
        <Button onClick={close}>Cancel</Button>
        <Button
          variant="default"
          disabled={!work.length || cost > d.credits}
          onClick={() => {
            if (
              mutate((d) => {
                if (proposalId) {
                  const p = d.proposals[proposalId];
                  if (
                    p.state !== "proposed" ||
                    d.projects[p.scope.projectId].revision !== p.scope.revision
                  )
                    throw Error(
                      "The proposal changed. Request a current plan.",
                    );
                  p.state = "applied";
                }
                enqueueGeneration(d, eligible, replacement);
              })
            )
              close();
            else setError(useStore.getState().notice);
          }}
        >
          <Sparkles size={14} />
          Generate {work.length} {work.length === 1 ? "shot" : "shots"} · {cost}{" "}
          cr
        </Button>
      </div>
    </>
  );
}
