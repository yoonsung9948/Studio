import { uploadMedia } from "./media";
import { z } from "zod";
import { requestJSON } from "./client";
import { jobSchema } from "./types";
import type * as chars from "./characters";
const subject = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  notes: z.string(),
  revision: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  views: z.record(z.string(), z.string()),
  identityReady: z.boolean().optional(),
});
const version = z.object({
  id: z.uuid(),
  subjectId: z.string(),
  view: z.string(),
  assetId: z.uuid(),
  producerJobId: z.uuid().nullable(),
  revision: z.number(),
  identityVersionId: z.string().nullable(),
  approval: z.enum(["needs_review", "approved", "rejected"]),
  stale: z.boolean(),
  createdAt: z.string(),
});
export type ReferenceKind =
  "place" | "prop" | "look" | "cast" | "place_instance" | "prop_instance";
export const referenceViews = (kind: ReferenceKind) =>
  kind === "place" || kind === "place_instance"
    ? ["front", "interior", "entrance", "detail"]
    : kind === "prop" || kind === "prop_instance"
      ? ["front", "back", "detail", "side"]
      : [
          "front",
          "three_quarter",
          "profile",
          "right_profile",
          "full_body",
          "back",
        ];
export function referenceAPI(kind: ReferenceKind) {
  const path = (id?: string) =>
    `/references/${kind}${id ? `/${encodeURIComponent(id)}` : ""}`;
  const normalize = (v: z.infer<typeof subject>): chars.CharacterDetail => ({
    id: v.id,
    name: v.name,
    appearance: v.description,
    notes: v.notes,
    appearanceRevision: v.revision,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
    canonicalVersionId:
      kind === "cast" && v.identityReady === false
        ? null
        : (v.views.front ?? null),
    views: referenceViews(kind).map((type) => ({
      type,
      selectedVersionId: v.views[type] ?? null,
      stale: false,
    })),
  });
  const get = (id: string, signal?: AbortSignal) =>
    requestJSON(path(id), (v) => normalize(subject.parse(v)), { signal });
  return {
    listCharacters: (cursor?: string, signal?: AbortSignal) =>
      requestJSON(
        `${path()}?cursor=${encodeURIComponent(cursor ?? "")}`,
        (v) => {
          const p = z
            .object({
              items: z.array(subject),
              nextCursor: z.string().nullable(),
            })
            .parse(v);
          return { ...p, items: p.items.map(normalize) };
        },
        { signal },
      ),
    getCharacter: get,
    createCharacter: (input: {
      name: string;
      appearance: string;
      notes: string;
    }) =>
      requestJSON(path(), (v) => normalize(subject.parse(v)), {
        method: "POST",
        body: {
          name: input.name,
          description: input.appearance,
          notes: input.notes,
        },
      }),
    updateCharacter: (
      id: string,
      input: { name: string; appearance: string; notes: string },
    ) =>
      requestJSON(path(id), (v) => normalize(subject.parse(v)), {
        method: "PATCH",
        body: {
          name: input.name,
          description: input.appearance,
          notes: input.notes,
        },
      }),
    deleteCharacter: (id: string) =>
      requestJSON(path(id), () => undefined, { method: "DELETE" }),
    characterVersions: (id: string, cursor?: string, signal?: AbortSignal) =>
      requestJSON(
        `${path(id)}/versions?cursor=${encodeURIComponent(cursor ?? "")}`,
        (v) => {
          const p = z
            .object({
              items: z.array(version),
              nextCursor: z.string().nullable(),
            })
            .parse(v);
          return {
            ...p,
            items: p.items.map((v) => ({
              id: v.id,
              characterId: v.subjectId,
              view: v.view,
              assetId: v.assetId,
              producerJobId: v.producerJobId,
              appearanceRevision: v.revision,
              sourceIdentityVersionId: v.identityVersionId,
              prompt: "",
              approval: v.approval,
              stale: v.stale,
              createdAt: v.createdAt,
            })),
          };
        },
        { signal },
      ),
    generateCharacter: (
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
              subjectId: z.string(),
              jobs: z.array(jobSchema),
            })
            .parse(v),
        { method: "POST", body: input, headers: { "Idempotency-Key": key } },
      ),
    selectCharacterVersion: async (
      id: string,
      view: string,
      version: string,
    ) => {
      await requestJSON(
        `${path(id)}/views/${encodeURIComponent(view)}/${encodeURIComponent(version)}`,
        () => undefined,
        { method: "PUT" },
      );
      return get(id);
    },
    rejectCharacterVersion: (id: string, version: string) =>
      requestJSON(
        `${path(id)}/versions/${encodeURIComponent(version)}/reject`,
        () => undefined,
        { method: "POST" },
      ),
    uploadCharacter: async (
      id: string,
      file: File,
      key: string,
      view = "front",
    ): Promise<chars.CharacterVersion> => {
      const asset = await uploadMedia(file, key);
      return requestJSON(
        `${path(id)}/uploads`,
        (v) => {
          const item = version.parse(v);
          return {
            id: item.id,
            characterId: item.subjectId,
            view: item.view,
            assetId: item.assetId,
            producerJobId: item.producerJobId,
            appearanceRevision: item.revision,
            sourceIdentityVersionId: item.identityVersionId,
            prompt: "Uploaded reference",
            approval: item.approval,
            stale: item.stale,
            createdAt: item.createdAt,
          };
        },
        {
          method: "POST",
          body: { assetId: asset.id, view },
          headers: { "Idempotency-Key": key },
        },
      );
    },
  };
}
