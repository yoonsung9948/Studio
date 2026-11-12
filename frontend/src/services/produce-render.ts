import { productionSync } from "./production-sync";
import { uploadMedia } from "../api/media";
import { getAssetFileURL } from "../api/assets";
import { create } from "zustand";
import { uid } from "../domain/types";
import { renderSnapshot } from "../domain/cut";
import { useStore, currentWorkspaceEpoch } from "../stores/store";
import { renderCut } from "./cut-renderer";
import { saveMediaBlob, loadMediaBlob } from "./media-storage";

export const useRender = create<{
  episodeId?: string;
  progress: number;
  running: boolean;
  error?: string;
  cancel?: () => void;
}>(() => ({ progress: 0, running: false }));

export async function startProduceRender(episodeId: string) {
  if (useRender.getState().running) return;
  const epoch = currentWorkspaceEpoch(),
    snapshot = renderSnapshot(useStore.getState().data, episodeId);
  const controller = new AbortController();
  useRender.setState({
    episodeId,
    running: true,
    progress: 0,
    error: undefined,
    cancel: () => controller.abort(),
  });
  const unsubscribe = useStore.subscribe(() => {
    if (currentWorkspaceEpoch() !== epoch) controller.abort();
  });
  try {
    const blob = await renderCut(snapshot, {
      signal: controller.signal,
      onProgress: (progress) => useRender.setState({ progress }),
    });
    let assetId = uid("render");
    const remote = productionSync()
      ? await uploadMedia(
          blob,
          crypto.randomUUID(),
          useStore.getState().data.episodes[episodeId].projectId,
        )
      : undefined;
    if (remote) assetId = remote.id;
    const id = uid("export");
    if (!remote) await saveMediaBlob(assetId, blob);
    if (currentWorkspaceEpoch() !== epoch || controller.signal.aborted) return;
    const url = remote
      ? (
          await getAssetFileURL(
            remote.files.find((f) => f.role === "original")!.id,
          )
        ).url
      : URL.createObjectURL(blob);
    useStore.getState().mutate((data) => {
      data.assets[assetId] = {
        id: assetId,
        projectId: data.episodes[episodeId].projectId,
        title: `${snapshot.title} · Cut v${snapshot.revision}`,
        kind: "video",
        url,
        sessionOnly: !remote,
        storedBlob: !remote,
        serverAssetId: remote?.id,
        provenance:
          "Rendered from the selected cut, including audio and captions.",
      };
      data.exports[id] = {
        id,
        episodeId,
        timelineVersion: snapshot.revision,
        title: snapshot.title,
        preset: blob.type.startsWith("video/mp4") ? "1080p MP4" : "1080p WebM",
        captions: snapshot.captions,
        description: "Final video",
        draft: false,
        createdAt: Date.now(),
        outputAssetId: assetId,
        manifest: JSON.stringify({ ...snapshot, rendered: true }),
      };
      const episode = data.episodes[episodeId];
      episode.mediaAssetIds = [
        ...new Set([...(episode.mediaAssetIds ?? []), assetId]),
      ];
    });
    useStore.getState().setNotice("Final video rendered. Ready to download.");
  } catch (error) {
    if (currentWorkspaceEpoch() === epoch)
      useRender.setState({
        error:
          error instanceof DOMException && error.name === "AbortError"
            ? "Render canceled. Your cut is saved."
            : error instanceof Error
              ? error.message
              : "Rendering failed. Retry.",
      });
  } finally {
    unsubscribe();
    useRender.setState({ running: false, cancel: undefined });
  }
}

export async function restoreStoredMedia() {
  const epoch = currentWorkspaceEpoch();
  const missing = Object.values(useStore.getState().data.assets).filter(
    (asset) => asset.storedBlob && (asset.missing || !asset.url),
  );
  await Promise.all(
    missing.map(async (asset) => {
      try {
        const blob = await loadMediaBlob(asset.id);
        if (!blob?.size || currentWorkspaceEpoch() !== epoch) return;
        const url = URL.createObjectURL(blob);
        useStore.getState().mutate((data) => {
          const current = data.assets[asset.id];
          if (current) {
            current.url = url;
            current.missing = false;
          }
        });
      } catch {
        /* Keep the existing missing-media state and allow reattachment. */
      }
    }),
  );
}
