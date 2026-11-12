import { observedJobSchema } from "./backend-jobs";
import { z } from "zod";
import {
  interpretationSchema,
  decisionSchema,
  legacyInterpretationSchema,
  projectSchema,
  type Job,
  type Interpretation,
} from "../api/types";
import type { Data } from "./types";

export const interpretationRequestSchema = z.object({
  operation: z.string().optional(),
  prompt: z.string(),
  title: z.string(),
  idempotencyKey: z.string(),
  projectId: z.uuid().nullish(),
  sourceProjectId: z.string().optional(),
  creationKind: z.enum(["episode", "scene", "shot"]).optional(),
  durationSeconds: z.number().positive().optional(),
  requestId: z.uuid().optional(),
  jobId: z.uuid().optional(),
  jobStep: z.string().optional(),
  phase: z.enum([
    "creating",
    "submitting",
    "polling",
    "paused",
    "succeeded",
    "failed",
  ]),
  jobStatus: z.enum(["queued", "running", "succeeded", "failed"]).optional(),
  interpretation: interpretationSchema.optional(),
  error: z.string().optional(),
  errorCode: z.string().optional(),
  observationRetryAt: z.number().optional(),
});
export type InterpretationRequest = z.infer<typeof interpretationRequestSchema>;
export const backendWorkspaceSchema = z.object({
  ownerId: z.string().optional(),
  projects: z.record(z.string(), projectSchema),
  request: interpretationRequestSchema.optional(),
  projectLinks: z.record(z.string(), z.uuid()).optional(),
  jobs: z.record(z.string(), observedJobSchema).optional(),
});
export type BackendWorkspace = z.infer<typeof backendWorkspaceSchema>;
export const interpretationPending = (r?: InterpretationRequest) =>
  !!r && ["creating", "submitting", "polling"].includes(r.phase);
export function backendWorkspace(data: Data): BackendWorkspace {
  return (data.backend ??= { projects: {} });
}
export function interpretationResult(job: Job): Interpretation {
  const artifact = job.results?.find(
    (a) =>
      a.kind === "request_interpretation" && [1, 2].includes(a.schemaVersion),
  );
  if (!artifact)
    throw new Error(
      "The completed job did not contain a supported request interpretation.",
    );
  return (
    artifact.schemaVersion === 2 ? decisionSchema : legacyInterpretationSchema
  ).parse(artifact.content);
}

/** Immutable submission context retained per job for Activity Show / Retry. */
export function interpretationContext(request: InterpretationRequest) {
  const {
    operation,
    requestId,
    prompt,
    title,
    idempotencyKey,
    sourceProjectId,
    creationKind,
    durationSeconds,
  } = request;
  return {
    operation,
    requestId,
    prompt,
    title,
    idempotencyKey,
    sourceProjectId,
    creationKind,
    durationSeconds,
  };
}
export function applyInterpretationJob(data: Data, job: Job) {
  const request = data.backend?.request;
  if (
    !request ||
    request.jobId !== job.id ||
    (request.projectId ?? null) !== job.projectId ||
    job.operation !== "interpret_request"
  )
    return;
  request.jobStatus = job.status;
  request.jobStep = job.step;
  if (job.status === "failed")
    Object.assign(request, {
      phase: "failed",
      errorCode: job.error?.code,
      error: job.error?.message || "The interpretation job failed.",
      observationRetryAt: undefined,
    });
  else if (job.status === "succeeded") {
    try {
      Object.assign(request, {
        phase: "succeeded",
        interpretation: interpretationResult(job),
        error: undefined,
        errorCode: undefined,
        observationRetryAt: undefined,
      });
    } catch (error) {
      Object.assign(request, {
        phase: "failed",
        errorCode: "invalid_result",
        error:
          error instanceof Error ? error.message : "Unsupported job result.",
        observationRetryAt: undefined,
      });
    }
  } else if (request.phase !== "paused")
    Object.assign(request, {
      phase: "polling",
      error: undefined,
      errorCode: undefined,
      observationRetryAt: undefined,
    });
}

/** Do not expose or poll a previous account's cached API work. Local demo work is retained. */
export function bindBackendOwner(data: Data, userId: string) {
  if (data.backend?.ownerId !== userId)
    data.backend = { ownerId: userId, projects: {} };
}
