import { ImagePlus, Plus, Search } from "lucide-react";
import { useStore } from "../../stores/store";
import {
  assetSubject,
  assetView,
  viewSlots,
  type AssetSubject,
} from "../../domain/asset-library";
import { locationImages } from "../references/reference-media";
import { episodeCharacterLooks } from "../../domain/episode-characters";

export function AssetGallery({
  subjects,
  query,
  onQuery,
  onOpen,
  onCreate,
  category,
  episodeId,
  onOpenLook,
  onNewLook,
}: {
  subjects: AssetSubject[];
  query: string;
  onQuery(value: string): void;
  onOpen(subject: AssetSubject): void;
  onCreate(): void;
  category: string;
  episodeId?: string;
  onOpenLook?(characterId: string, lookId: string): void;
  onNewLook?(characterId: string): void;
}) {
  const data = useStore((s) => s.data);
  const items = subjects
    .flatMap((subject) => assetSubject(data, subject) ?? [])
    .filter((item) =>
      `${item.name} ${item.description}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
    );
  return (
    <>
      <div className="ag-toolbar">
        <label>
          <Search size={18} />
          <input
            aria-label={`Search ${category}`}
            placeholder={`Search ${category}…`}
            value={query}
            onChange={(event) => onQuery(event.target.value)}
          />
        </label>
        <span>
          {items.length} {category}
        </span>
      </div>
      <div className={`ag-grid ag-${category}`}>
        {items.map((item) => {
          const slots = viewSlots(item.subject)
            .map((slot) => ({
              ...slot,
              ...assetView(data, item.subject, slot.type),
            }))
            .filter((view) => view.image);
          const images =
            item.subject.kind === "place"
              ? locationImages(
                  data,
                  data.studio.locations[item.subject.id],
                ).map((image) => image.url)
              : slots.map((slot) => slot.image!);
          const looks =
            episodeId && item.subject.kind === "character"
              ? episodeCharacterLooks(data, episodeId, item.subject.id)
              : [];
          return (
            <article
              className="ag-card"
              aria-label={`${item.subject.kind} ${item.name}`}
              key={item.subject.id}
            >
              <button
                className="ag-card-main"
                aria-label={`Open ${item.name} views`}
                onClick={() => onOpen(item.subject)}
              >
                <div className="ag-card-images">
                  {item.image ? (
                    <img src={item.image} alt={item.name} />
                  ) : (
                    <span className="ag-placeholder">
                      <ImagePlus size={36} />
                      Create first view
                    </span>
                  )}
                  {category === "places" && images.length > 1 && (
                    <div>
                      {images.slice(1, 3).map((image, index) => (
                        <img src={image} key={index} alt="" />
                      ))}
                    </div>
                  )}
                  <span className="ag-open-label">Open views →</span>
                </div>
                <div className="ag-card-copy">
                  <h2>{item.name}</h2>
                  <p>
                    {item.description ||
                      "Add a description and generate your first view."}
                  </p>
                </div>
              </button>
              {looks.length > 0 ? (
                <div className="ag-look-strip">
                  {looks.map((look) => {
                    const view = assetView(
                      data,
                      { kind: "look", id: look.id },
                      "front",
                    );
                    return (
                      <button
                        key={look.id}
                        onClick={() => onOpenLook?.(item.subject.id, look.id)}
                      >
                        {view.image ? (
                          <img src={view.image} alt="" />
                        ) : (
                          <ImagePlus size={22} />
                        )}
                        <span>{look.name}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="ag-card-meta">
                  <span>
                    {slots.filter((view) => view.ready).length} saved views
                  </span>
                  <span>Views & generation</span>
                </div>
              )}
              {episodeId && item.subject.kind === "character" && onNewLook && (
                <button
                  className="ac-text-button ag-new-look"
                  onClick={() => onNewLook(item.subject.id)}
                >
                  <Plus size={14} />
                  New episode look
                </button>
              )}
            </article>
          );
        })}
        <button className="ag-add" onClick={onCreate}>
          <Plus size={30} />
          <strong>
            {episodeId
              ? "Add from Assets"
              : `New ${category === "characters" ? "character" : category === "places" ? "place" : "prop"}`}
          </strong>
          <span>
            {episodeId
              ? "Choose an existing asset"
              : "Create views you can reuse"}
          </span>
        </button>
      </div>
      {!items.length && !query && (
        <p className="ac-muted">
          {episodeId
            ? category === "characters"
              ? "No characters linked yet"
              : `No ${category} yet`
            : `No ${category} yet. Create your first asset to generate views.`}
        </p>
      )}
      {!items.length && query && (
        <p className="ac-muted">No matching {category}. Try another search.</p>
      )}
    </>
  );
}
