import { createContext, useContext, useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../components/ui/dialog";
import { useStore } from "../stores/store";
import { type Data, type Operation } from "../domain/types";
import {
  workspacePreflight,
  generateWorkspace,
  approveWorkspaceSource,
  lockWorkspace,
} from "../domain/workspace";
import { useSelection, useStudio } from "./selection";
export function commit(fn: (d: Data) => void, label: string, undoable = true) {
  const ok = useStore.getState().mutate(fn, undoable);
  if (ok) useStore.getState().setNotice(label);
  return ok;
}
type Request = { ids: string[]; op: Operation; proposalId?: string };
const Context = createContext<
  (ids: string[], op?: Operation, proposalId?: string) => void
>(() => {});
export const useGenerate = () => useContext(Context);
export function GenerationProvider({ children }: { children: ReactNode }) {
  const [batch, setBatch] = useState<Request | null>(null),
    [confirm, setConfirm] = useState(false);
  const d = useStore((s) => s.data);
  const plan = batch
    ? workspacePreflight(d, batch.ids, batch.op, batch.proposalId)
    : null;
  const submit = (request: Request) => {
    if (
      commit(
        (data) =>
          generateWorkspace(data, request.ids, request.op, request.proposalId),
        `${request.ids.length} ${request.op === "image" ? "still" : "video"} jobs submitted`,
        false,
      )
    ) {
      setBatch(null);
      setConfirm(false);
    }
  };
  const request = (
    ids: string[],
    op: Operation = "image",
    proposalId?: string,
  ) => {
    const plan = workspacePreflight(
      useStore.getState().data,
      ids,
      op,
      proposalId,
    );
    if (ids.length === 1 && !plan.blockers.length && plan.cost <= 100)
      submit({ ids, op, proposalId });
    else setBatch({ ids, op, proposalId });
  };
  const fix = (shotId: string, action: string) => {
    if (action === "Unlock")
      commit((data) => lockWorkspace(data, [shotId], false), "Shot unlocked");
    else if (action === "Approve source")
      commit((data) => approveWorkspaceSource(data, shotId), "Source approved");
    else if (action === "Show activity")
      useStudio.getState().set({ activity: true });
    else if (action === "Ask Director") {
      useStudio.getState().set({ inspector: true, inspectorTab: "director" });
      setBatch(null);
    } else if (action === "Review script") {
      useStudio.getState().set({ view: "script" });
      setBatch(null);
    } else if (action === "Account")
      useStudio.getState().set({ account: true });
    else {
      if (shotId) useSelection.getState().replace([`shot:${shotId}`]);
      useStudio.getState().set({ inspector: true, inspectorTab: "properties" });
      setBatch(null);
    }
  };
  return (
    <Context.Provider value={request}>
      {children}
      {batch && plan && (
        <aside className="st-batch" aria-label="Batch generation">
          <header>
            <h2>Generate selection</h2>
            <button
              className="st-icon"
              aria-label="Close batch generation"
              onClick={() => setBatch(null)}
            >
              ×
            </button>
          </header>
          <div className="st-panel-scroll">
            <label>
              Operation
              <select
                aria-label="Batch operation"
                value={batch.op}
                onChange={(e) =>
                  setBatch({ ...batch, op: e.target.value as Operation })
                }
              >
                <option value="image">Generate stills · 8 cr / shot</option>
                <option value="video">Animate · 24 cr / shot</option>
              </select>
            </label>
            <h3>Scope · {plan.ids.length} shots</h3>
            {plan.ids.map((id) => (
              <button
                className="st-scope-row"
                key={id}
                onClick={() => {
                  useSelection.getState().replace([`shot:${id}`]);
                }}
              >
                <span>{d.scenes[d.shots[id].sceneId].title}</span>
                <b>{d.shots[id].title}</b>
              </button>
            ))}
            <h3>Readiness</h3>
            {!plan.blockers.length ? (
              <p className="st-ready">Ready to generate</p>
            ) : (
              plan.blockers.map((b, i) => (
                <div className="st-blocker" key={i}>
                  <span>{b.message}</span>
                  <button
                    className="st-button"
                    onClick={() => fix(b.shotId, b.fix)}
                  >
                    {b.fix}
                  </button>
                </div>
              ))
            )}
          </div>
          <footer>
            <div className="st-total">
              <span>Total</span>
              <b>{plan.cost} cr</b>
            </div>
            <button
              className="st-button st-primary"
              aria-disabled={!!plan.blockers.length}
              onClick={() => {
                if (plan.blockers.length) {
                  fix(plan.blockers[0].shotId, plan.blockers[0].fix);
                  return;
                }
                if (plan.cost > 100) setConfirm(true);
                else submit(batch);
              }}
            >
              {plan.blockers.length
                ? "Resolve first issue"
                : `${batch.op === "image" ? "Generate stills" : "Animate"} · ${plan.cost} cr`}
            </button>
          </footer>
        </aside>
      )}
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="st-dialog">
          <DialogTitle>Spend {plan?.cost} credits?</DialogTitle>
          <DialogDescription>
            {plan?.ids.length} shots ·{" "}
            {batch?.op === "image" ? "stills" : "video"}. Your existing takes
            remain available.
          </DialogDescription>
          <button
            className="st-button st-primary"
            onClick={() => batch && submit(batch)}
          >
            Confirm · {plan?.cost} cr
          </button>
        </DialogContent>
      </Dialog>
    </Context.Provider>
  );
}
