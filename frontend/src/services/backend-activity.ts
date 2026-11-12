import { backendJobObserver, type ObservationFailure } from "./job-observer";
import { interpretationWorkflow } from "./interpretation";
import { useStore } from "../stores/store";
import {
  recordObservedJob,
  terminalBackendJob,
  type ObservedJob,
} from "../domain/backend-jobs";
import {
  applyInterpretationJob,
  backendWorkspace,
  interpretationContext,
  type InterpretationRequest,
} from "../domain/interpretation";

/** App-owned watches keep Activity live even when its tray is collapsed.
 * Home shares the same observer; no HTTP polling is implemented here.
 */
export class BackendActivityService {
  private releases = new Map<string, () => void>();
  private owners = 0;
  private epoch = 0;
  private unsubscribe?: () => void;
  private releaseWorkflow?: () => void;
  private queued = false;
  private retrying = new Set<string>();
  start() {
    const epoch = this.epoch;
    this.owners += 1;
    if (this.owners === 1) {
      this.unsubscribe = useStore.subscribe(() => this.schedule());
      this.releaseWorkflow = interpretationWorkflow.observePage();
      this.sync();
    }
    let released = false;
    return () => {
      if (released || epoch !== this.epoch) return;
      released = true;
      if (--this.owners) return;
      this.unsubscribe?.();
      this.unsubscribe = undefined;
      for (const release of this.releases.values()) release();
      this.releases.clear();
      this.releaseWorkflow?.();
      this.releaseWorkflow = undefined;
    };
  }
  dispose() {
    this.epoch++;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    for (const release of this.releases.values()) release();
    this.releases.clear();
    this.releaseWorkflow?.();
    this.releaseWorkflow = undefined;
    this.owners = 0;
    this.retrying.clear();
    this.queued = false;
  }
  private schedule() {
    if (this.queued) return;
    this.queued = true;
    const epoch = this.epoch;
    queueMicrotask(() => {
      if (epoch !== this.epoch) return;
      this.queued = false;
      if (this.owners) this.sync();
    });
  }
  private sync() {
    let data = useStore.getState().data;
    const request = data.backend?.request;
    // Older saves may have a known current job but no Activity record yet.
    if (
      request?.jobId &&
      (request.operation ?? "interpret_request") === "interpret_request" &&
      data.backend?.jobs?.[request.jobId]?.request?.idempotencyKey !==
        request.idempotencyKey
    ) {
      useStore.getState().mutate((d) =>
        recordObservedJob(
          d,
          {
            id: request.jobId!,
            projectId: request.projectId ?? null,
            operation: request.operation ?? "interpret_request",
          },
          { request: interpretationContext(request), title: request.title },
        ),
      );
      data = useStore.getState().data;
    }
    const jobs = data.backend?.jobs ?? {};
    for (const [id, release] of this.releases) {
      const record = jobs[id];
      if (!record || terminalBackendJob(record.job?.status)) {
        release();
        this.releases.delete(id);
      }
    }
    for (const record of Object.values(jobs)) {
      if (
        this.releases.has(record.id) ||
        terminalBackendJob(record.job?.status)
      )
        continue;
      // Permanent observation failures remain stopped until a deliberate retry.
      if (record.observationError && !record.retryAt) continue;
      const release = backendJobObserver.watch(record, {
        onJob: (job) => {
          if (useStore.getState().data.backend?.request?.jobId === job.id)
            useStore
              .getState()
              .mutate((data) => applyInterpretationJob(data, job));
        },
        onError: (error) => this.applyObservationError(record.id, error),
      });
      this.releases.set(record.id, release);
    }
  }
  private applyObservationError(jobId: string, error: ObservationFailure) {
    const request = useStore.getState().data.backend?.request;
    if (request?.jobId !== jobId || request.phase === "paused") return;
    useStore.getState().mutate((data) => {
      const r = data.backend?.request;
      if (r?.jobId === jobId)
        Object.assign(r, {
          phase: error.temporary ? "polling" : "failed",
          error: error.message,
          errorCode: error.code,
          observationRetryAt: error.retryAt,
        });
    });
  }
  retryStatus(jobId: string) {
    useStore.getState().mutate((data) => {
      const record = data.backend?.jobs?.[jobId];
      if (record) {
        record.observationError = undefined;
        record.retryAt = undefined;
      }
    });
    this.sync();
    backendJobObserver.refresh(jobId);
    const request = useStore.getState().data.backend?.request;
    if (request?.jobId === jobId && request.phase === "failed")
      void interpretationWorkflow.retry();
  }
  /** Select an existing interpretation; Show never submits or spends credits. */
  show(jobId: string): boolean {
    const data = useStore.getState().data;
    const record = data.backend?.jobs?.[jobId];
    if (!record || record.operation !== "interpret_request") return false;
    const context = record.request ?? contextFromRecord(record);
    if (!context) return false;
    if (data.backend?.request && !data.backend.request.jobId) {
      useStore
        .getState()
        .setNotice(
          "Finish or retry the pending submission before opening another request.",
        );
      return false;
    }
    if (data.backend?.request?.jobId !== jobId) {
      interpretationWorkflow.dispose();
      useStore.getState().mutate((data) => {
        const request: InterpretationRequest = {
          ...context,
          operation: "interpret_request" as const,
          projectId: record.projectId,
          jobId: record.id,
          phase: "polling",
          jobStatus: record.job?.status,
        };
        backendWorkspace(data).request = request;
        if (record.job) applyInterpretationJob(data, record.job);
        if (
          record.observationError &&
          !record.retryAt &&
          !terminalBackendJob(record.job?.status)
        )
          Object.assign(request, {
            phase: "failed",
            error: record.observationError.message,
            errorCode: record.observationError.code,
          });
      });
    }
    if (!record.observationError) void interpretationWorkflow.resume();
    return true;
  }
  async retryGeneration(jobId: string) {
    if (this.retrying.has(jobId)) return;
    this.retrying.add(jobId);
    try {
      const record = useStore.getState().data.backend?.jobs?.[jobId];
      if (record?.job?.status !== "failed" || !this.show(jobId)) return;
      await interpretationWorkflow.retry();
    } finally {
      this.retrying.delete(jobId);
    }
  }
}
function contextFromRecord(record: ObservedJob) {
  const input = record.job?.input as { prompt?: unknown } | undefined;
  if (typeof input?.prompt !== "string") return undefined;
  return {
    operation: "interpret_request" as const,
    prompt: input.prompt,
    title: record.title || "Request interpretation",
    idempotencyKey: crypto.randomUUID(),
  };
}
export const backendActivity = new BackendActivityService();
