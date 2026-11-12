import { useState } from "react";
import { Check, X } from "lucide-react";
import type {
  SceneSuggestion,
  ShotSuggestion,
} from "../../domain/scene-assistance";

/** Editable local drafts. Only Confirm hands these back to the domain command. */
export function SuggestedShotPlan({
  proposal,
  onChange,
  existingCount,
  stale,
  onConfirm,
  onDiscard,
}: {
  proposal: SceneSuggestion;
  onChange(proposal: SceneSuggestion): void;
  existingCount: number;
  stale: boolean;
  onConfirm(proposal: SceneSuggestion): void;
  onDiscard(): void;
}) {
  const draft = proposal;
  const [selected, setSelected] = useState(0);
  const shot = draft.shots[selected];
  const update = (patch: Partial<ShotSuggestion>) =>
    onChange({
      ...draft,
      shots: draft.shots.map((item, index) =>
        index === selected ? { ...item, ...patch } : item,
      ),
    });
  const valid =
    draft.shots.length > 0 &&
    draft.shots.every(
      (item) =>
        item.title.trim() &&
        item.action.trim() &&
        Number.isFinite(item.seconds) &&
        item.seconds >= 1 &&
        item.seconds <= 30,
    );
  return (
    <section className="produce-shot-proposal" aria-label="Suggested shot plan">
      <header className="produce-proposal-heading">
        <div>
          <h3>{draft.shots.length} suggested shots</h3>
          <p>
            Draft preview · Edit the shots, then confirm to add them to this
            scene. Your {existingCount} existing shots will be kept.
          </p>
        </div>
        <div className="produce-actions">
          <button className="ds-button" onClick={onDiscard}>
            <X size={15} />
            Discard
          </button>
          <button
            className="ds-button ds-primary"
            disabled={stale || !valid}
            onClick={() => onConfirm(draft)}
          >
            <Check size={15} />
            Confirm shots
          </button>
        </div>
      </header>
      {stale && (
        <p role="alert">
          This scene changed after the suggestions were created. Discard these
          drafts and suggest shots again.
        </p>
      )}
      <div className="produce-coverage-body">
        <div className="produce-shot-list">
          {draft.shots.map((item, index) => (
            <div
              key={index}
              className={`produce-shot-row is-draft ${selected === index ? "is-selected" : ""}`}
            >
              <button
                aria-label={`Preview suggested shot ${index + 1}: ${item.title}`}
                aria-pressed={selected === index}
                onClick={() => setSelected(index)}
              >
                <span>
                  {String(existingCount + index + 1).padStart(2, "0")}
                </span>
                <span>
                  <b>{item.title}</b>
                  <small>{item.framing} · Draft</small>
                </span>
                <p>{item.action}</p>
                <time>~ {item.seconds}s</time>
              </button>
            </div>
          ))}
        </div>
        {shot && (
          <div
            className="produce-shot-details"
            aria-label="Suggested shot details"
          >
            <label>
              Shot title
              <input
                aria-label="Suggested shot title"
                value={shot.title}
                maxLength={120}
                onChange={(event) => update({ title: event.target.value })}
              />
            </label>
            <label>
              Action
              <textarea
                aria-label="Suggested shot action"
                rows={3}
                value={shot.action}
                maxLength={3000}
                onChange={(event) => update({ action: event.target.value })}
              />
            </label>
            <label>
              Framing
              <select
                aria-label="Suggested shot framing"
                value={shot.framing}
                onChange={(event) => update({ framing: event.target.value })}
              >
                {[
                  "Wide",
                  "Medium",
                  "Close-up",
                  "Extreme close-up",
                  "Over the shoulder",
                ].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              Estimated duration
              <input
                aria-label="Suggested shot duration"
                type="number"
                min={1}
                max={30}
                step={0.5}
                value={shot.seconds}
                onChange={(event) =>
                  update({
                    seconds:
                      event.target.value === ""
                        ? 0
                        : Number(event.target.value),
                  })
                }
              />
            </label>
          </div>
        )}
      </div>
      {!valid && (
        <p role="alert">
          Give each shot a title, an action, and a duration between 1 and 30
          seconds.
        </p>
      )}
    </section>
  );
}
