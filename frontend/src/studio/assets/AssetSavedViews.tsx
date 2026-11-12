import type { ChangeEvent } from "react";
import { Check, Plus, Upload } from "lucide-react";
import type { Data } from "../../domain/types";
import {
  assetView,
  viewSlots,
  type AssetSubject,
} from "../../domain/asset-library";
import { locationImages } from "../references/reference-media";

export function AssetSavedViews({
  data,
  subject,
  type,
  onView,
  onUpload,
  onPreview,
}: {
  data: Data;
  subject: AssetSubject;
  type: string;
  onView(type: string): void;
  onUpload(event: ChangeEvent<HTMLInputElement>): void;
  onPreview(image: string): void;
}) {
  const slots = viewSlots(subject).map((slot) => ({
    ...slot,
    ...assetView(data, subject, slot.type),
  }));
  const shown = new Set(slots.map((slot) => slot.image));
  const additional =
    subject.kind === "place"
      ? locationImages(data, data.studio.locations[subject.id]).filter(
          (image) => !shown.has(image.url),
        )
      : [];
  return (
    <aside className="av-saved ac-panel" aria-label="Saved views">
      <header>
        <h2>Saved views</h2>
        <span>
          {slots.filter((slot) => slot.ready).length} / {slots.length}
        </span>
      </header>
      {slots.map((view) => (
        <button
          key={view.type}
          className="av-saved-view"
          aria-pressed={type === view.type}
          onClick={() => onView(view.type)}
        >
          {view.image ? (
            <img src={view.image} alt="" />
          ) : (
            <span className="av-placeholder">
              <Plus size={25} />
            </span>
          )}
          <span>
            <strong>{view.label}</strong>
            <small>
              {view.busy
                ? "Generating…"
                : view.ready
                  ? "Saved"
                  : view.image
                    ? "Needs review"
                    : "Not generated"}
            </small>
          </span>
          {view.ready && <Check size={16} />}
        </button>
      ))}
      {additional.length > 0 && (
        <div className="av-additional">
          <h3>Additional saved images</h3>
          {additional.map((image) => (
            <button
              key={image.id}
              className="av-saved-view"
              onClick={() => onPreview(image.url)}
              aria-label={`Preview saved ${image.title}`}
            >
              <img src={image.url} alt="" />
              <span>{image.title}</span>
            </button>
          ))}
        </div>
      )}
      <label className="ds-button av-upload">
        <Upload size={16} /> Upload image
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={onUpload}
          aria-label="Upload reference image"
        />
      </label>
    </aside>
  );
}
