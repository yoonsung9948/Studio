import { z } from "zod";
import { queryString, type PageParams } from "./pagination";
import { requestJSON } from "./client";
export const fileSchema = z.object({
  id: z.uuid(),
  assetId: z.uuid(),
  role: z.enum(["original", "thumbnail", "preview"]),
  contentType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
});
export const assetSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid().nullable(),
  producerJobId: z.uuid().nullable(),
  kind: z.enum(["image", "video", "audio"]),
  createdAt: z.string(),
});
export function getAsset(id: string, signal?: AbortSignal) {
  return requestJSON(
    `/assets/${encodeURIComponent(id)}`,
    (value) => assetSchema.extend({ files: z.array(fileSchema) }).parse(value),
    { signal },
  );
}
/** Fetch on demand; signed links are never written into persisted studio state. */
export function getAssetFileURL(fileId: string, signal?: AbortSignal) {
  return requestJSON(
    `/asset-files/${encodeURIComponent(fileId)}/url`,
    (value) => {
      const link = z
        .object({ url: z.string(), expiresAt: z.iso.datetime() })
        .parse(value);
      if (
        !link.url.startsWith(
          `/api/v1/downloads/${encodeURIComponent(fileId)}?token=`,
        )
      )
        throw new Error("Invalid media link");
      return link;
    },
    { signal },
  );
}

export type AssetFile = z.infer<typeof fileSchema>;
export type Asset = z.infer<typeof assetSchema>;
export function listAssets(
  params: PageParams & { projectId?: string; kind?: string } = {},
  signal?: AbortSignal,
) {
  return requestJSON(
    `/assets${queryString(params)}`,
    (value) =>
      z
        .object({
          items: z.array(assetSchema),
          nextCursor: z.string().nullable(),
        })
        .parse(value),
    { signal },
  );
}
