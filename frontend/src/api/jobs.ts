import { z } from "zod";
import { queryString, type PageParams } from "./pagination";
import { requestJSON } from "./client";
import { jobDetailSchema, jobSchema } from "./types";

export function getJob(jobId: string, signal?: AbortSignal) {
  return requestJSON(
    `/jobs/${encodeURIComponent(jobId)}`,
    (value) => jobDetailSchema.parse(value),
    { signal },
  );
}

export const jobSummarySchema = jobSchema
  .omit({ input: true })
  .extend({ input: z.unknown().optional() });
export type JobSummary = z.infer<typeof jobSummarySchema>;
export interface JobFilters {
  projectId?: string;
  status?: "queued" | "running" | "succeeded" | "failed";
  operation?: string;
}
export function listJobs(
  params: PageParams & JobFilters = {},
  signal?: AbortSignal,
) {
  return requestJSON(
    `/jobs${queryString(params)}`,
    (value) =>
      z
        .object({
          items: z.array(jobSummarySchema),
          nextCursor: z.string().nullable(),
        })
        .parse(value),
    { signal },
  );
}
