import { useOwnedData } from "../../services/server-data";
import { SubjectViewEditor } from "./ServerCharacters";
import { productionSync } from "../../services/production-sync";
import { AssetSavedViews } from "./AssetSavedViews";
import { validVersion } from "../../domain/studio-selectors";
import { approveVersion } from "../../domain/studio-commands";
import { useState, type ChangeEvent } from "react";
import { Link } from "react-router-dom";
import { Check, ImagePlus, Sparkles, ZoomIn } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../../components/ui/dialog";
import { useStore } from "../../stores/store";
import { CONFIG, type Data } from "../../domain/types";
import {
  assetSourceSubject,
  assetSubject,
  assetView,
  assetViewCandidates,
  assetViewsPath,
  generateAssetView,
  objectOwner,
  saveAssetView,
  uploadAssetView,
  viewSlots,
  type AssetSubject,
} from "../../domain/asset-library";
import { AssetUsage } from "./AssetUsage";
import { useAssetPath } from "./asset-navigation";
import { commit } from "../generation";

export function AssetViewStudio(props: {
  subject: AssetSubject;
  type: string;
  onView(type: string): void;
  episodeId?: string;
}) {
  const owned = useOwnedData();
  if (owned && productionSync())
    return (
      <SubjectViewEditor
        key={props.subject.id}
        id={props.subject.id}
        kind={
          props.subject.kind === "character"
            ? "cast"
            : props.subject.kind === "look"
              ? "look"
              : props.subject.kind === "place"
                ? "place_instance"
                : "prop_instance"
        }
        onDeleted={() => {}}
      />
    );
  return <LocalAssetViewStudio {...props} />;
}
function LocalAssetViewStudio({
  subject,
  type,
  onView,
  episodeId,
}: {
  subject: AssetSubject;
  type: string;
  onView(type: string): void;
  episodeId?: string;
}) {
  const data = useStore((s) => s.data),
    path = useAssetPath();
  const item = assetSubject(data, subject)!;
  const slots = viewSlots(subject),
    target = assetView(data, subject, type),
    candidates = assetViewCandidates(data, subject, type);
  const identityId =
    subject.kind === "character"
      ? data.characters[subject.id]?.canonicalVersionId
      : subject.kind === "look"
        ? data.characters[data.studio.looks[subject.id].characterId]
            ?.canonicalVersionId
        : undefined;
  const prerequisite =
    (subject.kind === "look" ||
      (subject.kind === "character" && type !== "front")) &&
    !validVersion(data, identityId)
      ? "Save the character’s front portrait first to keep its identity consistent."
      : subject.kind === "look" &&
          type !== "front" &&
          !assetView(data, subject, "front").ready
        ? "Save this look’s front portrait before generating other angles."
        : "";
  const label = slots.find((slot) => slot.type === type)!.label;
  const [previewId, setPreviewId] = useState<string>();
  const preview =
    candidates.find((version) => version.id === previewId) ??
    candidates.find((v) => v.id === target.currentId) ??
    candidates[0];
  const image = preview ? data.assets[preview.assetId]?.url : target.image;
  const [prompt, setPrompt] = useState(
    item.description ? `${label}. ${item.description}` : "",
  );
  const [count, setCount] = useState(2),
    [avoid, setAvoid] = useState("text, watermark, blurry"),
    [lighting, setLighting] = useState("Neutral studio light");
  const [dialog, setDialog] = useState<"zoom" | "compare">(),
    [error, setError] = useState("");
  const sourceSubject = assetSourceSubject(data, subject),
    source = assetSubject(data, sourceSubject);
  const [additionalImage, setAdditionalImage] = useState<string>();
  const run = (action: (next: Data) => void, message: string) => {
    const ok = commit(
      (next) => {
        try {
          action(next);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Please try again.");
          throw err;
        }
      },
      message,
      false,
    );
    if (ok) setError("");
    return ok;
  };
  const upload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 5 * 1024 * 1024
    ) {
      setError("Choose a PNG, JPEG or WebP image smaller than 5 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onerror = () =>
      setError("The image could not be read. Please try again.");
    reader.onload = () => {
      let id = "";
      if (
        run((next) => {
          id = uploadAssetView(
            next,
            subject,
            type,
            String(reader.result),
            file.name,
          );
        }, "Image added as a candidate")
      )
        setPreviewId(id);
    };
    reader.readAsDataURL(file);
  };
  return (
    <>
      <div className="av-studio">
        <AssetSavedViews
          data={data}
          subject={subject}
          type={type}
          onView={onView}
          onUpload={upload}
          onPreview={(image) => {
            setAdditionalImage(image);
            setDialog("zoom");
          }}
        />
        <section className="av-canvas" aria-label="View preview and candidates">
          <div className="av-preview">
            {image ? (
              <img src={image} alt={`${item.name} ${label} preview`} />
            ) : (
              <div className="av-empty-preview">
                <ImagePlus size={42} />
                <h2>Create your {label.toLowerCase()}</h2>
                <p>
                  Describe the image, generate candidates, then save the one you
                  like.
                </p>
              </div>
            )}
            <span className="av-preview-label">
              {preview
                ? `Candidate ${String(candidates.length - candidates.indexOf(preview)).padStart(2, "0")} · ${preview.id === target.currentId ? "Saved" : "Previewing"}`
                : label}
            </span>
            {image && (
              <button
                className="ds-icon av-zoom"
                aria-label="Enlarge preview"
                onClick={() => {
                  setAdditionalImage(undefined);
                  setDialog("zoom");
                }}
              >
                <ZoomIn size={20} />
              </button>
            )}
          </div>
          <header className="av-candidate-heading">
            <h3>Generated candidates · {candidates.length}</h3>
            <button
              className="ac-text-button"
              disabled={candidates.length < 2}
              onClick={() => setDialog("compare")}
            >
              Compare
            </button>
          </header>
          <div className="av-candidates" aria-label="Generated candidates">
            {candidates.map((version, index) => (
              <button
                key={version.id}
                aria-label={`Preview candidate ${candidates.length - index}`}
                aria-pressed={preview?.id === version.id}
                onClick={() => setPreviewId(version.id)}
              >
                <img src={data.assets[version.assetId].url} alt="" />
                <span>
                  {String(candidates.length - index).padStart(2, "0")}
                </span>
                {version.id === target.currentId && (
                  <Check className="av-chosen" size={21} />
                )}
              </button>
            ))}
            {!candidates.length && (
              <p className="ac-muted">
                Your generated images will appear here. Every candidate stays
                available.
              </p>
            )}
          </div>
          <footer className="av-save">
            <button
              className="ds-button ds-primary"
              disabled={!preview || preview.id === target.currentId}
              onClick={() =>
                preview &&
                run(
                  (next) => saveAssetView(next, subject, type, preview.id),
                  `${label} saved`,
                )
              }
            >
              <Check size={17} />
              {(preview ? preview.id === target.currentId : target.ready)
                ? `${label} saved`
                : `Save as ${label.toLowerCase()}`}
            </button>
            {(subject.kind === "place" || subject.kind === "prop") && (
              <button
                className="ds-button"
                disabled={
                  !preview ||
                  objectOwner(data, subject)?.primaryVersionId === preview.id
                }
                onClick={() =>
                  preview &&
                  run((next) => {
                    saveAssetView(next, subject, type, preview.id);
                    approveVersion(next, preview.id);
                  }, "Primary image updated")
                }
              >
                Make primary
              </button>
            )}
            <p className="ac-muted">
              Preview freely. Saving chooses this view; scene assignments stay
              as they are.
            </p>
          </footer>
        </section>
        <form
          className="av-controls ac-panel"
          aria-label="Generate views"
          onSubmit={(event) => {
            event.preventDefault();
            run(
              (next) =>
                generateAssetView(
                  next,
                  subject,
                  type,
                  count,
                  `${prompt}\nLighting: ${lighting}\nAvoid: ${avoid}`,
                ),
              "View generation started",
            );
          }}
        >
          <h2>
            <Sparkles size={21} /> Generate views
          </h2>
          {source && (
            <div>
              <small>
                {subject.kind === "look" ? "Source identity" : "Working on"}
              </small>
              <Link
                className="av-source"
                to={path(assetViewsPath(sourceSubject))}
              >
                {source.image && <img src={source.image} alt="" />}
                <span>
                  <strong>{source.name}</strong>
                  <small>
                    {subject.kind === "look"
                      ? "Reusable identity"
                      : "Reusable asset"}
                  </small>
                </span>
              </Link>
            </div>
          )}
          {subject.kind === "look" && (
            <p className="av-scope">
              Episode look · {data.studio.looks[subject.id].name}
            </p>
          )}
          <label className="ac-field">
            Target view
            <select
              value={type}
              onChange={(event) => onView(event.target.value)}
            >
              {slots.map((slot) => (
                <option key={slot.type} value={slot.type}>
                  {slot.label}
                </option>
              ))}
            </select>
          </label>
          <label className="ac-field">
            Direction
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              maxLength={3000}
              rows={5}
              placeholder="Describe the image you want. Be specific about appearance, angle and mood."
            />
            <small className="ac-counter">{prompt.length}/3000</small>
          </label>
          <label className="ac-field">
            Output count
            <select
              value={count}
              onChange={(event) => setCount(Number(event.target.value))}
            >
              {[1, 2, 3, 4].map((value) => (
                <option key={value} value={value}>
                  {value} {value === 1 ? "image" : "images"}
                </option>
              ))}
            </select>
          </label>
          <details className="av-advanced">
            <summary>Advanced controls</summary>
            <label className="ac-field">
              Lighting
              <select
                value={lighting}
                onChange={(event) => setLighting(event.target.value)}
              >
                {[
                  "Neutral studio light",
                  "Warm practical light",
                  "Soft daylight",
                  "Dramatic low key",
                ].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className="ac-field">
              Avoid
              <textarea
                value={avoid}
                onChange={(event) => setAvoid(event.target.value)}
                rows={2}
                maxLength={500}
              />
            </label>
          </details>
          {error && (
            <p role="alert" className="ac-error">
              {error}
            </p>
          )}
          <p className="av-cost">
            <span>Cost</span>
            <span>{CONFIG.imageCost} credits per image</span>
          </p>
          <button
            className="ds-button ds-primary"
            disabled={
              !!prerequisite ||
              target.busy ||
              !prompt.trim() ||
              data.credits < count * CONFIG.imageCost
            }
          >
            <Sparkles size={17} />
            {target.busy
              ? "Generating…"
              : `Generate ${count} views · ${count * CONFIG.imageCost} cr`}
          </button>
          {prerequisite && <p className="ac-muted">{prerequisite}</p>}
          {data.credits < count * CONFIG.imageCost && (
            <p className="ac-error">Not enough credits. Choose fewer images.</p>
          )}
        </form>
      </div>
      <AssetUsage data={data} subject={subject} episodeId={episodeId} />
      {dialog && (
        <Dialog open onOpenChange={(open) => !open && setDialog(undefined)}>
          <DialogContent className="st-dialog av-image-dialog">
            <DialogTitle>
              {dialog === "compare"
                ? "Compare candidates"
                : `${item.name} · ${label}`}
            </DialogTitle>
            <DialogDescription>
              Preview images without changing your saved choice.
            </DialogDescription>
            {dialog === "zoom" ? (
              <img src={additionalImage ?? image} alt={label} />
            ) : (
              <div className="av-compare">
                {candidates.map((version) => (
                  <button
                    key={version.id}
                    onClick={() => {
                      setPreviewId(version.id);
                      setDialog(undefined);
                    }}
                  >
                    <img
                      src={data.assets[version.assetId].url}
                      alt={`Candidate ${version.id}`}
                    />
                    {version.id === target.currentId
                      ? "Saved"
                      : "Preview candidate"}
                  </button>
                ))}
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
