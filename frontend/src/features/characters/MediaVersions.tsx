import { useState } from "react";
import { Check, Expand, ImageIcon, RefreshCw } from "lucide-react";
import { useStore } from "../../stores/store";
import { Button } from "../../components/ui/button";
import { useActions } from "../../components/Actions";
import { approveVersion, rejectVersion } from "../../domain/studio-commands";
import {
  versionsFor,
  versionAsset,
  jobActive,
} from "../../domain/studio-selectors";
import type { StudioOperation } from "../../domain/types";
export function Portrait({
  src,
  label,
  landscape = false,
}: {
  src?: string;
  label: string;
  landscape?: boolean;
}) {
  return (
    <div className={`studio-portrait ${landscape ? "landscape" : ""}`}>
      {src ? (
        <img src={src} alt={label} />
      ) : (
        <div className="portrait-empty">
          <ImageIcon size={32} />
          <span>{label}</span>
          <small>Describe it. Then make it yours.</small>
        </div>
      )}
      <span className="fixture-label">DEMO PLACEHOLDER</span>
    </div>
  );
}
export function GenerationActivity({
  kind,
  id,
}: {
  kind: StudioOperation;
  id: string;
}) {
  const jobs = useStore((s) => s.data.jobs);
  const j = Object.values(jobs)
    .filter((j) => j.target?.kind === kind && j.target.id === id)
    .at(-1);
  const modal = useActions();
  if (!j) return null;
  if (jobActive(j))
    return (
      <div className="studio-progress" role="status">
        <span>
          {j.state === "running" ? "Creating demo candidates" : "Queued"} ·
          simulated
        </span>
        <progress max={100} value={j.progress ?? undefined} />
      </div>
    );
  if (j.state === "failed")
    return (
      <div className="notice-inline amber">
        <span>{j.error}</span>
        <Button
          size="sm"
          onClick={() =>
            modal({ kind: "studioGenerate", operation: kind, ids: [id] })
          }
        >
          Retry
        </Button>
      </div>
    );
  return null;
}
export function MediaVersions({
  kind,
  id,
  currentId,
  onApproved,
}: {
  kind: StudioOperation;
  id: string;
  currentId?: string;
  onApproved?: () => void;
}) {
  const d = useStore((s) => s.data),
    mutate = useStore((s) => s.mutate);
  const modal = useActions();
  const [selected, setSelected] = useState<string>();
  const versions = versionsFor(d, kind, id);
  const pending = versions.filter((v) => v.approval === "needs_review");
  const selectedId = pending.some((v) => v.id === selected)
    ? selected
    : pending[0]?.id;
  const current = versionAsset(d, currentId);
  const history = versions.filter((v) => v.approval !== "needs_review");
  return (
    <>
      <GenerationActivity kind={kind} id={id} />
      {pending.length > 0 && (
        <section className="candidate-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">REVIEW CANDIDATES</span>
              <h3>
                {kind === "identity"
                  ? "Choose their appearance"
                  : "A new version to consider"}
              </h3>
            </div>
            <span className="badge">Approval required</span>
          </div>
          {current && (
            <div className="current-version">
              <img src={current.url} alt="Current approved version" />
              <div>
                <b>Current approved {kind}</b>
                <p>Stays active until you approve a replacement.</p>
              </div>
              <Check size={16} />
            </div>
          )}
          <div
            className="candidate-grid"
            role="radiogroup"
            aria-label="Select one candidate"
          >
            {pending.map((v, i) => (
              <div
                key={v.id}
                className={`candidate ${selectedId === v.id ? "selected" : ""}`}
              >
                <button
                  role="radio"
                  aria-checked={selectedId === v.id}
                  aria-label={`Select candidate ${i + 1}`}
                  onClick={() => setSelected(v.id)}
                >
                  <Portrait
                    src={d.assets[v.assetId]?.url}
                    label={`Candidate ${i + 1}`}
                  />
                  <span>
                    Candidate {i + 1}
                    <small>
                      v{v.revision} {selectedId === v.id ? "· Selected" : ""}
                    </small>
                  </span>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`View candidate ${i + 1} fullscreen`}
                  onClick={() => modal({ kind: "asset", assetId: v.assetId })}
                >
                  <Expand size={13} />
                </Button>
              </div>
            ))}
          </div>
          {kind === "identity" && current && (
            <p className="notice-inline amber">
              Approving a different identity preserves the previous portrait and
              marks dependent Looks, references, and shots for review.
            </p>
          )}
          <div className="row-actions candidate-actions">
            <Button
              onClick={() =>
                mutate((d) => {
                  for (const v of pending) rejectVersion(d, v.id);
                })
              }
            >
              {current ? "Keep original" : "Reject candidates"}
            </Button>
            <Button
              variant="default"
              disabled={!selectedId}
              onClick={() => {
                if (
                  selectedId &&
                  mutate((d) => approveVersion(d, selectedId), true)
                )
                  onApproved?.();
              }}
            >
              <Check size={14} />
              {current ? "Approve replacement" : "Approve selected"}
            </Button>
          </div>
        </section>
      )}
      {history.length > 0 && (
        <details className="version-history">
          <summary>
            Version history · {history.length}{" "}
            {currentId ? "· approved media preserved" : ""}
          </summary>
          {history.map((v) => (
            <div className="history-row" key={v.id}>
              <img src={d.assets[v.assetId]?.url} alt="Previous version" />
              <span>
                Specification v{v.revision}
                <small>
                  {v.approval}
                  {currentId === v.id ? " · Current" : ""}
                </small>
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => modal({ kind: "asset", assetId: v.assetId })}
              >
                View
              </Button>
              {v.approval === "approved" && v.id !== currentId && (
                <Button
                  size="sm"
                  onClick={() => mutate((d) => approveVersion(d, v.id), true)}
                >
                  <RefreshCw size={12} />
                  Restore
                </Button>
              )}
            </div>
          ))}
        </details>
      )}
    </>
  );
}
