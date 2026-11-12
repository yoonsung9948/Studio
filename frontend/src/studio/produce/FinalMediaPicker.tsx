import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../../components/ui/dialog";
import { shotResults } from "../../domain/produce";
import { appendCutTake } from "../../domain/cut";
import { commit } from "../generation";
import type { ProduceContext } from "./useProduce";

export function FinalMediaPicker({
  context,
  onClose,
}: {
  context: ProduceContext;
  onClose(): void;
}) {
  const { data, episode, allShots } = context;
  const takes = allShots.flatMap((shot) => shotResults(data, shot.id, "video"));
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="produce-media-dialog">
        <DialogTitle>Add media to the cut</DialogTitle>
        <DialogDescription>
          Reuse a video take from this episode. Its original shot and saved
          choice stay intact.
        </DialogDescription>
        <div className="produce-media-grid">
          {takes.map((take) => {
            const asset = data.assets[take.assetId];
            return (
              <button
                key={take.id}
                onClick={() => {
                  if (
                    commit(
                      (d) => appendCutTake(d, episode.id, take.id),
                      "Clip added to cut",
                    )
                  )
                    onClose();
                }}
              >
                {asset.kind === "video" ? (
                  <video src={asset.url} muted preload="metadata" />
                ) : (
                  <img src={asset.url} alt="" />
                )}
                <b>{data.shots[take.shotId].title}</b>
                <small>
                  {take.sourceFrames / 30}s ·{" "}
                  {take.id === data.shots[take.shotId].currentTakeId
                    ? "Chosen take"
                    : "Saved candidate"}
                </small>
              </button>
            );
          })}
        </div>
        {!takes.length && (
          <p>No video takes yet. Generate a take before adding footage.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
