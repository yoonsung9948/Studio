import { ApiError } from "../api/client";
import { create } from "zustand";
import { requestJSON } from "../api/client";
import { generateShot } from "../api/production";
import { jobSchema, type Job } from "../api/types";
import { z } from "zod";
import { useStore } from "../stores/store";
import { generationInputSnapshot } from "../domain/generation-inputs";
import { referenceSnapshot } from "../domain/scene-preflight";
import { backendJobObserver } from "./job-observer";
import { productionSync } from "./production-sync";
export const useShotJobs = create<Record<string, number>>(() => ({}));
const watches = new Map<string, () => void>();
const pending = new Map<string, { fingerprint: string; key: string }>();
function watch(job: Job, shotId: string) {
  if (watches.has(job.id) || !["queued", "running"].includes(job.status))
    return;
  useShotJobs.setState((s) => ({ ...s, [shotId]: (s[shotId] ?? 0) + 1 }));
  const stop = backendJobObserver.watch(
    { id: job.id, operation: job.operation, projectId: job.projectId },
    {
      onJob: (update) => {
        if (!["succeeded", "failed"].includes(update.status)) return;
        watches.get(job.id)?.();
        watches.delete(job.id);
        useShotJobs.setState((s) => ({
          ...s,
          [shotId]: Math.max(0, (s[shotId] ?? 1) - 1),
        }));
        if (update.error) useStore.getState().setNotice(update.error.message);
        const sync = productionSync();
        if (sync && job.projectId)
          void sync
            .flush()
            .then(() => sync.reload(job.projectId!))
            .catch(() => {});
      },
      onError: (e) => useStore.getState().setNotice(e.message),
    },
  );
  watches.set(job.id, stop);
}
export function clearShotWatches() {
  for (const stop of watches.values()) stop();
  watches.clear();
  pending.clear();
  useShotJobs.setState({}, true);
}
export async function resumeShotJobs(projectId: string, signal: AbortSignal) {
  const jobs = await requestJSON(
    `/projects/${projectId}/generations`,
    (v) => z.array(z.object({ shotId: z.string(), job: jobSchema })).parse(v),
    { signal },
  );
  if (!signal.aborted) for (const item of jobs) watch(item.job, item.shotId);
}
export async function generateShotBatch(
  ids: string[],
  kind: "image" | "video",
  count = 1,
) {
  const sync = productionSync();
  if (!sync) throw Error("Production is not connected");
  await sync.ready();
  if (productionSync() !== sync)
    throw new DOMException("Workspace changed", "AbortError");
  const data = useStore.getState().data;
  for (const id of ids) {
    const shot = data.shots[id];
    const projectId =
      data.episodes[data.scenes[shot.sceneId].episodeId].projectId;
    const snapshot = generationInputSnapshot(data, id, kind);
    const assetId = (id: string) => {
      const a = data.assets[id];
      if (!a?.serverAssetId)
        throw Error("Upload this reference before generating");
      return a.serverAssetId;
    };
    const references: { assetId: string; role: string }[] = [];
    for (const reference of referenceSnapshot(data, id)) {
      for (const versionId of [
        reference.identityVersionId,
        reference.lookVersionId,
        ...reference.referenceVersionIds,
      ].filter((v): v is string => !!v)) {
        const version = data.studio.versions[versionId];
        if (version)
          references.push({
            assetId: assetId(version.assetId),
            role: "identity",
          });
      }
    }
    for (const ref of snapshot.referenceInputs) {
      if (!["visual_style", "setting", "continuity"].includes(ref.purpose))
        throw Error("This provider does not support that reference role yet");
      references.push({ assetId: assetId(ref.assetId), role: ref.purpose });
    }
    if (snapshot.locationAssetId)
      references.push({
        assetId: assetId(snapshot.locationAssetId),
        role: "setting",
      });
    const unique = references.filter(
      (ref, i) =>
        references.findIndex(
          (r) => r.assetId === ref.assetId && r.role === ref.role,
        ) === i,
    );
    if (
      kind === "video" &&
      (unique.length ||
        snapshot.startingFrameAssetId ||
        snapshot.endingFrameAssetId)
    )
      throw Error(
        "Video conditioning needs the H3 adapter; the current fake video provider supports text only.",
      );
    const body = {
      kind,
      count,
      snapshot,
      referenceSnapshots: referenceSnapshot(data, id),
      prompt: snapshot.instructions || shot.action || shot.title,
      references: unique,
      aspectRatio: snapshot.aspectRatio,
      durationSeconds: Math.round(shot.targetFrames / 30),
    };
    const fingerprint = JSON.stringify(body);
    const identity = `${projectId}:${id}:${kind}`;
    let request = pending.get(identity);
    if (request && request.fingerprint !== fingerprint)
      throw Error(
        "The previous submission is uncertain. Retry with the same settings before starting another generation.",
      );
    if (!request) {
      request = { fingerprint, key: crypto.randomUUID() };
      pending.set(identity, request);
    }
    try {
      const result = await generateShot(projectId, id, body, request.key);
      pending.delete(identity);
      for (const job of result.jobs) watch(job, id);
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500
      )
        pending.delete(identity);
      throw error;
    }
  }
  useStore
    .getState()
    .setNotice("Generation submitted. Results will appear as candidates.");
}
