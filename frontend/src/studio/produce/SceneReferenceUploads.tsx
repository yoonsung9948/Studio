import { useRef, useState, type ChangeEvent } from "react";
import { Upload, X } from "lucide-react";
import {
  generationInputs,
  saveGenerationInputs,
} from "../../domain/generation-inputs";
import { uploadSceneReference } from "../../services/scene-reference-upload";
import { commit } from "../generation";
import type { ProduceContext } from "./useProduce";

export function SceneReferenceUploads({
  context,
}: {
  context: ProduceContext;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const { data, scene } = context;
  if (!scene) return null;
  const refs = generationInputs(data, scene.id).referenceInputs;
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    setBusy(true);
    setError("");
    try {
      for (const file of files) await uploadSceneReference(scene.id, file);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Upload failed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="produce-reference-uploads"
      aria-label="Additional references"
    >
      <header>
        <h3>Additional references</h3>
        <button
          className="produce-link"
          disabled={busy || refs.length >= 12}
          onClick={() => input.current?.click()}
        >
          <Upload size={14} />
          {busy ? "Uploading…" : "Upload"}
        </button>
      </header>
      <input
        ref={input}
        hidden
        type="file"
        aria-label="Upload additional references"
        multiple
        accept="image/png,image/jpeg,image/webp"
        disabled={busy}
        onChange={upload}
      />
      {refs.map((ref) => {
        const asset = data.assets[ref.assetId];
        if (!asset) return null;
        return (
          <div className="produce-uploaded-reference" key={ref.assetId}>
            {asset.url && !asset.missing && <img src={asset.url} alt="" />}
            <span>{asset.title}</span>
            <button
              className="ds-icon"
              aria-label={`Remove reference ${asset.title}`}
              onClick={() =>
                commit(
                  (d) =>
                    saveGenerationInputs(d, scene.id, {
                      referenceInputs: generationInputs(
                        d,
                        scene.id,
                      ).referenceInputs.filter(
                        (item) => item.assetId !== ref.assetId,
                      ),
                    }),
                  "Reference removed",
                )
              }
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
      {!refs.length && (
        <button
          className="produce-add-reference"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          <Upload size={16} />
          Upload reference images
        </button>
      )}
      <p className="produce-hint">
        PNG, JPEG or WebP · up to 20 MB each. Saved with this episode.
      </p>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
