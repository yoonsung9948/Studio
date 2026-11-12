import { productionSync } from "./production-sync";
import { generationInputs } from "../domain/generation-inputs";
import { useStore } from "../stores/store";
import { CONFIG, uid } from "../domain/types";
import { tick } from "../domain/commands";
import { shotsOfEpisode } from "../domain/selectors";
import type {
  GenerationService,
  DirectorService,
  ExportService,
} from "./contracts";
export const generationService: GenerationService = {
  reportProgress(jobId, progress) {
    useStore.getState().mutate((d) => {
      const j = d.jobs[jobId];
      if (j?.state === "running")
        j.progress =
          progress === null ? null : Math.max(0, Math.min(100, progress));
    });
  },
  start() {
    const interval = setInterval(() => {
      const s = useStore.getState();
      if (
        !productionSync() &&
        !s.paused &&
        Object.values(s.data.jobs).some((j) =>
          ["queued", "waiting", "running"].includes(j.state),
        )
      )
        s.mutate(tick);
    }, CONFIG.tickMs);
    return () => clearInterval(interval);
  },
  resume() {
    useStore.getState().resume();
  },
};
export const directorService: DirectorService = {
  async respond(_scope, text, signal) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 500);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new DOMException("Stopped", "AbortError"));
        },
        { once: true },
      );
    });
    return text;
  },
};
export const exportService: ExportService = {
  async create(data, id, options) {
    await new Promise((r) => setTimeout(r, 1000));
    const ep = data.episodes[id];
    const first = shotsOfEpisode(data, id)[0];
    const aspect = first
      ? generationInputs(data, first.sceneId, first.id).aspectRatio
      : "16:9";
    return {
      id: uid("export"),
      episodeId: id,
      timelineVersion: ep.timelineVersion,
      ...options,
      createdAt: Date.now(),
      manifest: JSON.stringify(
        {
          format: "dotori-studio-timeline-v1",
          demo: true,
          rendered: false,
          media: "Still-image animatic placeholders",
          episode: { id, title: ep.title, targetSeconds: ep.targetSeconds },
          timelineVersion: ep.timelineVersion,
          fps: 30,
          aspectRatio: aspect,
          dimensions:
            aspect === "16:9"
              ? [1920, 1080]
              : aspect === "9:16"
                ? [1080, 1920]
                : [1080, 1080],
          options,
          shots: shotsOfEpisode(data, id).map((s) => ({
            id: s.id,
            sceneId: s.sceneId,
            inFrame: s.inFrame,
            outFrame: s.outFrame,
            take: s.currentTakeId ? data.takes[s.currentTakeId] : null,
            asset: s.currentTakeId
              ? data.assets[data.takes[s.currentTakeId].assetId]
              : null,
          })),
        },
        null,
        2,
      ),
    };
  },
};
export function downloadManifest(record: { title: string; manifest: string }) {
  const url = URL.createObjectURL(
    new Blob([record.manifest], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `${record.title.replace(/[^a-z0-9]/gi, "-")}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
