import { Link } from "react-router-dom";
import { episodeAssetSubjects } from "../../domain/asset-usage";
import { episodeReferencesPath } from "../references/paths";
import { useState } from "react";
import { Check, Search, X, ImageIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../../components/ui/dialog";
import { useStore } from "../../stores/store";
import { effectiveCast, versionAsset } from "../../domain/studio-selectors";
import {
  generationInputs,
  saveGenerationInputs,
  saveGenerationCast,
  effectiveWorldElements,
} from "../../domain/generation-inputs";
import { episodeReferenceCharacters } from "../../domain/episode-characters";
import { episodeMediaAssetIds } from "../../domain/episode-resources";
import { setSceneProps } from "../../domain/produce";
import { markShotsStale } from "../../domain/studio-commands";
import { commit } from "../generation";
export { referenceCards } from "../../domain/produce-references";
import type { CastAssignment } from "../../domain/types";

/** Draft selection is local to the dialog; Apply commits a single domain mutation. */
type ReferencePickerProps = {
  sceneId: string;
  shotId?: string;
  onClose(): void;
};
export function ReferencePicker(props: ReferencePickerProps) {
  return (
    <ReferencePickerDraft
      key={`${props.sceneId}:${props.shotId ?? "scene"}`}
      {...props}
    />
  );
}
function ReferencePickerDraft({
  sceneId,
  shotId,
  onClose,
}: ReferencePickerProps) {
  const data = useStore((state) => state.data),
    scene = data.scenes[sceneId],
    episode = data.episodes[scene.episodeId];
  const revisionOf = (value: typeof data) =>
    JSON.stringify([
      value.studio.setups[sceneId]?.revision,
      value.scenes[sceneId]?.planRevision,
      shotId ? value.shots[shotId]?.revision : undefined,
    ]);
  const [sourceRevision] = useState(() => revisionOf(data));
  const stale = sourceRevision !== revisionOf(data);
  const placeIds = new Set(
    episodeAssetSubjects(data, episode.id, "places").map((item) => item.id),
  );
  const propIds = new Set(
    episodeAssetSubjects(data, episode.id, "props").map((item) => item.id),
  );
  const inputs = generationInputs(data, sceneId, shotId);
  const [cast, setCast] = useState<CastAssignment[]>(() =>
    structuredClone(
      shotId
        ? effectiveCast(data, shotId)
        : (data.studio.setups[sceneId]?.cast ?? []),
    ),
  );
  const [locationId, setLocation] = useState(inputs.locationId ?? "");
  const [props, setProps] = useState(
    effectiveWorldElements(data, sceneId, shotId),
  );
  const [uploads, setUploads] = useState(inputs.referenceInputs);
  const [tab, setTab] = useState("Characters"),
    [search, setSearch] = useState("");
  const availableMedia = episodeMediaAssetIds(data, episode.id);
  const items =
    tab === "Characters"
      ? episodeReferenceCharacters(data, episode.id).map((item) => ({
          id: item.id,
          name: item.name,
          image:
            versionAsset(data, item.canonicalVersionId)?.url || item.reference,
        }))
      : tab === "Places"
        ? Object.values(data.studio.locations)
            .filter(
              (item) =>
                item.projectId === episode.projectId && placeIds.has(item.id),
            )
            .map((item) => ({
              id: item.id,
              name: item.name,
              image:
                data.assets[item.assetId ?? ""]?.url ||
                versionAsset(data, item.primaryVersionId)?.url,
            }))
        : tab === "Props"
          ? (data.projects[episode.projectId].worldElements ?? [])
              .filter((item) => item.kind === "prop" && propIds.has(item.id))
              .map((item) => ({
                id: item.id,
                name: item.name,
                image: data.assets[item.assetId ?? ""]?.url,
              }))
          : Object.values(data.assets)
              .filter(
                (asset) =>
                  availableMedia.has(asset.id) &&
                  asset.kind === "image" &&
                  !asset.archived &&
                  !asset.missing,
              )
              .map((asset) => ({
                id: asset.id,
                name: asset.title,
                image: asset.url,
              }));
  const selected = (id: string) =>
    tab === "Characters"
      ? cast.some((item) => item.characterId === id)
      : tab === "Places"
        ? id === locationId
        : tab === "Props"
          ? props.includes(id)
          : uploads.some((item) => item.assetId === id);
  const toggle = (id: string) => {
    if (tab === "Characters")
      setCast(
        cast.some((item) => item.characterId === id)
          ? cast.filter((item) => item.characterId !== id)
          : [...cast, { characterId: id }],
      );
    else if (tab === "Places") setLocation(locationId === id ? "" : id);
    else if (tab === "Props")
      setProps(
        props.includes(id)
          ? props.filter((item) => item !== id)
          : [...props, id],
      );
    else
      setUploads(
        uploads.some((item) => item.assetId === id)
          ? uploads.filter((item) => item.assetId !== id)
          : [...uploads, { assetId: id, purpose: "continuity" }],
      );
  };
  const apply = () => {
    if (
      commit((d) => {
        if (revisionOf(d) !== sourceRevision)
          throw Error(
            "Scene references changed. Close and reopen this picker before applying.",
          );
        saveGenerationCast(d, sceneId, cast, shotId);
        saveGenerationInputs(
          d,
          sceneId,
          {
            locationMode: locationId ? "selected" : "none",
            locationId: locationId || undefined,
            referenceInputs: uploads,
          },
          shotId,
        );
        if (shotId) {
          d.shots[shotId].worldElementIds = props;
          markShotsStale(d, [shotId]);
        } else setSceneProps(d, sceneId, props);
      }, "References saved")
    )
      onClose();
  };
  return (
    <Dialog
      open
      modal={false}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="produce-reference-dialog"
        onInteractOutside={(event) => event.preventDefault()}
      >
        <header>
          <DialogTitle>Add references</DialogTitle>
          <button
            className="ds-icon"
            aria-label="Close references"
            onClick={onClose}
          >
            <X />
          </button>
        </header>
        <DialogDescription>
          {scene.title} ·{" "}
          {shotId ? "Selected for this shot" : "Scene foundations"} · Episode{" "}
          {data.projects[episode.projectId].episodeIds.indexOf(episode.id) + 1}
        </DialogDescription>
        <nav className="produce-tabs" aria-label="Reference categories">
          {["Characters", "Places", "Props", "Uploads"].map((name) => (
            <button
              key={name}
              aria-pressed={tab === name}
              onClick={() => setTab(name)}
            >
              {name}
            </button>
          ))}
        </nav>
        <label className="produce-search">
          <Search size={18} />
          <input
            aria-label="Search references"
            placeholder={`Search ${tab.toLowerCase()}…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="produce-reference-grid">
          {items
            .filter((item) =>
              item.name.toLowerCase().includes(search.toLowerCase()),
            )
            .map((item) => (
              <div key={item.id} className="produce-reference-option">
                <button
                  aria-pressed={selected(item.id)}
                  onClick={() => toggle(item.id)}
                >
                  {item.image ? <img src={item.image} alt="" /> : <ImageIcon />}
                  <b>{item.name}</b>
                  {selected(item.id) && (
                    <Check className="produce-reference-check" size={20} />
                  )}
                </button>
                {tab === "Characters" && selected(item.id) && (
                  <select
                    aria-label={`${item.name} look`}
                    value={
                      cast.find((entry) => entry.characterId === item.id)
                        ?.lookId ?? ""
                    }
                    onChange={(e) =>
                      setCast(
                        cast.map((entry) =>
                          entry.characterId === item.id
                            ? {
                                ...entry,
                                lookId: e.target.value || undefined,
                                referenceIds: undefined,
                              }
                            : entry,
                        ),
                      )
                    }
                  >
                    <option value="">Identity only</option>
                    {Object.values(data.studio.looks)
                      .filter(
                        (look) =>
                          look.characterId === item.id &&
                          (!look.episodeId || look.episodeId === episode.id),
                      )
                      .map((look) => (
                        <option key={look.id} value={look.id}>
                          {look.name}
                        </option>
                      ))}
                  </select>
                )}
              </div>
            ))}
        </div>
        {!items.length && (
          <p className="produce-hint">
            No {tab.toLowerCase()} available. Add them in this episode’s
            References or Media.{" "}
            <Link
              to={
                tab === "Uploads"
                  ? `/projects/${episode.projectId}/episodes/${episode.id}/media`
                  : `${episodeReferencesPath(episode.projectId, episode.id)}?kind=${tab.toLowerCase()}`
              }
            >
              Open episode {tab === "Uploads" ? "Media" : "References"}
            </Link>
          </p>
        )}
        {stale && (
          <p role="alert">
            Scene references changed. Close and reopen this picker to use the
            latest setup.
          </p>
        )}
        <footer>
          <p>
            {cast.length + props.length + uploads.length + (locationId ? 1 : 0)}{" "}
            references selected
          </p>
          <button
            className="ds-button ds-primary"
            disabled={stale}
            onClick={apply}
          >
            Apply references
          </button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
