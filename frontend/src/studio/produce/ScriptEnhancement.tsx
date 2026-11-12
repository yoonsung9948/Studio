import { useState } from "react";
import { Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../../components/ui/dialog";
import { useStore } from "../../stores/store";
import {
  proposeSceneAssistance,
  applySceneSuggestion,
} from "../../domain/scene-assistance";
import { commit } from "../generation";

export function ScriptEnhancement({
  sceneId,
  onClose,
}: {
  sceneId: string;
  onClose(): void;
}) {
  const data = useStore((state) => state.data);
  const [scope, setScope] = useState("Action and atmosphere");
  const [proposal, setProposal] = useState(() =>
    proposeSceneAssistance(useStore.getState().data, sceneId),
  );
  const scene = data.scenes[sceneId];
  const stale =
    !scene ||
    scene.archived ||
    (scene.planRevision ?? 1) !== proposal.sourceRevision;
  const locked = scene?.shotIds.some((id) => data.shots[id]?.locked);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="st-dialog produce-script-enhancement">
        <DialogTitle>Enhance script</DialogTitle>
        <DialogDescription>
          Review and edit the suggested direction before applying it. Your
          original script stays unchanged until you apply.
        </DialogDescription>
        <label>
          Focus
          <select
            aria-label="Enhancement focus"
            value={scope}
            onChange={(event) => {
              const next = event.target.value;
              setScope(next);
              setProposal(
                proposeSceneAssistance(useStore.getState().data, sceneId, next),
              );
            }}
          >
            {[
              "Action and atmosphere",
              "Pacing and performance",
              "Visual clarity",
            ].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <details>
          <summary>Original script</summary>
          <pre>{proposal.original}</pre>
        </details>
        <label>
          Suggested script
          <textarea
            aria-label="Enhanced script"
            rows={12}
            maxLength={10000}
            value={proposal.revision}
            onChange={(event) =>
              setProposal((current) => ({
                ...current,
                revision: event.target.value,
              }))
            }
          />
        </label>
        {stale && (
          <p role="alert">
            The scene changed. Close this preview and enhance the current script
            again.
          </p>
        )}
        {locked && (
          <p role="alert">
            Unlock this scene’s shots before changing their source script.
          </p>
        )}
        <footer className="produce-actions">
          <button className="ds-button" onClick={onClose}>
            Discard
          </button>
          <button
            className="ds-button ds-primary"
            disabled={stale || locked || !proposal.revision.trim()}
            onClick={() => {
              if (
                commit(
                  (d) => applySceneSuggestion(d, proposal, "enhance"),
                  "Script enhanced",
                )
              )
                onClose();
            }}
          >
            <Sparkles size={15} />
            Apply enhancement
          </button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
