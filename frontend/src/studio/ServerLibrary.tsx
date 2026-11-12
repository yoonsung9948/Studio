import { uploadMedia, deleteMedia } from "../api/media";
import { useRef, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { FileVideo, ImageIcon, Music } from "lucide-react";
import { getAssetFileURL, type AssetFile, type Asset } from "../api/assets";
import { useOwnedData, useAssets, useAsset } from "../services/server-data";
import { LibraryCard, LibraryToolbar, mediaFilters } from "./LibraryComponents";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../components/ui/dialog";
import { ServerError } from "./ServerProjects";

export function SignedMedia({
  file,
  kind,
}: {
  file: AssetFile;
  kind: Asset["kind"];
}) {
  const { accountId } = useOwnedData()!;
  const media = useRef<HTMLMediaElement | null>(null),
    position = useRef({ time: 0, playing: false });
  const [failed, setFailed] = useState(false);
  const query = useQuery({
    queryKey: [accountId, "media-url", file.id],
    queryFn: ({ signal }) => {
      if (media.current)
        position.current = {
          time: media.current.currentTime,
          playing: !media.current.paused,
        };
      return getAssetFileURL(file.id, signal);
    },
    staleTime: 60000,
    gcTime: 0,
    refetchInterval: (query) =>
      query.state.data
        ? Math.max(
            1000,
            Date.parse(query.state.data.expiresAt) - Date.now() - 30000,
          )
        : false,
  });
  useEffect(() => {
    setFailed(false);
  }, [query.data?.url]);
  const ready = () => {
    if (media.current) {
      media.current.currentTime = position.current.time;
      if (position.current.playing) void media.current.play().catch(() => {});
    }
  };
  const onError = () => {
    if (query.data && Date.now() >= Date.parse(query.data.expiresAt) - 1000)
      void query.refetch();
    else setFailed(true);
  };
  if (query.isPending) return <p role="status">Loading media…</p>;
  if (query.error)
    return <ServerError error={query.error} retry={query.refetch} />;
  return (
    <div className="st-owned-media">
      {kind === "image" ? (
        <img src={query.data.url} alt="Selected media" onError={onError} />
      ) : kind === "video" ? (
        <video
          ref={media as React.RefObject<HTMLVideoElement>}
          src={query.data.url}
          controls
          preload="metadata"
          onLoadedMetadata={ready}
          onError={onError}
        />
      ) : (
        <audio
          ref={media as React.RefObject<HTMLAudioElement>}
          src={query.data.url}
          controls
          preload="metadata"
          onLoadedMetadata={ready}
          onError={onError}
        />
      )}
      {failed && <p role="alert">Media could not be loaded.</p>}
      <button
        className="st-text-button"
        onClick={() => {
          setFailed(false);
          void query.refetch();
        }}
      >
        Refresh media
      </button>
    </div>
  );
}
export function AssetThumbnail({
  id,
  kind,
}: {
  id: string;
  kind: Asset["kind"];
}) {
  const detail = useAsset(id),
    context = useOwnedData()!;
  const [failed, setFailed] = useState(false);
  const file =
    detail.data?.files.find((f) => f.role === "thumbnail") ??
    detail.data?.files.find((f) => f.role === "preview") ??
    detail.data?.files.find((f) => f.role === "original");
  const link = useQuery({
    queryKey: [context.accountId, "media-url", file?.id],
    queryFn: ({ signal }) => getAssetFileURL(file!.id, signal),
    enabled: !!file,
    staleTime: 60000,
    gcTime: 0,
    refetchInterval: (query) =>
      query.state.data
        ? Math.max(
            1000,
            Date.parse(query.state.data.expiresAt) - Date.now() - 30000,
          )
        : false,
  });
  useEffect(() => setFailed(false), [link.data?.url]);
  if (link.data && !failed && file?.contentType.startsWith("image/"))
    return (
      <img
        src={link.data.url}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  if (link.data && !failed && kind === "video")
    return (
      <video
        src={link.data.url}
        muted
        playsInline
        preload="metadata"
        onError={() => setFailed(true)}
      />
    );
  return kind === "video" ? (
    <FileVideo size={28} />
  ) : kind === "audio" ? (
    <Music size={28} />
  ) : (
    <ImageIcon size={28} />
  );
}

export function ServerAsset({ id }: { id: string }) {
  const query = useAsset(id),
    [downloadError, setDownloadError] = useState("");
  if (query.isPending) return <p role="status">Loading asset…</p>;
  if (query.error)
    return <ServerError error={query.error} retry={query.refetch} />;
  const asset = query.data,
    file =
      asset.files.find((file) => file.role === "preview") ??
      asset.files.find((file) => file.role === "original");
  const original = asset.files.find((file) => file.role === "original");
  const download = async () => {
    if (!original) return;
    try {
      const link = await getAssetFileURL(original.id);
      const anchor = document.createElement("a");
      anchor.href = link.url;
      anchor.download = `${asset.kind}.${original.contentType.split("/")[1] ?? "bin"}`;
      anchor.click();
    } catch (error) {
      setDownloadError(
        error instanceof Error
          ? error.message
          : "Download could not be started.",
      );
    }
  };
  return (
    <section aria-label="Asset details">
      <h2>{asset.kind[0].toUpperCase() + asset.kind.slice(1)}</h2>
      {file ? (
        <SignedMedia key={file.id} file={file} kind={asset.kind} />
      ) : (
        <p>No file is available.</p>
      )}
      <p>Created {new Date(asset.createdAt).toLocaleDateString()}</p>
      {original && (
        <button className="st-button" onClick={() => void download()}>
          Download original
        </button>
      )}
      {downloadError && <p role="alert">{downloadError}</p>}
    </section>
  );
}
export function ServerLibrary({
  compact = false,
  episodeId,
  allowedAssetIds,
}: {
  compact?: boolean;
  episodeId?: string;
  allowedAssetIds?: Set<string>;
}) {
  const { projectId } = useParams(),
    [params, setParams] = useSearchParams();
  const kind = (() => {
    const requested = params.get("kind");
    return requested && ["image", "video", "audio"].includes(requested)
      ? requested
      : "all";
  })();
  const query = useAssets(projectId, kind === "all" ? undefined : kind);
  const assets = (query.data?.pages.flatMap((page) => page.items) ?? []).filter(
      (asset) => !allowedAssetIds || allowedAssetIds.has(asset.id),
    ),
    selected =
      !allowedAssetIds || allowedAssetIds.has(params.get("asset") ?? "")
        ? params.get("asset")
        : null;
  const [search, setSearch] = useState("");
  const visibleAssets = assets.filter((asset) =>
    `${asset.kind} ${asset.id} ${new Date(asset.createdAt).toLocaleDateString()}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const openAsset = (id: string | null) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (id) next.set("asset", id);
      else next.delete("asset");
      return next;
    });
  return (
    <div className="library-page">
      <header className="library-heading library-owned-heading">
        <h1>{episodeId ? "Media" : compact ? "Recent media" : "Library"}</h1>
        <button
          className="st-button"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          Refresh media library
        </button>
        {compact && (
          <Link className="st-button" to="/library">
            Open library
          </Link>
        )}
      </header>
      {!compact && <ServerMediaActions projectId={projectId} />}
      {!compact && (
        <LibraryToolbar
          query={search}
          onQuery={setSearch}
          filter={kind}
          filters={mediaFilters.slice(0, 4)}
          onFilter={(kind) =>
            setParams((previous) => {
              const next = new URLSearchParams(previous);
              next.set("kind", kind);
              next.delete("asset");
              return next;
            })
          }
        />
      )}
      {query.isPending && <p role="status">Loading assets…</p>}
      {query.error && <ServerError error={query.error} retry={query.refetch} />}
      <div className="library-grid-wrap">
        <div className="library-grid">
          {visibleAssets.map((asset, index) => (
            <LibraryCard
              key={asset.id}
              title={`${asset.kind[0].toUpperCase() + asset.kind.slice(1)} · ${new Date(asset.createdAt).toLocaleDateString()}`}
              kind={asset.kind}
              category="Media"
              selected={selected === asset.id}
              onSelect={() => openAsset(asset.id)}
              onOpen={() => openAsset(asset.id)}
              openLabel={`Open ${asset.kind} ${index + 1}`}
              measureMedia={false}
              media={<AssetThumbnail id={asset.id} kind={asset.kind} />}
            />
          ))}
          {!visibleAssets.length && assets.length > 0 && (
            <div className="library-empty">
              <h2>No matching media</h2>
              <p>Try a media type, date, or asset ID.</p>
            </div>
          )}
        </div>
      </div>
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) openAsset(null);
        }}
      >
        <DialogContent className="st-dialog library-details">
          <DialogTitle>Media details</DialogTitle>
          {selected && <DeleteServerMedia id={selected} />}
          <DialogDescription>
            Preview or download your original media.
          </DialogDescription>
          {selected && <ServerAsset key={selected} id={selected} />}
        </DialogContent>
      </Dialog>
      {!query.isPending && !query.error && !assets.length && (
        <p className="st-empty">No media yet</p>
      )}
      {query.hasNextPage && (
        <button
          className="st-button"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? "Loading…" : "Load more assets"}
        </button>
      )}
    </div>
  );
}

export function ServerMediaActions({ projectId }: { projectId?: string }) {
  const context = useOwnedData()!;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = () =>
    void context.client.invalidateQueries({
      queryKey: [context.accountId, "assets"],
    });
  return (
    <div>
      <label>
        Upload media
        <input
          aria-label="Upload media"
          type="file"
          accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,audio/mpeg,audio/wav"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setBusy(true);
            setError("");
            void uploadMedia(file, crypto.randomUUID(), projectId)
              .then(refresh)
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
            e.target.value = "";
          }}
        />
      </label>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
export function DeleteServerMedia({ id }: { id: string }) {
  const context = useOwnedData()!;
  const [error, setError] = useState("");
  return (
    <>
      <button
        onClick={() => {
          if (window.confirm("Delete this unreferenced media file?"))
            void deleteMedia(id)
              .then(() =>
                context.client.invalidateQueries({
                  queryKey: [context.accountId, "assets"],
                }),
              )
              .catch((e) => setError(e.message));
        }}
      >
        Delete media
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
