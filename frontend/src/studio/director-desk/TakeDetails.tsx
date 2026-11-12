import { useStore } from "../../stores/store";
import type { Take } from "../../domain/types";
import { commit } from "../generation";
import { StatusBadge } from "../design/Primitives";
import { CountedField } from "./CountedField";
import { ControlGroup } from "./controls";

const checks = [
  [
    "identity",
    "Cast identity consistent",
    "Compare the character identity and look.",
  ],
  [
    "continuity",
    "Continuity preserved",
    "Check the location, props, and action.",
  ],
  [
    "camera",
    "Camera direction matches",
    "Check movement, framing, and timing.",
  ],
];
export function TakeDetails({
  shotId,
  take,
}: {
  shotId: string;
  take?: Take;
  onRevise?: () => void;
}) {
  const data = useStore((state) => state.data),
    shot = data.shots[shotId];
  const stale = !!take && take.revision !== shot.revision;
  const saveReview = (patch: Partial<NonNullable<Take["review"]>>) => {
    if (take)
      commit((d) => {
        d.takes[take.id].review = {
          note: "",
          checks: [],
          ...d.takes[take.id].review,
          ...patch,
        };
      }, "Review saved");
  };
  return (
    <>
      <h2>Take review</h2>
      <div className="dd-review-summary">
        <section className="dd-review-source">
          {take &&
            data.assets[take.assetId]?.url &&
            (data.assets[take.assetId].kind === "video" ? (
              <video
                src={data.assets[take.assetId].url}
                muted
                preload="metadata"
              />
            ) : (
              <img src={data.assets[take.assetId].url} alt="Selected take" />
            ))}
          <div>
            <b>
              {take
                ? `Take ${String(
                    Object.values(data.takes)
                      .filter(
                        (item) =>
                          item.shotId === shotId &&
                          item.kind === "video" &&
                          !shot.discardedTakeIds?.includes(item.id),
                      )
                      .sort((a, b) => a.createdAt - b.createdAt)
                      .findIndex((item) => item.id === take.id) + 1,
                  ).padStart(2, "0")}`
                : "No take selected"}
            </b>
            <StatusBadge
              tone={stale ? "neutral" : take?.approved ? "success" : "amber"}
            >
              {stale
                ? "Earlier direction"
                : take?.approved
                  ? "Approved"
                  : take
                    ? "Needs review"
                    : "Not generated"}
            </StatusBadge>
          </div>
        </section>
        <dl className="dd-take-details">
          <div>
            <dt>Duration</dt>
            <dd>{take ? take.sourceFrames / 30 : shot.targetFrames / 30}s</dd>
          </div>
          <div>
            <dt>Camera</dt>
            <dd>{take?.inputs?.camera?.movement ?? "—"}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>
              {take?.inputs?.startingFrameAssetId
                ? (data.assets[take.inputs.startingFrameAssetId]?.title ??
                  "Starting frame")
                : take?.sourceTakeId
                  ? "Previous take"
                  : "Direct generation"}
            </dd>
          </div>
          <div>
            <dt>Format</dt>
            <dd>{take?.inputs?.aspectRatio ?? "—"}</dd>
          </div>
          {!!take?.createdAt && (
            <div>
              <dt>Created</dt>
              <dd>
                {new Date(take.createdAt).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </dd>
            </div>
          )}
        </dl>
      </div>
      {stale && (
        <p role="status" className="dd-readiness">
          Direction changed after this take was generated. Generate a current
          take before approving.
        </p>
      )}
      <ControlGroup title="Continuity checklist">
        <p className="ds-muted ds-small-copy">
          Your review checks, recorded for this take.
        </p>
        {checks.map(([id, label, detail]) => (
          <label className="dd-review-check" key={id}>
            <input
              type="checkbox"
              disabled={!take}
              checked={take?.review?.checks.includes(id) ?? false}
              onChange={(e) =>
                saveReview({
                  checks: e.target.checked
                    ? [...(take?.review?.checks || []), id]
                    : (take?.review?.checks || []).filter(
                        (item) => item !== id,
                      ),
                })
              }
            />
            <span>
              {label}
              <small>{detail}</small>
            </span>
          </label>
        ))}
      </ControlGroup>
      <label className="ds-field">
        Reviewer note
        <CountedField
          key={take?.id ?? "empty"}
          label="Reviewer note"
          value={take?.review?.note || ""}
          multiline
          rows={4}
          disabled={!take}
          maxLength={2000}
          placeholder="What works? What needs another take?"
          onSave={(note) => saveReview({ note })}
        />
      </label>
    </>
  );
}
