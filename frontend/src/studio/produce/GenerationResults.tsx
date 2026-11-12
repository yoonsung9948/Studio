import { Heart, Sparkles } from "lucide-react";
import { useStore } from "../../stores/store";
import { StudioPlayer } from "../director-desk/StudioPlayer";
import { commit } from "../generation";
import type { Take } from "../../domain/types";
export function GenerationButton({
  count,
  setCount,
  cost,
  disabled,
  onGenerate,
  video,
}: {
  count: number;
  setCount(value: number): void;
  cost: number;
  disabled?: boolean;
  onGenerate(): void;
  video: boolean;
}) {
  return (
    <div className="produce-generate-action">
      <select
        aria-label="Output count"
        value={count}
        onChange={(e) => setCount(Number(e.target.value))}
      >
        {[1, 2, 3, 4].map((value) => (
          <option key={value} value={value}>
            {value} {video ? "takes" : "frames"}
          </option>
        ))}
      </select>
      <button
        className="ds-button produce-outline-gold"
        disabled={disabled}
        onClick={onGenerate}
      >
        <Sparkles size={16} />
        Generate {count} {video ? "more takes" : "frames"} · {cost} cr
      </button>
    </div>
  );
}
export function ResultPreview({
  take,
  shotId,
}: {
  take: Take;
  shotId: string;
}) {
  const asset = useStore((state) => state.data.assets[take.assetId]);
  return take.kind === "video" ? (
    <StudioPlayer key={take.id} previewTakeId={take.id} shotIds={[shotId]} />
  ) : (
    <img src={asset?.url} alt="Starting-frame candidate" />
  );
}
export function ResultCard({
  take,
  label,
  chosen,
  previewing,
  onPreview,
}: {
  take: Take;
  label: string;
  chosen: boolean;
  previewing: boolean;
  onPreview(): void;
}) {
  const asset = useStore((state) => state.data.assets[take.assetId]);
  return (
    <article
      className={`produce-result ${chosen ? "is-chosen" : ""} ${previewing ? "is-previewing" : ""}`}
    >
      <button
        className="produce-result-preview"
        aria-pressed={previewing}
        aria-label={`${label}${chosen ? " · Chosen" : ""}`}
        onClick={onPreview}
      >
        {asset.kind === "video" ? (
          <video src={asset.url} muted preload="metadata" />
        ) : (
          <img src={asset.url} alt="" />
        )}
        <span>
          <b>{label}</b>
          <small>
            {chosen ? "Chosen" : previewing ? "Previewing" : "Saved"}
          </small>
        </span>
      </button>
      <button
        className="produce-favorite"
        aria-label={`Favorite ${label}`}
        aria-pressed={!!take.favorite}
        onClick={() =>
          commit(
            (d) => {
              d.takes[take.id].favorite = !take.favorite;
            },
            take.favorite ? "Favorite removed" : "Favorite saved",
          )
        }
      >
        <Heart size={16} fill={take.favorite ? "currentColor" : "none"} />
      </button>
    </article>
  );
}
