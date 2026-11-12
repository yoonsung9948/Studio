import { z } from "zod";
import { requestJSON } from "./client";
import { jobSchema } from "./types";
import { queryString } from "./pagination";
export const characterSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  appearance: z.string(),
  notes: z.string(),
  appearanceRevision: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const characterDetailSchema = characterSchema.extend({
  canonicalVersionId: z.uuid().nullable(),
  views: z.array(
    z.object({
      type: z.string(),
      selectedVersionId: z.uuid().nullable(),
      stale: z.boolean(),
    }),
  ),
});
export const versionSchema = z.object({
  id: z.uuid(),
  characterId: z.uuid(),
  view: z.string(),
  assetId: z.uuid(),
  producerJobId: z.uuid().nullable(),
  appearanceRevision: z.number().int(),
  sourceIdentityVersionId: z.uuid().nullable(),
  prompt: z.string(),
  approval: z.enum(["needs_review", "approved", "rejected"]),
  stale: z.boolean(),
  createdAt: z.string(),
});
export type CharacterDetail = z.infer<typeof characterDetailSchema>;
export type CharacterVersion = z.infer<typeof versionSchema>;
export const characterViews = [
  "front",
  "three_quarter",
  "profile",
  "right_profile",
  "full_body",
  "back",
] as const;
const path = (id: string) => `/characters/${encodeURIComponent(id)}`;
export const listCharacters = (cursor?: string, signal?: AbortSignal) =>
  requestJSON(
    `/characters${queryString({ limit: 100, cursor })}`,
    (v) =>
      z
        .object({
          items: z.array(characterSchema),
          nextCursor: z.string().nullable(),
        })
        .parse(v),
    { signal },
  );
export const getCharacter = (id: string, signal?: AbortSignal) =>
  requestJSON(path(id), (v) => characterDetailSchema.parse(v), { signal });
export const createCharacter = (input: {
  name: string;
  appearance: string;
  notes: string;
}) =>
  requestJSON("/characters", (v) => characterDetailSchema.parse(v), {
    method: "POST",
    body: input,
  });
export const updateCharacter = (
  id: string,
  input: { name: string; appearance: string; notes: string },
) =>
  requestJSON(path(id), (v) => characterDetailSchema.parse(v), {
    method: "PATCH",
    body: input,
  });
export const deleteCharacter = (id: string) =>
  requestJSON(path(id), () => undefined, { method: "DELETE" });
export const characterVersions = (
  id: string,
  cursor?: string,
  signal?: AbortSignal,
) =>
  requestJSON(
    `${path(id)}/versions${queryString({ limit: 100, cursor })}`,
    (v) =>
      z
        .object({
          items: z.array(versionSchema),
          nextCursor: z.string().nullable(),
        })
        .parse(v),
    { signal },
  );
export const generateCharacter = (
  id: string,
  input: {
    views: string[];
    count: number;
    prompt: string;
    sourceVersionId?: string;
  },
  key: string,
) =>
  requestJSON(
    `${path(id)}/generations`,
    (v) =>
      z
        .object({
          id: z.uuid(),
          characterId: z.uuid(),
          jobs: z.array(jobSchema),
        })
        .parse(v),
    { method: "POST", body: input, headers: { "Idempotency-Key": key } },
  );
export const selectCharacterVersion = (
  id: string,
  view: string,
  versionId: string,
) =>
  requestJSON(
    `${path(id)}/views/${encodeURIComponent(view)}/selection`,
    (v) => characterDetailSchema.parse(v),
    { method: "PUT", body: { versionId } },
  );
export const rejectCharacterVersion = (id: string, versionId: string) =>
  requestJSON(
    `${path(id)}/versions/${encodeURIComponent(versionId)}/reject`,
    () => undefined,
    { method: "POST" },
  );
export const uploadCharacter = (id: string, file: File, key: string) =>
  requestJSON(`${path(id)}/uploads`, (v) => versionSchema.parse(v), {
    method: "POST",
    rawBody: file,
    headers: { "Idempotency-Key": key },
  });
