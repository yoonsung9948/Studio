import { requestJSON } from "./client";
import { assetSchema, fileSchema } from "./assets";
import { z } from "zod";
export const uploadMedia = (file: Blob, key: string, projectId?: string) =>
  requestJSON(
    `/assets/uploads${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`,
    (v) => assetSchema.extend({ files: z.array(fileSchema) }).parse(v),
    {
      method: "POST",
      rawBody: file,
      headers: { "Idempotency-Key": key },
      timeoutMs: 60000,
    },
  );
export const deleteMedia = (id: string) =>
  requestJSON(`/assets/${encodeURIComponent(id)}`, () => undefined, {
    method: "DELETE",
  });
