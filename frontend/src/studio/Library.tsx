import {
  episodeMediaAssetIds,
  attachEpisodeMedia,
} from "../domain/episode-resources";
import { useOwnedData } from "../services/server-data";
import { ServerLibrary } from "./ServerLibrary";
import { SelectionSurface } from "./SelectionSurface";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowUpRight, FileVideo, Music, ImageIcon } from "lucide-react";
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
import { LibraryCard, LibraryToolbar } from "./LibraryComponents";
import { describeLibraryAsset } from "./library-media";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../components/ui/dialog";
import { useActions } from "../components/Actions";
export function LibraryWorkspace() {
  const owned = useOwnedData();
  const { projectId, episodeId: routeEpisodeId } = useParams();
  const [params] = useSearchParams();
  const data = useStore((state) => state.data);
  const episodeId = routeEpisodeId ?? params.get("episode") ?? undefined;
  const episode = data.episodes[episodeId ?? ""];
  if (
    episodeId &&
    (!episode ||
      episode.archived ||
      episode.projectId !== projectId ||
      !data.projects[projectId ?? ""]?.episodeIds.includes(episodeId))
  )
    return <div className="st-empty">Episode unavailable.</div>;
  return owned ? (
    <ServerLibrary
      episodeId={episodeId}
      allowedAssetIds={
        episodeId ? episodeMediaAssetIds(data, episodeId) : undefined
      }
    />
  ) : (
    <LocalLibraryWorkspace />
  );
}
function LocalLibraryWorkspace() {
  const { projectId = "", episodeId: routeEpisodeId } = useParams(),
    d = useStore((s) => s.data),
    keys = useSelection((s) => s.keys),
    modal = useActions(),
    [params, setParams] = useSearchParams(),
    [query, setQuery] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [scope, setScope] = useState("");
  const availableProjects = Object.values(d.projects).filter(
    (p) => !p.archived && !p.unfiled,
  );
  const activeProject = projectId || scope;
  const episodeId = routeEpisodeId ?? params.get("episode") ?? undefined;
  const episode = d.episodes[episodeId ?? ""];
  const episodeAssets = episodeId
    ? episodeMediaAssetIds(d, episodeId)
    : undefined;
  const upload = useRef<HTMLInputElement>(null);
  const filter = params.get("filter") ?? "all";
  const assets = Object.values(d.assets).filter(
    (a) =>
      (!activeProject || a.projectId === activeProject) &&
      (!episodeAssets || episodeAssets.has(a.id)) &&
      (filter === "archive" ? a.archived : !a.archived) &&
      (filter === "all" || filter === "archive" || a.kind === filter) &&
      a.title.toLowerCase().includes(query.toLowerCase()),
  );
  const selected = keys.at(-1)?.startsWith("asset:")
    ? assets.find((asset) => asset.id === keys.at(-1)!.slice(6))
    : undefined;
  useEffect(() => useSelection.getState().replace([]), [projectId, episodeId]);
  const commands = useMemo<StudioCommand[]>(
    () => [
      {
        id: "library.upload",
        label: "Upload media",
        run: () => {
          if (activeProject) upload.current?.click();
        },
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
    [activeProject],
  );
  useRegisterCommands("library", commands);
  if (projectId && !d.projects[projectId])
    return <div className="st-empty">Project unavailable</div>;
  return (
    <div className="library-page">
      <header className="library-heading">
        <h1>{episodeId ? "Media" : "Library"}</h1>
        {episode && (
          <p className="st-muted">
            {d.projects[episode.projectId].title} / {episode.title}
          </p>
        )}
      </header>
      <div className="library-layout">
        <section className="library-main">
          {!projectId && (
            <label className="ds-library-scope">
              Production
              <select
                aria-label="Library production"
                value={scope}
                onChange={(e) => {
                  setScope(e.target.value);
                  useSelection.getState().replace([]);
                }}
              >
                <option value="">All productions</option>
                {availableProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <LibraryToolbar
            query={query}
            onQuery={setQuery}
            filter={filter}
            onFilter={(filter) => {
              setParams((previous) => {
                const next = new URLSearchParams(previous);
                next.set("filter", filter);
                return next;
              });
            }}
            onUpload={() => upload.current?.click()}
            uploadDisabled={!activeProject}
            uploadHint={
              !activeProject
                ? "Choose a production before uploading"
                : undefined
            }
          />
          <SelectionSurface
            className="library-grid-wrap"
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
                    {Object.values(d.episodes)
                      .filter(
                        (ep) =>
                          !ep.archived &&
                          (!episodeId || ep.id === episodeId) &&
                          (!activeProject || ep.projectId === activeProject),
                      )
                      .map(({ id }) => (
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
                        (!episodeId || r.episodeId === episodeId) &&
                        (!activeProject ||
                          d.episodes[r.episodeId]?.projectId ===
                            activeProject) &&
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
              <div className="library-grid">
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
                    <LibraryCard
                      title={a.title}
                      kind={a.kind}
                      {...describeLibraryAsset(d, a)}
                      missing={a.missing}
                      selected={keys.includes(`asset:${a.id}`)}
                      selectionKey={`asset:${a.id}`}
                      onSelect={(event) =>
                        useSelection.getState().choose(
                          `asset:${a.id}`,
                          assets.map(
                            (asset) => `asset:${asset.id}` as EntityKey,
                          ),
                          event,
                        )
                      }
                      onOpen={() => {
                        useSelection.getState().replace([`asset:${a.id}`]);
                        setShowDetails(true);
                      }}
                      archived={a.archived}
                      onArchive={() =>
                        commit(
                          (data) =>
                            archiveWorkspaceAssets(data, [a.id], !a.archived),
                          a.archived
                            ? "Media restored"
                            : "Media archived · Undo to restore",
                        )
                      }
                      media={
                        a.url && !a.missing ? (
                          a.kind === "image" ? (
                            <img src={a.url} alt="" loading="lazy" />
                          ) : a.kind === "video" ? (
                            <video
                              src={a.url}
                              muted
                              playsInline
                              preload="metadata"
                            />
                          ) : (
                            <Music size={40} />
                          )
                        ) : (
                          <ImageIcon size={40} />
                        )
                      }
                    />
                  </CommandMenu>
                ))}
                {!assets.length && (
                  <div className="library-empty">
                    <ImageIcon size={32} />
                    <h2>
                      {query
                        ? "No matching media"
                        : filter === "archive"
                          ? "No archived media"
                          : "No media yet"}
                    </h2>
                    <p>
                      {query
                        ? "Try another search or media type."
                        : "Upload media or generate a starting frame to build your library."}
                    </p>
                  </div>
                )}
              </div>
            )}
          </SelectionSurface>
        </section>
      </div>
      <Dialog open={showDetails && !!selected} onOpenChange={setShowDetails}>
        <DialogContent className="st-dialog library-details">
          <DialogTitle>{selected?.title ?? "Media details"}</DialogTitle>
          <DialogDescription>
            Preview, rename, and find where this media is used.
          </DialogDescription>
          {selected && (
            <RegisteredInspectorSections
              type="asset"
              id={selected.id}
              projectId={selected.projectId}
            />
          )}
        </DialogContent>
      </Dialog>
      <input
        hidden
        ref={upload}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,audio/mpeg,audio/wav,audio/ogg"
        onChange={(e) => {
          if (!activeProject) return;
          for (const file of Array.from(e.target.files ?? [])) {
            if (file.size > CONFIG.maxUploadBytes) {
              useStore.getState().setNotice("Choose files under 20 MB.");
              continue;
            }
            const url = URL.createObjectURL(file);
            if (
              !commit((data) => {
                const id = importWorkspaceAsset(
                  data,
                  activeProject,
                  file.name,
                  file.type,
                  url,
                );
                if (episodeId) attachEpisodeMedia(data, episodeId, id);
              }, "Media imported · session only")
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
  const { episodeId: routeEpisodeId } = useParams();
  const [params] = useSearchParams();
  const episodeId = routeEpisodeId ?? params.get("episode");
  const d = useStore((s) => s.data),
    selected = d.assets[id],
    navigate = useNavigate(),
    usages = assetUsages(d, id).filter(
      (shot) => !episodeId || d.scenes[shot.sceneId]?.episodeId === episodeId,
    );
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
