import { useRef, useState } from "react";
import { ImageIcon, Sparkles, Upload, X } from "lucide-react";
import { useStore } from "../../stores/store";
import { Button } from "../../components/ui/button";
import {
  generationInputs,
  saveGenerationInputs,
} from "../../domain/generation-inputs";
import { CONFIG, uid } from "../../domain/types";
export type FrameKind = "startingFrameAssetId" | "endingFrameAssetId";
export function FrameControls({
  ids,
  onCreate,
  initialShotId,
}: {
  ids: string[];
  initialShotId?: string;
  onCreate: (shotId: string, kind: FrameKind) => void;
}) {
  const d = useStore((s) => s.data),
    mutate = useStore((s) => s.mutate);
  const [selected, setSelected] = useState<string | null>(
    initialShotId ?? null,
  );
  const [assetPicker, setAssetPicker] = useState<FrameKind | null>(null);
  const [uploadKind, setUploadKind] = useState<FrameKind>(
    "startingFrameAssetId",
  );
  const [error, setError] = useState("");
  const upload = useRef<HTMLInputElement>(null);
  const shot = selected ? d.shots[selected] : undefined;
  const inputs = shot ? generationInputs(d, shot.sceneId, shot.id) : undefined;
  const attach = (kind: FrameKind, assetId: string) => {
    if (!shot) return;
    mutate(
      (data) =>
        saveGenerationInputs(data, shot.sceneId, { [kind]: assetId }, shot.id),
      true,
    );
    setAssetPicker(null);
  };
  return (
    <section
      className="generation-section frame-controls"
      aria-label="Frame conditioning"
    >
      <div className="generation-section-label">
        <ImageIcon size={18} />
        <div>
          <h3>
            Frame control <small>Optional</small>
          </h3>
          <p>
            Let the model compose each shot, or choose its opening and closing
            composition.
          </p>
        </div>
      </div>
      <div className="frame-shot-list">
        {ids.map((id) => {
          const item = d.shots[id];
          if (!item) return null;
          const value = generationInputs(d, item.sceneId, id);
          return (
            <button
              key={id}
              aria-pressed={selected === id}
              onClick={() => {
                setSelected(selected === id ? null : id);
                setAssetPicker(null);
              }}
            >
              <span>{item.title}</span>
              <small>
                {value.endingFrameAssetId
                  ? "Start + end frames"
                  : value.startingFrameAssetId
                    ? "Starting frame"
                    : "Automatic composition"}
              </small>
              <span>{selected === id ? "Close" : "Set frames"}</span>
            </button>
          );
        })}
      </div>
      {shot && inputs && (
        <div className="frame-shot-editor">
          <div className="section-heading">
            <h3>{shot.title}</h3>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                mutate(
                  (data) =>
                    saveGenerationInputs(
                      data,
                      shot.sceneId,
                      {
                        startingFrameAssetId: undefined,
                        endingFrameAssetId: undefined,
                      },
                      shot.id,
                    ),
                  true,
                )
              }
            >
              Use automatic composition
            </Button>
          </div>
          <div className="frame-pair">
            {(["startingFrameAssetId", "endingFrameAssetId"] as const).map(
              (kind) => {
                const a = inputs[kind] ? d.assets[inputs[kind]!] : undefined;
                const disabled =
                  kind === "endingFrameAssetId" && !inputs.startingFrameAssetId;
                return (
                  <div className="frame-input" key={kind}>
                    <h4>
                      {kind === "startingFrameAssetId"
                        ? "Starting frame"
                        : "Ending frame"}
                    </h4>
                    {a?.url && !a.missing ? (
                      <img
                        src={a.url}
                        alt={`${shot.title} ${kind === "startingFrameAssetId" ? "starting" : "ending"} frame`}
                      />
                    ) : (
                      <div className="frame-empty">
                        <ImageIcon size={24} />
                        <span>
                          {disabled
                            ? "Choose a starting frame first"
                            : "No frame selected"}
                        </span>
                      </div>
                    )}
                    <div className="row-actions">
                      <Button
                        size="sm"
                        disabled={disabled}
                        onClick={() => setAssetPicker(kind)}
                      >
                        Choose from assets
                      </Button>
                      <Button
                        size="sm"
                        disabled={disabled}
                        onClick={() => {
                          setUploadKind(kind);
                          upload.current?.click();
                        }}
                      >
                        <Upload size={12} />
                        Upload image
                      </Button>
                      <Button
                        size="sm"
                        disabled={disabled}
                        onClick={() => onCreate(shot.id, kind)}
                      >
                        <Sparkles size={12} />
                        Create image with AI
                      </Button>
                      {inputs[kind] && (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Remove ${kind === "startingFrameAssetId" ? "starting" : "ending"} frame`}
                          onClick={() =>
                            mutate(
                              (data) =>
                                saveGenerationInputs(
                                  data,
                                  shot.sceneId,
                                  kind === "startingFrameAssetId"
                                    ? {
                                        startingFrameAssetId: undefined,
                                        endingFrameAssetId: undefined,
                                      }
                                    : { endingFrameAssetId: undefined },
                                  shot.id,
                                ),
                              true,
                            )
                          }
                        >
                          <X size={12} />
                          Remove
                        </Button>
                      )}
                    </div>
                  </div>
                );
              },
            )}
          </div>
          {assetPicker && (
            <div
              className="generation-library"
              role="region"
              aria-label="Frame image library"
            >
              <div className="section-heading">
                <h3>Choose a frame image</h3>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setAssetPicker(null)}
                >
                  Close library
                </Button>
              </div>
              <div className="generation-library-grid">
                {Object.values(d.assets)
                  .filter(
                    (a) =>
                      a.projectId ===
                        d.episodes[d.scenes[shot.sceneId].episodeId]
                          .projectId &&
                      a.kind === "image" &&
                      a.url &&
                      !a.missing,
                  )
                  .map((a) => (
                    <button
                      key={a.id}
                      onClick={() => attach(assetPicker, a.id)}
                    >
                      <img src={a.url} alt="" />
                      <span>{a.title}</span>
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
      <p className="generation-caption">
        Frame controls apply to individual shots. Choose images for precise
        composition, or leave the model on automatic.
      </p>
      <input
        ref={upload}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file || !shot) return;
          if (
            !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
            file.size > CONFIG.maxUploadBytes
          ) {
            setError("Choose a PNG, JPEG, or WebP image under 20 MB.");
            return;
          }
          const id = uid("frame-upload"),
            url = URL.createObjectURL(file);
          const success = mutate((data) => {
            const pid =
              data.episodes[data.scenes[shot.sceneId].episodeId].projectId;
            data.assets[id] = {
              id,
              projectId: pid,
              title: file.name,
              kind: "image",
              url,
              sessionOnly: true,
              provenance: "Uploaded conditioning frame · reattach after reload",
            };
            saveGenerationInputs(
              data,
              shot.sceneId,
              { [uploadKind]: id },
              shot.id,
            );
          }, true);
          if (!success) {
            URL.revokeObjectURL(url);
            setError(useStore.getState().notice);
          } else setError("");
        }}
      />
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
