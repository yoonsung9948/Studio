import { SelectionSurface } from "./SelectionSurface";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Upload,
  ArrowUpRight,
  FileVideo,
  Music,
  ImageIcon,
} from "lucide-react";
import { useStore } from "../stores/store";
import { useSelection, type EntityKey } from "./selection";
import { commit } from "./generation";
import {
  CommandMenu,
  useRegisterCommands,
  type StudioCommand,
} from "./commands";
import {
  assetUsages,
  archiveWorkspaceAssets,
  importWorkspaceAsset,
  renameWorkspaceAsset,
} from "../domain/workspace";
import { CONFIG } from "../domain/types";
import {
  Field,
  registerInspector,
  RegisteredInspectorSections,
} from "./inspector";
import { downloadManifest } from "../services/mock";
import { useActions } from "../components/Actions";
export function LibraryWorkspace() {
  const { projectId = "" } = useParams(),
    d = useStore((s) => s.data),
    keys = useSelection((s) => s.keys),
    modal = useActions(),
    [params, setParams] = useSearchParams(),
    [query, setQuery] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  const filter = params.get("filter") ?? "all";
  const assets = Object.values(d.assets).filter(
    (a) =>
      a.projectId === projectId &&
      (filter === "archive" ? a.archived : !a.archived) &&
      (filter === "all" || filter === "archive" || a.kind === filter) &&
      a.title.toLowerCase().includes(query.toLowerCase()),
  );
  const selected = keys.at(-1)?.startsWith("asset:")
    ? d.assets[keys.at(-1)!.slice(6)]
    : undefined;
  useEffect(() => useSelection.getState().replace([]), [projectId]);
  const commands = useMemo<StudioCommand[]>(
    () => [
      {
        id: "library.upload",
        label: "Upload media",
        run: () => upload.current?.click(),
      },
      {
        id: "library.archive",
        label: "Archive selection",
        run: () =>
          commit(
            (data) =>
              archiveWorkspaceAssets(
                data,
                useSelection
                  .getState()
                  .keys.filter((k) => k.startsWith("asset:"))
                  .map((k) => k.slice(6)),
                true,
              ),
            "Media archived",
          ),
      },
      {
        id: "library.restore",
        label: "Restore selection",
        run: () =>
          commit(
            (data) =>
              archiveWorkspaceAssets(
                data,
                useSelection
                  .getState()
                  .keys.filter((k) => k.startsWith("asset:"))
                  .map((k) => k.slice(6)),
                false,
              ),
            "Media restored",
          ),
      },
    ],
    [projectId],
  );
  useRegisterCommands("library", commands);
  if (!d.projects[projectId])
    return <div className="st-empty">Project unavailable</div>;
  return (
    <div className="st-project-page">
      <header className="st-scope-header">
        <span>{d.projects[projectId].title}</span>
        <h1>Library</h1>
      </header>
      <div className="st-library-layout">
        <section className="st-library-main">
          <header className="st-library-toolbar">
            <nav aria-label="Media filters">
              {[
                { id: "all", name: "All" },
                { id: "image", name: "Images" },
                { id: "video", name: "Video" },
                { id: "audio", name: "Audio" },
                { id: "renders", name: "Renders" },
                { id: "archive", name: "Archive" },
              ].map((f) => (
                <button
                  key={f.id}
                  aria-pressed={filter === f.id}
                  onClick={() => setParams({ filter: f.id })}
                >
                  {f.name}
                </button>
              ))}
            </nav>
            <button
              className="st-button st-mobile-details"
              onClick={() => setShowDetails(true)}
            >
              Details
            </button>
            <input
              aria-label="Search library"
              placeholder="Search media"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              className="st-button"
              onClick={() => upload.current?.click()}
            >
              <Upload size={13} />
              Upload
            </button>
          </header>
          <SelectionSurface
            className="st-panel-scroll st-library-grid-wrap"
            aria-label="Library cards"
          >
            {filter === "renders" ? (
              <>
                <div className="st-section-heading">
                  <h2>Renders</h2>
                  <select
                    aria-label="Export episode"
                    value=""
                    onChange={(e) => {
                      if (e.target.value)
                        modal({ kind: "export", episodeId: e.target.value });
                    }}
                  >
                    <option value="">New export…</option>
                    {d.projects[projectId].episodeIds.map((id) => (
                      <option key={id} value={id}>
                        {d.episodes[id].title}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="st-muted">
                  Local exports are timeline manifests. Video rendering is not
                  connected.
                </p>
                <div className="st-render-list">
                  {Object.values(d.exports)
                    .filter(
                      (r) =>
                        d.episodes[r.episodeId]?.projectId === projectId &&
                        r.title.toLowerCase().includes(query.toLowerCase()),
                    )
                    .map((r) => (
                      <article key={r.id}>
                        <FileVideo size={20} />
                        <div>
                          <b>{r.title}</b>
                          <small>
                            {d.episodes[r.episodeId]?.title} · {r.preset}
                          </small>
                        </div>
                        <button
                          className="st-button"
                          onClick={() => downloadManifest(r)}
                        >
                          Download manifest
                        </button>
                      </article>
                    ))}
                </div>
              </>
            ) : (
              <div className="st-library-grid">
                {assets.map((a) => (
                  <CommandMenu
                    ids={[
                      filter === "archive"
                        ? "library.restore"
                        : "library.archive",
                    ]}
                    key={a.id}
                    onSelect={() => {
                      if (!keys.includes(`asset:${a.id}`))
                        useSelection.getState().replace([`asset:${a.id}`]);
                    }}
                  >
                    <article
                      className={`st-media-card ${keys.includes(`asset:${a.id}`) ? "is-selected" : ""}`}
                      data-selection-key={`asset:${a.id}`}
                      aria-label={`Media ${a.title}`}
                      tabIndex={0}
                      onClick={(e) =>
                        useSelection.getState().choose(
                          `asset:${a.id}`,
                          assets.map((a) => `asset:${a.id}` as EntityKey),
                          e,
                        )
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter")
                          useSelection.getState().choose(
                            `asset:${a.id}`,
                            assets.map((a) => `asset:${a.id}` as EntityKey),
                            e,
                          );
                      }}
                    >
                      <div>
                        {a.kind === "image" && a.url && !a.missing ? (
                          <img src={a.url} alt="" loading="lazy" />
                        ) : a.kind === "audio" ? (
                          <Music size={25} />
                        ) : a.kind === "video" ? (
                          <FileVideo size={25} />
                        ) : (
                          <ImageIcon size={25} />
                        )}
                      </div>
                      <b>{a.title}</b>
                      <small>{a.provenance}</small>
                      <span>
                        {assetUsages(d, a.id).length} shots ·{" "}
                        {a.missing
                          ? "Needs update"
                          : a.kind === "video"
                            ? "Video"
                            : "Still"}
                      </span>
                    </article>
                  </CommandMenu>
                ))}
              </div>
            )}
          </SelectionSurface>
        </section>
        <aside
          className={`st-world-inspector ${showDetails ? "is-mobile-open" : ""}`}
        >
          <header>
            <b>Media inspector</b>
            <button
              className="st-icon st-mobile-details"
              aria-label="Close media inspector"
              onClick={() => setShowDetails(false)}
            >
              ×
            </button>
          </header>
          <div className="st-panel-scroll">
            {selected ? (
              <RegisteredInspectorSections
                type="asset"
                id={selected.id}
                projectId={projectId}
              />
            ) : (
              <section>
                <p className="st-muted">
                  Select media to inspect its source and usage.
                </p>
              </section>
            )}
          </div>
        </aside>
      </div>
      <input
        hidden
        ref={upload}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,audio/mpeg,audio/wav,audio/ogg"
        onChange={(e) => {
          for (const file of Array.from(e.target.files ?? [])) {
            if (file.size > CONFIG.maxUploadBytes) {
              useStore.getState().setNotice("Choose files under 20 MB.");
              continue;
            }
            const url = URL.createObjectURL(file);
            if (
              !commit(
                (data) =>
                  importWorkspaceAsset(
                    data,
                    projectId,
                    file.name,
                    file.type,
                    url,
                  ),
                "Media imported · session only",
              )
            )
              URL.revokeObjectURL(url);
          }
          e.target.value = "";
        }}
      />
    </div>
  );
}

function AssetDetails({ id, projectId }: { id: string; projectId: string }) {
  const d = useStore((s) => s.data),
    selected = d.assets[id],
    navigate = useNavigate(),
    usages = assetUsages(d, id);
  if (!selected) return null;
  return (
    <section>
      {selected.kind === "image" && selected.url ? (
        <img
          className="st-world-image"
          src={selected.url}
          alt="Selected media"
        />
      ) : selected.kind === "video" ? (
        <video src={selected.url} controls />
      ) : selected.kind === "audio" ? (
        <audio src={selected.url} controls />
      ) : null}
      <Field
        label="Media title"
        value={selected.title}
        onSave={(title) =>
          commit(
            (data) => renameWorkspaceAsset(data, selected.id, title),
            "Media renamed",
          )
        }
      />
      <h3>Origin</h3>
      <p className="st-muted">{selected.provenance}</p>
      <h3>Used in · {usages.length} shots</h3>
      {usages.map((s) => (
        <button
          className="st-appears-row"
          key={s.id}
          onClick={() =>
            navigate(
              `/projects/${projectId}/episodes/${d.scenes[s.sceneId].episodeId}?view=board&shot=${s.id}`,
            )
          }
        >
          <span>{s.title}</span>
          <ArrowUpRight size={13} />
        </button>
      ))}
    </section>
  );
}
registerInspector("asset", {
  id: "source",
  title: "Media & usage",
  render: (ctx) => <AssetDetails {...ctx} />,
});
