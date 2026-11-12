import {
  enqueueStudio,
  studioCost,
  targetInfo,
} from "../domain/studio-commands";
import { generationInputs } from "../domain/generation-inputs";
import { targetBusy } from "../domain/studio-selectors";
import { GenerationDialog } from "../features/generation/GenerationDialog";
import { prepareVideoGeneration } from "../domain/video-workflow";
import { BatchGenerationReview } from "../features/generation/BatchGenerationReview";
import { useNavigate } from "react-router-dom";
import type { StudioOperation } from "../domain/types";
import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { AlertTriangle, Check, Download } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { currentWorkspaceEpoch, useStore } from "../stores/store";
import { exportWarnings, shotsOfEpisode } from "../domain/selectors";
import { approveTake } from "../domain/commands";
import { exportService, downloadManifest } from "../services/mock";
import type { Data } from "../domain/types";
import { Player } from "../features/Player";
export type Modal =
  | {
      kind: "video";
      episodeId: string;
      sceneId?: string;
      ids?: string[];
      fromScript?: boolean;
    }
  | { kind: "studioGenerate"; operation: StudioOperation; ids: string[] }
  | { kind: "asset"; assetId: string }
  | {
      kind: "confirm";
      title: string;
      description: string;
      action: (d: Data) => void;
      danger?: boolean;
    }
  | {
      kind: "form";
      title: string;
      fields: {
        key: string;
        label: string;
        value: string;
        type?: string;
        min?: number;
        max?: number;
      }[];
      submit: (values: Record<string, string>, d: Data) => void;
    }
  | {
      kind: "generate";
      ids: string[];
      replacement?: boolean;
      proposalId?: string;
    }
  | { kind: "review"; ids: string[] }
  | { kind: "preview"; ids: string[]; title: string }
  | { kind: "export"; episodeId: string }
  | null;
const Context = createContext<(m: Modal) => void>(() => {});
export const useActions = () => useContext(Context);
export function ActionsProvider({ children }: { children: ReactNode }) {
  const [modal, setModal] = useState<Modal>(null);
  const navigate = useNavigate();
  const open = useCallback(
    (m: Modal) => {
      if (m?.kind === "video") {
        const ok = useStore.getState().mutate((d) => {
          prepareVideoGeneration(d, m.episodeId, m.sceneId, m.fromScript);
        }, true);
        if (!ok) return;
      }
      if (m?.kind === "generate") {
        const d = useStore.getState().data,
          sids = [
            ...new Set(
              m.ids.flatMap((id) => (d.shots[id] ? [d.shots[id].sceneId] : [])),
            ),
          ];
        if (sids.length === 1) {
          const s = d.scenes[sids[0]],
            ep = d.episodes[s.episodeId],
            params = new URLSearchParams({ step: "references" });
          if (m.ids.length === 1) params.set("shot", m.ids[0]);
          if (m.replacement) params.set("replace", "1");
          if (m.proposalId) params.set("proposal", m.proposalId);
          setModal(null);
          navigate(
            `/projects/${ep.projectId}/episodes/${ep.id}/scenes/${s.id}?${params}`,
          );
          return;
        }
      }
      setModal(m);
    },
    [navigate],
  );
  return (
    <Context.Provider value={open}>
      {children}
      <Dialog
        open={!!modal}
        onOpenChange={(v) => {
          if (!v) setModal(null);
        }}
      >
        {modal && (
          <DialogContent
            key={JSON.stringify(modal)}
            className={
              modal.kind === "video"
                ? "video-generation-dialog"
                : modal.kind === "preview"
                  ? "preview-dialog"
                  : modal.kind === "generate"
                    ? "batch-generation-dialog"
                    : ""
            }
          >
            <ModalBody modal={modal} close={() => setModal(null)} />
          </DialogContent>
        )}
      </Dialog>
    </Context.Provider>
  );
}
function ModalBody({
  modal: m,
  close,
}: {
  modal: NonNullable<Modal>;
  close: () => void;
}) {
  const d = useStore((s) => s.data),
    mutate = useStore((s) => s.mutate);
  const [values, setValues] = useState<Record<string, string>>(
    m.kind === "form"
      ? Object.fromEntries(m.fields.map((f) => [f.key, f.value]))
      : {},
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(false);
  const [preset, setPreset] = useState("Instagram Reels");
  const [captions, setCaptions] = useState(true);
  const [title, setTitle] = useState(
    m.kind === "export" ? d.episodes[m.episodeId].title : "",
  );
  const [description, setDescription] = useState("");
  const commit = (fn: (d: Data) => void, undo = false) => {
    if (mutate(fn, undo)) close();
    else setError(useStore.getState().notice);
  };
  if (m.kind === "video") {
    const ep = d.episodes[m.episodeId];
    if (!ep) return <DialogTitle>Episode unavailable</DialogTitle>;
    const ids =
      m.ids ??
      (m.sceneId
        ? (d.scenes[m.sceneId]?.shotIds ?? [])
        : shotsOfEpisode(d, ep.id).map((s) => s.id));
    return (
      <GenerationDialog
        ids={ids}
        videoMode
        fromScript={m.fromScript}
        close={close}
        onGenerated={() => {
          window.dispatchEvent(
            new CustomEvent("dotori-generation-results", {
              detail: { episodeId: ep.id, sceneId: m.sceneId },
            }),
          );
        }}
      />
    );
  }
  if (m.kind === "asset") {
    const a = d.assets[m.assetId];
    return (
      <>
        <DialogTitle>{a?.title ?? "Image unavailable"}</DialogTitle>
        <DialogDescription>
          {a?.provenance ?? "This asset is missing."}
        </DialogDescription>
        {a?.url ? (
          <img className="asset-dialog-image" src={a.url} alt={a.title} />
        ) : (
          <p>Reattach this image in Assets.</p>
        )}
      </>
    );
  }
  if (m.kind === "studioGenerate") {
    const ids = m.ids.filter((id) => !targetBusy(d, m.operation, id));
    const cost = ids.length * studioCost(m.operation);
    return (
      <>
        <DialogTitle>Generation confirmation</DialogTitle>
        <DialogDescription>
          Simulated image work · no real AI calls. Existing approved images stay
          active.
        </DialogDescription>
        <div className="preflight-group">
          {ids.map((id) => (
            <div className="preflight-row" key={id}>
              <span>
                {targetInfo(d, m.operation, id).name}
                <small>
                  {m.operation === "identity"
                    ? "Three portrait candidates"
                    : "One candidate image"}
                  {["look", "reference"].includes(m.operation)
                    ? " · anchored to the approved identity"
                    : ""}
                </small>
              </span>
              <span>{studioCost(m.operation)} cr</span>
            </div>
          ))}
        </div>
        {!ids.length && (
          <p className="notice-inline">
            These jobs are already active. Open Activity to follow their
            progress.
          </p>
        )}
        <div className="cost-line">
          <span>Estimated demo credits</span>
          <b>
            {cost} / {d.credits} available
          </b>
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="dialog-footer">
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="default"
            disabled={!ids.length || cost > d.credits}
            onClick={() =>
              commit((d) => {
                enqueueStudio(d, m.operation, ids);
              })
            }
          >
            Confirm · {cost} demo credits
          </Button>
        </div>
      </>
    );
  }
  if (m.kind === "confirm")
    return (
      <>
        <DialogTitle>{m.title}</DialogTitle>
        <DialogDescription>{m.description}</DialogDescription>
        <div className="dialog-footer">
          <Button onClick={close}>Cancel</Button>
          <Button
            variant={m.danger ? "destructive" : "default"}
            onClick={() => commit(m.action)}
          >
            Confirm
          </Button>
        </div>
      </>
    );
  if (m.kind === "form")
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          commit((d) => m.submit(values, d));
        }}
      >
        <DialogTitle>{m.title}</DialogTitle>
        <DialogDescription>
          Changes are saved locally on this device.
        </DialogDescription>
        <div className="form-fields">
          {m.fields.map((f) => (
            <label key={f.key}>
              {f.label}
              <input
                autoFocus={f === m.fields[0]}
                required={f.key === "title" || f.key === "name"}
                type={f.type ?? "text"}
                min={f.min}
                max={f.max}
                value={values[f.key]}
                onChange={(e) =>
                  setValues({ ...values, [f.key]: e.target.value })
                }
              />
            </label>
          ))}
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="dialog-footer">
          <Button type="button" onClick={close}>
            Cancel
          </Button>
          <Button variant="default">Save</Button>
        </div>
      </form>
    );
  if (m.kind === "generate")
    return (
      <BatchGenerationReview
        ids={m.ids}
        replacement={m.replacement}
        proposalId={m.proposalId}
        close={close}
      />
    );
  if (m.kind === "review") {
    const shots = m.ids.map((id) => d.shots[id]).filter(Boolean);
    const reviewable = shots.filter(
      (s) =>
        s.candidateTakeId ||
        (s.imageTakeId &&
          (!d.takes[s.imageTakeId]?.approved ||
            d.takes[s.imageTakeId].revision !== s.revision)),
    );
    return (
      <>
        <DialogTitle>Review candidates</DialogTitle>
        <DialogDescription>
          Compare storyboard fixtures. No real footage has been generated.
        </DialogDescription>
        <div className="review-list">
          {reviewable.map((s) => {
            const tid = s.candidateTakeId ?? s.imageTakeId!;
            const t = d.takes[tid];
            return (
              <div key={s.id}>
                <h3>
                  {s.title} <small>Revision {t.revision}</small>
                </h3>
                <div className="compare">
                  {s.currentTakeId && (
                    <figure>
                      <img
                        src={d.assets[d.takes[s.currentTakeId].assetId].url}
                        alt="Original storyboard take"
                      />
                      <figcaption>Original · stays on timeline</figcaption>
                    </figure>
                  )}
                  <figure>
                    <img
                      src={d.assets[t.assetId].url}
                      alt="Candidate storyboard take"
                    />
                    <figcaption>Candidate · {t.kind} demo</figcaption>
                  </figure>
                </div>
                <div className="row-actions">
                  <Button
                    onClick={() =>
                      mutate((d) => {
                        const shot = d.shots[s.id];
                        if (shot.candidateTakeId)
                          shot.candidateTakeId = undefined;
                        else shot.imageTakeId = undefined;
                      })
                    }
                  >
                    {s.currentTakeId ? "Keep original" : "Reject candidate"}
                  </Button>
                  <Button
                    variant="default"
                    onClick={() => {
                      if (!mutate((d) => approveTake(d, s.id, tid), true))
                        setError(useStore.getState().notice);
                    }}
                  >
                    <Check size={14} />
                    {t.kind === "image"
                      ? "Approve images"
                      : "Approve and replace"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
        {!reviewable.length && (
          <p className="empty">All available candidates have been reviewed.</p>
        )}
        {error && <p className="error">{error}</p>}
        <div className="dialog-footer">
          <Button onClick={close}>Done</Button>
        </div>
      </>
    );
  }
  if (m.kind === "preview")
    return (
      <>
        <DialogTitle>{m.title}</DialogTitle>
        <DialogDescription>
          Draft preview · labeled still-image animatic. Missing footage uses
          placeholders.
        </DialogDescription>
        <Player shotIds={m.ids} />
      </>
    );
  const warnings = exportWarnings(d, m.episodeId);
  const firstShot = shotsOfEpisode(d, m.episodeId)[0];
  const aspect = firstShot
    ? generationInputs(d, firstShot.sceneId, firstShot.id).aspectRatio
    : "16:9";
  const dimensions =
    aspect === "16:9"
      ? "1920 × 1080"
      : aspect === "9:16"
        ? "1080 × 1920"
        : "1080 × 1080";
  return (
    <>
      <DialogTitle>
        <Download size={18} /> Export episode
      </DialogTitle>
      <DialogDescription>
        Demo export — no video rendered. Download a real timeline JSON manifest.
      </DialogDescription>
      <div className="form-fields">
        <label>
          Workflow preset
          <select value={preset} onChange={(e) => setPreset(e.target.value)}>
            {["TikTok", "Instagram Reels", "YouTube Shorts"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <p className="muted">
          {aspect} · {dimensions} · 30 fps · workflow labels only
        </p>
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          Description
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={captions}
            onChange={(e) => setCaptions(e.target.checked)}
          />{" "}
          Include captions in manifest
        </label>
      </div>
      {warnings.length > 0 && (
        <div className="notice-inline amber">
          <AlertTriangle size={17} />
          <div>
            {warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
            <label className="checkbox">
              <input
                type="checkbox"
                checked={draft}
                onChange={(e) => setDraft(e.target.checked)}
              />{" "}
              Export a draft-preview manifest
            </label>
          </div>
        </div>
      )}
      <p className="muted">
        {shotsOfEpisode(d, m.episodeId).length} shots · Timeline version{" "}
        {d.episodes[m.episodeId].timelineVersion}
      </p>
      <div className="dialog-footer">
        <Button onClick={close}>Cancel</Button>
        <Button
          variant="default"
          disabled={busy || !title.trim() || (!!warnings.length && !draft)}
          onClick={async () => {
            setBusy(true);
            try {
              const epoch = currentWorkspaceEpoch();
              const record = await exportService.create(
                structuredClone(d),
                m.episodeId,
                { title, preset, captions, description, draft },
              );
              if (epoch !== currentWorkspaceEpoch()) return;
              mutate((d) => {
                d.exports[record.id] = record;
              });
              downloadManifest(record);
              close();
            } catch {
              setError("Demo export failed. Try again.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Preparing demo manifest…" : "Export JSON manifest"}
        </Button>
      </div>
    </>
  );
}
