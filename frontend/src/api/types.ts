import { z } from "zod";

export const projectSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  createdAt: z.string(),
});
export type Project = z.infer<typeof projectSchema>;
export interface CreateProjectRequest {
  title: string;
}
export interface SubmitRequestInput {
  prompt: string;
  projectId?: string | null;
}

export const videoResultSchema = z.object({
  fileKey: z.string().regex(/^jobs\/[a-fA-F0-9-]{36}\/video\.mp4$/),
  contentType: z.literal("video/mp4"),
  sizeBytes: z.number().int().positive(),
  prompt: z.string(),
  durationSeconds: z.number().int().min(4).max(15),
  resolution: z.enum(["768P", "2K"]),
});
export type VideoResult = z.infer<typeof videoResultSchema>;
export const failureSchema = z.object({
  code: z.string(),
  message: z.string(),
});
export const artifactSchema = z.object({
  assetId: z.uuid().optional(),
  id: z.uuid(),
  kind: z.string(),
  schemaVersion: z.number().int(),
  content: z.unknown(),
  createdAt: z.string(),
});
export const jobSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid().nullable(),
  operation: z.string(),
  inputSchemaVersion: z.number().int(),
  input: z.unknown(),
  status: z.enum(["queued", "running", "succeeded", "failed"]),
  step: z.string().optional(),
  results: z.array(artifactSchema).optional(),
  error: failureSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const jobDetailSchema = jobSchema.extend({
  attempts: z.array(
    z.object({
      number: z.number().int(),
      provider: z.string().nullable(),
      model: z.string().nullable(),
      status: z.string(),
      error: failureSchema.optional(),
      startedAt: z.string(),
      finishedAt: z.string().optional(),
    }),
  ),
});
export type Job = z.infer<typeof jobSchema>;
export type JobDetail = z.infer<typeof jobDetailSchema>;
export const legacyInterpretationSchema = z
  .object({
    creativeBrief: z
      .object({
        premise: z.string().trim().min(1),
        characters: z.array(z.string()),
        setting: z.string(),
        style: z.string(),
      })
      .optional(),
    assumptions: z.array(z.string()),
    questions: z.array(z.string()),
  })
  .refine(
    (v) => !!v.creativeBrief || v.questions.some((q) => q.trim()),
    "Expected a creative brief or a clarification question.",
  );

export const decisionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("propose_operation"),
    operation: z.string().trim().min(1),
    input: z.record(z.string(), z.unknown()),
    assumptions: z.array(z.string()),
    questions: z.array(z.string()).max(0).default([]),
  }),
  z.object({
    action: z.literal("clarification_needed"),
    questions: z.array(z.string().trim().min(1)).min(1),
    assumptions: z.array(z.string()),
    operation: z.never().optional(),
    input: z.never().optional(),
  }),
]);
export const interpretationSchema = z.union([
  decisionSchema,
  legacyInterpretationSchema,
]);
export type Interpretation = z.infer<typeof interpretationSchema>;

export const userRequestSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid().nullable(),
  prompt: z.string(),
  interpretationJobId: z.uuid(),
  createdAt: z.string(),
});
export const acceptedRequestSchema = z.object({
  request: userRequestSchema,
  job: jobSchema,
});
