import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../../components/ui/dialog";
import { useStore } from "../../stores/store";
import {
  librarySubjects,
  type AssetCategory,
  type AssetSubject,
} from "../../domain/asset-library";
import { linkAssetToEpisode } from "../../domain/asset-usage";
import { commit } from "../generation";

export function AddEpisodeAsset({
  episodeId,
  category,
  onClose,
  onAdded,
}: {
  episodeId: string;
  category: AssetCategory;
  onClose(): void;
  onAdded(subject: AssetSubject): void;
}) {
  const data = useStore((s) => s.data),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState<AssetSubject>();
  const items = librarySubjects(data, category).filter((item) =>
    item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="st-dialog av-picker">
        <DialogTitle>Add from Assets</DialogTitle>
        <DialogDescription>
          Link a saved asset to this episode. Scene assignments stay unchanged.
        </DialogDescription>
        <input
          aria-label={`Search asset ${category}`}
          placeholder={`Search ${category}…`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="av-picker-grid">
          {items.map((item) => (
            <button
              key={item.subject.id}
              aria-pressed={selected?.id === item.subject.id}
              onClick={() => setSelected(item.subject)}
            >
              {item.image && <img src={item.image} alt="" />}
              <strong>{item.name}</strong>
            </button>
          ))}
        </div>
        {!items.length && <p>No assets found. Create one in Assets first.</p>}
        <button
          className="ds-button ds-primary"
          disabled={!selected}
          onClick={() => {
            let linked: AssetSubject | undefined;
            if (
              selected &&
              commit((next) => {
                linked = linkAssetToEpisode(next, episodeId, selected);
              }, "Asset added to episode") &&
              linked
            )
              onAdded(linked);
          }}
        >
          Add to episode
        </button>
      </DialogContent>
    </Dialog>
  );
}
