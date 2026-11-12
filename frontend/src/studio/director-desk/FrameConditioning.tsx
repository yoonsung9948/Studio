import { useState } from "react";
import { Check, ImagePlus, Plus, X } from "lucide-react";
import { useStore } from "../../stores/store";
import {
  generationInputs,
  saveGenerationInputs,
} from "../../domain/generation-inputs";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../../components/ui/dialog";
import { commit } from "../generation";

export function FrameConditioning({
  shotId,
  onChangeStart,
}: {
  shotId: string;
  onChangeStart(): void;
}) {
  const data = useStore((state) => state.data),
    shot = data.shots[shotId];
  const inputs = generationInputs(data, shot.sceneId, shotId);
  const projectId =
    data.episodes[data.scenes[shot.sceneId].episodeId].projectId;
  const [choose, setChoose] = useState(false);
  const start = inputs.startingFrameAssetId
    ? data.assets[inputs.startingFrameAssetId]
    : undefined;
  const end = inputs.endingFrameAssetId
    ? data.assets[inputs.endingFrameAssetId]
    : undefined;
  const images = Object.values(data.assets).filter(
    (a) =>
      a.projectId === projectId &&
      a.kind === "image" &&
      a.url &&
      !a.missing &&
      !a.archived,
  );
  const save = (id?: string) =>
    commit(
      (d) =>
        saveGenerationInputs(
          d,
          shot.sceneId,
          { endingFrameAssetId: id },
          shotId,
        ),
      "Ending frame saved",
    );
  return (
    <section className="dd-frame-conditioning">
      <h2>Frame conditioning</h2>
      <div className="dd-frame-pair">
        <div>
          <h3>Starting frame</h3>
          <button onClick={onChangeStart}>
            {start?.url && !start.missing && !start.archived ? (
              <img src={start.url} alt="Chosen starting frame" />
            ) : (
              <ImagePlus size={24} />
            )}
            <span>
              <Check size={15} />
              {start?.url && !start.missing && !start.archived
                ? "Chosen"
                : "Choose frame"}
            </span>
          </button>
        </div>
        <div>
          <h3>
            Ending frame <small>(optional)</small>
          </h3>
          {end ? (
            <div className="dd-end-frame">
              <img src={end.url} alt="Chosen ending frame" />
              <button
                className="ds-icon"
                aria-label="Remove ending frame"
                onClick={() => save()}
              >
                <X size={16} />
              </button>
              <button className="ds-text" onClick={() => setChoose(true)}>
                Change
              </button>
            </div>
          ) : (
            <button
              className="dd-add-reference"
              disabled={!start?.url || start.missing || start.archived}
              onClick={() => setChoose(true)}
            >
              <Plus size={20} />
              Add ending frame
            </button>
          )}
        </div>
      </div>
      <Dialog open={choose} onOpenChange={setChoose}>
        <DialogContent className="st-dialog dd-image-picker">
          <DialogTitle>Choose an ending frame</DialogTitle>
          <DialogDescription>
            Use an image from this production’s library.
          </DialogDescription>
          <div>
            {images.map((a) => (
              <button
                key={a.id}
                onClick={() => {
                  if (save(a.id)) setChoose(false);
                }}
              >
                <img src={a.url} alt="" />
                <span>{a.title}</span>
              </button>
            ))}
          </div>
          {!images.length && <p>No available images yet.</p>}
        </DialogContent>
      </Dialog>
    </section>
  );
}
