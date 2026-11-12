import { useId, useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { updateScenePlan } from "../../domain/workflow";
import { usePendingEdits } from "../design/SavingState";
import { commit } from "../generation";

/** Shared pencil-activated title editing for the script and scene outline. */
export function SceneTitleHeading({
  sceneId,
  title,
  compact = false,
  onSelect,
}: {
  sceneId: string;
  title: string;
  compact?: boolean;
  onSelect?(): void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const finished = useRef(false);
  const pendingId = useId();
  const mark = usePendingEdits.getState().mark;
  useEffect(() => () => mark(pendingId, false), [pendingId, mark]);
  const finish = (save: boolean, restoreFocus = false) => {
    if (finished.current) return;
    finished.current = true;
    const next = draft?.trim();
    if (save && next && next !== title)
      commit(
        (data) => updateScenePlan(data, sceneId, { title: next }),
        "Scene renamed",
      );
    mark(pendingId, false);
    setDraft(null);
    if (restoreFocus) button.current?.focus();
  };
  return (
    <div
      className={`produce-scene-title-heading${compact ? " is-compact" : ""}`}
    >
      {draft === null ? (
        compact ? (
          <button className="produce-outline-title" onClick={onSelect}>
            {title}
          </button>
        ) : (
          <h2>{title}</h2>
        )
      ) : (
        <input
          autoFocus
          aria-label={compact ? `Scene title for ${title}` : "Scene title"}
          maxLength={120}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            mark(pendingId, event.target.value !== title);
          }}
          onBlur={() => finish(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === "Escape") {
              event.preventDefault();
              finish(event.key === "Enter", true);
            }
          }}
        />
      )}
      <button
        ref={button}
        className="ds-icon"
        aria-label={compact ? `Edit scene title ${title}` : "Edit scene title"}
        onClick={() => {
          finished.current = false;
          setDraft(title);
        }}
      >
        <Pencil size={compact ? 13 : 16} />
      </button>
    </div>
  );
}
