import { BackendJobObserver, backendJobObserver } from "./job-observer";
import {
  recordObservedJob,
  terminalBackendJob,
  type JobIdentity,
} from "../domain/backend-jobs";
import { createProject } from "../api/projects";
import { submitRequest } from "../api/requests";
import { ApiError } from "../api/client";
import { projectSchema, type Job } from "../api/types";
import {
  backendWorkspace,
  interpretationPending,
  applyInterpretationJob,
  interpretationContext,
  type InterpretationRequest,
} from "../domain/interpretation";
import { useStore } from "../stores/store";

/** Coordinates API calls; all persistent workflow changes use the domain boundary.
 * One interpretation at a time. Polling never overlaps; transport retries keep
 * the same submission key, and only a new user request creates a new job.
 */
export class InterpretationWorkflow {
  private controller?: AbortController;
  private pageOwners = 0;
  constructor(
    private readonly observer: BackendJobObserver = backendJobObserver,
  ) {}
  /** Page lifetime owns observation. Closing a reply does not close the page. */
  observePage() {
    this.pageOwners += 1;
    void this.resume();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--this.pageOwners === 0) this.dispose();
    };
  }
  private current() {
    return useStore.getState().data.backend?.request;
  }
  private patch(patch: Partial<InterpretationRequest>, key: string) {
    useStore.getState().mutate((data) => {
      const r = data.backend?.request;
      if (r?.idempotencyKey === key) Object.assign(r, patch);
    });
  }
  async start(input: {
    prompt: string;
    projectId?: string | null;
    title?: string;
    sourceProjectId?: string;
    creationKind?: "episode" | "scene" | "shot";
    durationSeconds?: number;
  }) {
    if (this.controller || interpretationPending(this.current())) return;
    const prompt = input.prompt.trim();
    if (!prompt || [...prompt].length > 10000)
      throw new Error("Enter a prompt of 1–10,000 characters.");
    if (input.projectId) projectSchema.shape.id.parse(input.projectId);
    const title =
      input.title?.trim() ||
      Array.from(prompt.replace(/\s+/g, " ")).slice(0, 80).join("");
    const request: InterpretationRequest = {
      operation: "interpret_request",
      prompt,
      title,
      projectId: input.projectId,
      sourceProjectId: input.sourceProjectId,
      creationKind: input.creationKind,
      durationSeconds: input.durationSeconds,
      idempotencyKey: crypto.randomUUID(),
      phase:
        !input.projectId && input.sourceProjectId ? "creating" : "submitting",
    };
    useStore.getState().mutate((data) => {
      backendWorkspace(data).request = request;
    });
    await this.run();
  }
  /** Resume only a known job. An uncertain POST requires deliberate replay. */
  async resume() {
    const r = this.current();
    if (this.controller || !r || !interpretationPending(r)) return;
    if (!r.projectId && r.sourceProjectId) {
      this.patch(
        {
          phase: "failed",
          errorCode: "project_interrupted",
          error:
            "Project creation was interrupted before its ID was saved. Start a new interpretation.",
        },
        r.idempotencyKey,
      );
      return;
    }
    if (!r.jobId) {
      this.patch(
        {
          phase: "failed",
          errorCode: "submission_uncertain",
          error:
            "Submission confirmation was interrupted. Retry to check the same request.",
        },
        r.idempotencyKey,
      );
      return;
    }
    await this.run();
  }
  async retry() {
    const r = this.current();
    if (!r) return;
    if (r.jobId && r.phase === "polling") {
      this.observer.refresh(r.jobId);
      return;
    }
    if (this.controller || interpretationPending(r)) return;
    if (
      r.jobStatus === "failed" ||
      (!r.projectId && !!r.sourceProjectId) ||
      (!!r.operation && r.operation !== "interpret_request")
    ) {
      await this.start({
        prompt: r.prompt,
        title: r.title,
        projectId: r.projectId,
        sourceProjectId: r.sourceProjectId,
        creationKind: r.creationKind,
        durationSeconds: r.durationSeconds,
      });
    } else await this.run();
  }
  stopChecking() {
    const r = this.current();
    if (!r || !this.controller) return;
    this.controller.abort();
    this.patch({ phase: "paused" }, r.idempotencyKey);
  }
  dispose() {
    this.controller?.abort();
    this.controller = undefined;
  }
  private async run() {
    if (this.controller) return;
    const r = this.current();
    if (!r) return;
    const key = r.idempotencyKey,
      controller = new AbortController(),
      signal = controller.signal;
    this.controller = controller;
    try {
      if (r.operation && r.operation !== "interpret_request") {
        this.patch(
          {
            phase: "failed",
            errorCode: "retired_operation",
            error:
              "This saved request used a retired workflow. Submit a new request.",
          },
          key,
        );
        return;
      }
      const operation = "interpret_request";
      let projectId = r.projectId;
      if (!projectId && r.sourceProjectId) {
        this.patch(
          { phase: "creating", error: undefined, errorCode: undefined },
          key,
        );
        const project = await createProject({ title: r.title }, signal);
        if (signal.aborted) return;
        projectId = project.id;
        useStore.getState().mutate((data) => {
          const workspace = backendWorkspace(data);
          workspace.projects[project.id] = project;
          if (r.sourceProjectId)
            (workspace.projectLinks ??= {})[r.sourceProjectId] = project.id;
          if (workspace.request?.idempotencyKey === key)
            workspace.request.projectId = project.id;
        });
      }
      if (!r.jobId) {
        this.patch(
          { phase: "submitting", error: undefined, errorCode: undefined },
          key,
        );
        const accepted = await submitRequest(
          { projectId, prompt: r.prompt },
          key,
          signal,
        );
        if (signal.aborted) return;
        const { job, request } = accepted;
        if (
          request.interpretationJobId !== job.id ||
          request.projectId !== (projectId ?? null) ||
          job.projectId !== (projectId ?? null) ||
          job.operation !== operation
        )
          throw new Error("The API returned a job for a different request.");
        this.patch(
          {
            requestId: request.id,
            jobId: job.id,
            phase: "polling",
            jobStatus: job.status,
          },
          key,
        );
        useStore.getState().mutate((data) =>
          recordObservedJob(
            data,
            {
              id: job.id,
              projectId: job.projectId,
              operation: job.operation,
            },
            {
              title: r.title,
              request: interpretationContext({ ...r, requestId: request.id }),
            },
          ),
        );
      } else
        this.patch(
          {
            phase: "polling",
            error: undefined,
            errorCode: undefined,
            observationRetryAt: undefined,
          },
          key,
        );
      const jobId = this.current()?.jobId;
      if (!jobId) throw new Error("The API did not return a job ID.");
      await this.observe(
        { id: jobId, projectId: projectId ?? null, operation },
        key,
        signal,
      );
    } catch (error) {
      if (!signal.aborted)
        this.patch(
          {
            phase: "failed",
            error:
              error instanceof Error
                ? error.message
                : "Interpretation could not be completed.",
            errorCode:
              error instanceof ApiError ? error.code : "invalid_result",
          },
          key,
        );
    } finally {
      if (this.controller === controller) this.controller = undefined;
    }
  }
  private observe(identity: JobIdentity, key: string, signal: AbortSignal) {
    return new Promise<void>((resolve) => {
      let release = () => {};
      const finish = () => {
        release();
        signal.removeEventListener("abort", finish);
        resolve();
      };
      signal.addEventListener("abort", finish, { once: true });
      release = this.observer.watch(identity, {
        onJob: (job) => {
          try {
            this.accept(job, key);
          } catch (error) {
            this.patch(
              {
                phase: "failed",
                errorCode: "invalid_result",
                error:
                  error instanceof Error
                    ? error.message
                    : "Unsupported job result.",
              },
              key,
            );
            finish();
            return;
          }
          if (terminalBackendJob(job.status)) finish();
        },
        onError: (error) => {
          this.patch(
            {
              phase: error.temporary ? "polling" : "failed",
              error: error.message,
              errorCode: error.code,
              observationRetryAt: error.retryAt,
            },
            key,
          );
          if (!error.temporary) finish();
        },
      });
      if (signal.aborted) finish();
    });
  }
  private accept(job: Job, key: string) {
    useStore.getState().mutate((data) => {
      if (data.backend?.request?.idempotencyKey === key)
        applyInterpretationJob(data, job);
    });
  }
}
export const interpretationWorkflow = new InterpretationWorkflow();
