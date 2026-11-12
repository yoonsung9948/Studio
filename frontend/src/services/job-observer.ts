import { ApiError } from "../api/client";
import { getJob } from "../api/jobs";
import type { JobDetail } from "../api/types";
import {
  observationBackoff,
  recordObservedJob,
  temporaryObservationFailure,
  terminalBackendJob,
  type JobIdentity,
} from "../domain/backend-jobs";
import { useStore } from "../stores/store";

export interface ObservationFailure {
  code: string;
  message: string;
  temporary: boolean;
  retryAt?: number;
}
interface Listener {
  onJob(job: JobDetail): void;
  onError(error: ObservationFailure): void;
}
interface Entry {
  identity: JobIdentity;
  listeners: Set<Listener>;
  controller?: AbortController;
  timer?: ReturnType<typeof setTimeout>;
  failures: number;
  terminal: boolean;
  blocked: boolean;
}
/** The only backend status poller. Watches are shared by job ID and reference
 * counted: the last unsubscribe aborts GET and clears timers, never server work.
 */
export class BackendJobObserver {
  private entries = new Map<string, Entry>();
  private listening = false;
  private pageHidden = false;
  private readonly pollMs: number;
  private readonly backoffMs: number;
  private readonly maxBackoffMs: number;
  constructor(
    options: {
      pollMs?: number;
      backoffMs?: number;
      maxBackoffMs?: number;
    } = {},
  ) {
    this.pollMs = options.pollMs ?? 1000;
    this.backoffMs = options.backoffMs ?? 1000;
    this.maxBackoffMs = options.maxBackoffMs ?? 30000;
  }
  watch(identity: JobIdentity, listener: Listener): () => void {
    let entry = this.entries.get(identity.id);
    if (
      entry &&
      (entry.identity.projectId !== identity.projectId ||
        entry.identity.operation !== identity.operation)
    )
      throw new Error("Conflicting job identity.");
    if (!entry) {
      const saved = useStore.getState().data.backend?.jobs?.[identity.id];
      if (
        saved &&
        (saved.projectId !== identity.projectId ||
          saved.operation !== identity.operation)
      )
        throw new Error("Conflicting saved job identity.");
      entry = {
        identity,
        listeners: new Set(),
        failures: 0,
        terminal: terminalBackendJob(saved?.job?.status),
        blocked: false,
      };
      this.entries.set(identity.id, entry);
      useStore.getState().mutate((data) => recordObservedJob(data, identity));
    }
    const current = entry;
    // Each watch owns a distinct subscription, even if callbacks are reused.
    const subscription = { ...listener };
    current.listeners.add(subscription);
    this.bind();
    if (current.terminal) {
      const job = useStore.getState().data.backend?.jobs?.[identity.id]?.job;
      queueMicrotask(() => {
        if (job && current.listeners.has(subscription)) subscription.onJob(job);
      });
    } else if (
      !current.controller &&
      !current.timer &&
      !current.blocked &&
      !this.pageHidden
    )
      void this.poll(current);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      current.listeners.delete(subscription);
      if (
        !current.listeners.size &&
        this.entries.get(identity.id) === current
      ) {
        this.stop(current);
        this.entries.delete(identity.id);
        if (!this.entries.size) this.unbind();
      }
    };
  }
  /** Explicit refresh during backoff, or on focus; never repeats a POST. */
  refresh(jobId?: string) {
    for (const entry of this.entries.values()) {
      if (jobId && entry.identity.id !== jobId) continue;
      if (entry.terminal || entry.controller || this.pageHidden) continue;
      // Focus does not automatically retry authorization/validation failures.
      if (entry.blocked && !jobId) continue;
      clearTimeout(entry.timer);
      entry.timer = undefined;
      entry.blocked = false;
      void this.poll(entry);
    }
  }
  dispose() {
    for (const entry of this.entries.values()) this.stop(entry);
    this.entries.clear();
    this.unbind();
  }
  private active(entry: Entry) {
    return (
      this.entries.get(entry.identity.id) === entry && !!entry.listeners.size
    );
  }
  private stop(entry: Entry) {
    clearTimeout(entry.timer);
    entry.timer = undefined;
    entry.controller?.abort();
    entry.controller = undefined;
  }
  private save(entry: Entry, patch: Parameters<typeof recordObservedJob>[2]) {
    useStore
      .getState()
      .mutate((data) => recordObservedJob(data, entry.identity, patch));
  }
  private async poll(entry: Entry) {
    if (
      !this.active(entry) ||
      entry.controller ||
      entry.terminal ||
      this.pageHidden
    )
      return;
    const controller = new AbortController();
    entry.controller = controller;
    let job: JobDetail | undefined;
    let issue: ObservationFailure | undefined;
    try {
      job = await getJob(entry.identity.id, controller.signal);
      if (
        job.id !== entry.identity.id ||
        job.projectId !== entry.identity.projectId ||
        job.operation !== entry.identity.operation
      )
        throw new ApiError(
          200,
          "job_mismatch",
          "The API returned a different job.",
        );
    } catch (error) {
      if (controller.signal.aborted || !this.active(entry)) return;
      const temporary =
        error instanceof ApiError && temporaryObservationFailure(error);
      entry.failures += 1;
      issue = {
        code: error instanceof ApiError ? error.code : "observation_error",
        message:
          error instanceof Error
            ? error.message
            : "Could not check job status.",
        temporary,
        retryAt: temporary
          ? Date.now() +
            observationBackoff(
              entry.failures,
              this.backoffMs,
              this.maxBackoffMs,
            )
          : undefined,
      };
    } finally {
      if (entry.controller === controller) entry.controller = undefined;
    }
    if (controller.signal.aborted || !this.active(entry)) return;
    if (issue) {
      entry.blocked = !issue.temporary;
      this.save(entry, {
        observationError: { code: issue.code, message: issue.message },
        retryAt: issue.retryAt,
        consecutiveFailures: entry.failures,
      });
      for (const listener of [...entry.listeners]) listener.onError(issue);
      if (issue.temporary && this.active(entry))
        this.schedule(entry, Math.max(0, issue.retryAt! - Date.now()));
    } else if (job) {
      entry.failures = 0;
      entry.blocked = false;
      entry.terminal = terminalBackendJob(job.status);
      this.save(entry, {
        job,
        observationError: undefined,
        retryAt: undefined,
        consecutiveFailures: 0,
      });
      for (const listener of [...entry.listeners]) listener.onJob(job);
      if (!entry.terminal && this.active(entry))
        this.schedule(entry, this.pollMs);
    }
  }
  private schedule(entry: Entry, ms: number) {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      void this.poll(entry);
    }, ms);
  }
  private readonly onFocus = () => {
    if (document.visibilityState !== "hidden") this.refresh();
  };
  private readonly onPageHide = () => {
    this.pageHidden = true;
    for (const entry of this.entries.values()) this.stop(entry);
  };
  private readonly onPageShow = () => {
    this.pageHidden = false;
    this.onFocus();
  };
  private bind() {
    if (this.listening || typeof window === "undefined") return;
    this.listening = true;
    this.pageHidden = false;
    window.addEventListener("focus", this.onFocus);
    document.addEventListener("visibilitychange", this.onFocus);
    window.addEventListener("pagehide", this.onPageHide);
    window.addEventListener("pageshow", this.onPageShow);
  }
  private unbind() {
    if (!this.listening) return;
    window.removeEventListener("focus", this.onFocus);
    document.removeEventListener("visibilitychange", this.onFocus);
    window.removeEventListener("pagehide", this.onPageHide);
    window.removeEventListener("pageshow", this.onPageShow);
    this.listening = false;
  }
}
export const backendJobObserver = new BackendJobObserver();
