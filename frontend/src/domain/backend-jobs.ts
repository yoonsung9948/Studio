import { z } from "zod";
import { failureSchema, jobDetailSchema } from "../api/types";
import type { Data } from "./types";

export const observedJobSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid().nullish(),
  operation: z.string(),
  title: z.string().optional(),
  request: z
    .object({
      operation: z.string().optional(),
      requestId: z.uuid().optional(),
      prompt: z.string(),
      title: z.string(),
      idempotencyKey: z.string(),
      sourceProjectId: z.string().optional(),
      creationKind: z.enum(["episode", "scene", "shot"]).optional(),
      durationSeconds: z.number().positive().optional(),
    })
    .optional(),
  job: jobDetailSchema.optional(),
  observationError: failureSchema.optional(),
  retryAt: z.number().optional(),
  consecutiveFailures: z.number().optional(),
});
export type ObservedJob = z.infer<typeof observedJobSchema>;
export type JobIdentity = Pick<ObservedJob, "id" | "projectId" | "operation">;
export const terminalBackendJob = (status?: string) =>
  status === "succeeded" || status === "failed";
export function temporaryObservationFailure(error: {
  status: number;
  code: string;
}) {
  return (
    (error.status === 0 &&
      ["network_error", "request_timeout"].includes(error.code)) ||
    [408, 425, 429].includes(error.status) ||
    (error.status >= 500 && error.status <= 599)
  );
}
export function observationBackoff(
  failures: number,
  baseMs = 1000,
  maxMs = 30000,
) {
  return Math.min(
    maxMs,
    Math.max(1, baseMs) * 2 ** Math.min(20, Math.max(0, failures - 1)),
  );
}
export function recordObservedJob(
  data: Data,
  identity: JobIdentity,
  patch: Partial<ObservedJob> = {},
) {
  const workspace = (data.backend ??= { projects: {} });
  const jobs = (workspace.jobs ??= {});
  jobs[identity.id] = { ...jobs[identity.id], ...identity, ...patch };
}
