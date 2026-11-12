import { z } from "zod";
import { requestJSON } from "./client";
import { jobSchema } from "./types";
export const recordSchema = z.record(z.string(), z.unknown());
export const productionSchema = z.object({
  revision: z.number().int().nonnegative(),
  project: recordSchema,
  episodes: z.array(recordSchema),
  scenes: z.array(recordSchema),
  shots: z.array(recordSchema),
  characters: z.array(recordSchema),
  looks: z.array(recordSchema),
  locations: z.array(recordSchema),
  props: z.array(recordSchema),
  versions: z.array(recordSchema),
  takes: z.array(recordSchema),
  setups: z.array(recordSchema),
  references: z.array(recordSchema),
  exports: z.array(recordSchema),
  assets: z.array(recordSchema),
});
export type ProductionDocument = z.infer<typeof productionSchema>;
export const getProduction = (id: string, signal?: AbortSignal) =>
  requestJSON(
    `/projects/${encodeURIComponent(id)}/production`,
    (v) => productionSchema.parse(v),
    { signal },
  );
export const saveProduction = (
  id: string,
  body: ProductionDocument,
  signal?: AbortSignal,
) =>
  requestJSON(
    `/projects/${encodeURIComponent(id)}/production`,
    (v) => productionSchema.parse(v),
    { method: "PUT", body, signal },
  );
export const archiveProduction = (id: string) =>
  requestJSON(`/projects/${encodeURIComponent(id)}`, () => undefined, {
    method: "DELETE",
  });
export const generateShot = (
  projectId: string,
  shotId: string,
  body: unknown,
  key: string,
) =>
  requestJSON(
    `/projects/${encodeURIComponent(projectId)}/shots/${encodeURIComponent(shotId)}/generations`,
    (v) => z.object({ jobs: z.array(jobSchema) }).parse(v),
    { method: "POST", body, headers: { "Idempotency-Key": key } },
  );
