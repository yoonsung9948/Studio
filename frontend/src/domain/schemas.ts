import { backendWorkspaceSchema } from "./interpretation";
import { episodeCutSchema } from "./cut-schema";
import {
  studioSchema,
  directionSchema,
  studioOperation,
  referenceType,
  castSchema,
  snapshotSchema,
  generationOverrideSchema,
  generationInputSchema,
} from "./studio-schemas";
import { z } from "zod";
export const episodeForm = z.object({
  title: z.string().trim().min(1, "Add a title.").max(100),
  synopsis: z.string().max(1000),
  targetSeconds: z.coerce.number().int().min(3).max(90),
});
const id = z.string();
const map = <T extends z.ZodType>(v: T) => z.record(id, v);
const project = z.object({
  format: z.string().max(100).optional(),
  archived: z.boolean().optional(),
  unfiled: z.boolean().optional(),
  assetLibrary: z.boolean().optional(),
  strictApprovals: z.boolean().optional(),
  worldElements: z
    .array(
      z.object({
        id: z.string(),
        kind: z.enum(["prop", "note"]),
        assetId: z.string().optional(),
        name: z.string(),
        description: z.string(),
        revision: z.number().int().positive().optional(),
        primaryVersionId: id.optional(),
        savedViewIds: z.record(id, id).optional(),
        sourceAssetId: id.optional(),
      }),
    )
    .optional(),
  id,
  title: id,
  description: id,
  cover: id,
  episodeIds: z.array(id),
  bible: id,
  defaultDuration: z.number(),
  revision: z.number(),
  updatedAt: z.number().optional(),
});
const episode = z.object({
  locationIds: z.array(id).optional(),
  propIds: z.array(id).optional(),
  cut: episodeCutSchema.optional(),
  characterIds: z.array(id).optional(),
  mediaAssetIds: z.array(id).optional(),
  cutReview: z
    .object({
      approvedSignature: z.string().optional(),
      notes: z.array(
        z.object({
          id,
          text: z.string().max(2000),
          frame: z.number().int().nonnegative(),
          resolved: z.boolean(),
          shotId: id.optional(),
          version: z.number(),
          createdAt: z.number(),
        }),
      ),
    })
    .optional(),
  creationKind: z.enum(["episode", "scene", "shot"]).optional(),
  archived: z.boolean().optional(),
  style: z.string().optional(),
  id,
  projectId: id,
  title: id,
  synopsis: id,
  targetSeconds: z.number(),
  sceneIds: z.array(id),
  script: id,
  scriptRevision: z.number().int().positive().optional(),
  scriptApprovedRevision: z.number().int().positive().optional(),
  scriptHistory: z
    .array(
      z.object({ revision: z.number(), script: id, approvedAt: z.number() }),
    )
    .optional(),
  revision: z.number(),
  timelineVersion: z.number(),
});
const scene = z.object({
  screenplay: z.string().max(10000).optional(),
  archived: z.boolean().optional(),
  planRevision: z.number().int().positive().optional(),
  planApprovedRevision: z.number().int().positive().optional(),
  sourceScriptRevision: z.number().int().positive().optional(),
  dialogue: id.optional(),
  settingDescription: id.optional(),
  creativeNotes: id.optional(),
  planHistory: z
    .array(
      z.object({
        revision: z.number(),
        scriptRevision: z.number(),
        screenplay: z.string().optional(),
        title: id,
        description: id,
        dialogue: id,
        settingDescription: id,
        creativeNotes: id,
        direction: directionSchema.optional(),
        targetSeconds: z.number(),
        shots: z.array(
          z.object({ id, action: id, dialogue: id, targetFrames: z.number() }),
        ),
        approvedAt: z.number(),
      }),
    )
    .optional(),
  id,
  episodeId: id,
  title: id,
  description: id,
  shotIds: z.array(id),
  cover: id,
});
const shot = z.object({
  volume: z.number().min(0).max(1).optional(),
  archived: z.boolean().optional(),
  discardedTakeIds: z.array(z.string()).optional(),
  locked: z.boolean().optional(),
  movement: z.string().optional(),
  worldElementIds: z.array(z.string()).optional(),
  id,
  sceneId: id,
  title: id,
  action: id,
  dialogue: id,
  characters: z.array(id),
  targetFrames: z.number(),
  inFrame: z.number(),
  outFrame: z.number(),
  revision: z.number(),
  imageTakeId: id.optional(),
  currentTakeId: id.optional(),
  candidateTakeId: id.optional(),
  dependsOn: id.optional(),
  stale: z.boolean(),
  castOverride: z.array(castSchema).optional(),
  generationOverride: generationOverrideSchema.optional(),
  referenceRequirements: z.array(referenceType).optional(),
  framing: id.optional(),
  requestedOperation: z.enum(["image", "video"]).optional(),
});
const take = z.object({
  producerJobId: z.string().optional(),
  favorite: z.boolean().optional(),
  review: z
    .object({ note: z.string().max(2000), checks: z.array(z.string()) })
    .optional(),
  id,
  shotId: id,
  kind: z.enum(["image", "video"]),
  revision: z.number(),
  approved: z.boolean(),
  sourceFrames: z.number(),
  assetId: id,
  createdAt: z.number(),
  sourceTakeId: id.optional(),
  references: z.array(snapshotSchema).optional(),
  inputs: generationInputSchema.optional(),
});
const asset = z.object({
  storedBlob: z.boolean().optional(),
  serverAssetId: z.string().optional(),
  archived: z.boolean().optional(),
  id,
  projectId: id,
  title: id,
  kind: z.enum(["image", "video", "audio"]),
  url: id,
  sessionOnly: z.boolean().optional(),
  missing: z.boolean().optional(),
  provenance: id,
});
const job = z.object({
  id,
  projectId: id,
  episodeId: id,
  sceneId: id,
  shotId: id,
  operation: z.enum([
    "image",
    "video",
    "identity",
    "reference",
    "look",
    "location",
    "prop",
  ]),
  state: z.enum([
    "queued",
    "waiting",
    "running",
    "succeeded",
    "failed",
    "canceled",
  ]),
  attempt: z.number(),
  cost: z.number(),
  progress: z.number().nullable(),
  revision: z.number(),
  sourceTakeId: id.optional(),
  references: z.array(snapshotSchema).optional(),
  inputs: generationInputSchema.optional(),
  dependencyShotId: id.optional(),
  error: id.optional(),
  replacement: z.boolean(),
  target: z.object({ kind: studioOperation, id }).optional(),
  sourceIdentityVersionId: id.optional(),
  sourceLookVersionId: id.optional(),
  specification: id.optional(),
  viewType: id.optional(),
  outputVersionIds: z.array(id).optional(),
  outputCount: z.number().int().min(1).max(4).optional(),
  simulateFailure: z.boolean().optional(),
});
const scope = z.object({
  projectId: id,
  episodeId: id.optional(),
  sceneId: id.optional(),
  shotId: id.optional(),
  revision: z.number(),
  range: z.tuple([z.number(), z.number()]).optional(),
  fps: z.literal(30),
  characterId: id.optional(),
  lookId: id.optional(),
  characterTab: id.optional(),
  setup: z.boolean().optional(),
});
export const dataSchema = z.object({
  backend: backendWorkspaceSchema.optional(),
  projects: map(project),
  episodes: map(episode),
  scenes: map(scene),
  shots: map(shot),
  takes: map(take),
  assets: map(asset),
  jobs: map(job),
  threads: map(
    z.object({
      id,
      messages: z.array(
        z.object({
          id,
          role: z.enum(["user", "assistant"]),
          text: id,
          proposalId: id.optional(),
        }),
      ),
    }),
  ),
  proposals: map(
    z.object({
      id,
      scope,
      shotIds: z.array(id),
      intent: z.enum([
        "develop",
        "suspense",
        "trim",
        "generate",
        "replace",
        "studio",
      ]),
      change: z
        .object({
          kind: z.enum([
            "identity",
            "create_look",
            "edit_look",
            "direction",
            "cast",
          ]),
          fields: z.record(id, id),
        })
        .optional(),
      before: id,
      after: id,
      state: z.enum(["proposed", "applied", "canceled"]),
      cost: z.number(),
    }),
  ),
  exports: map(
    z.object({
      outputAssetId: id.optional(),
      id,
      episodeId: id,
      timelineVersion: z.number(),
      title: id,
      preset: id,
      captions: z.boolean(),
      description: id,
      draft: z.boolean(),
      createdAt: z.number(),
      manifest: id,
    }),
  ),
  characters: map(
    z.object({
      sourceCharacterId: id.optional(),
      id,
      projectId: id,
      name: id,
      description: id,
      reference: id,
      approved: z.boolean(),
      role: id.optional(),
      appearance: id.optional(),
      personality: id.optional(),
      notes: id.optional(),
      canonicalVersionId: id.optional(),
      revision: z.number().optional(),
      createdAt: z.number().optional(),
      updatedAt: z.number().optional(),
    }),
  ),
  credits: z.number().int().nonnegative(),
  studio: studioSchema,
});
export const uiSchema = z.object({
  autosave: z.boolean().optional(),
  density: z.enum(["comfortable", "compact", "spacious"]).optional(),
  reducedMotion: z.boolean().optional(),
  notifications: z
    .object({
      completed: z.boolean(),
      failed: z.boolean(),
      review: z.boolean(),
    })
    .optional(),
  inspectorAdvanced: z.boolean().optional(),
  theme: z.enum(["dark", "light", "system"]),
  collapsed: z.boolean(),
  aiOpen: z.boolean(),
  layouts: map(map(z.number())),
  selectedShots: map(id),
});
export const trimSchema = z
  .object({
    inFrame: z.number().int().nonnegative(),
    outFrame: z.number().int().positive(),
  })
  .refine((v) => v.outFrame > v.inFrame, "Out must be after in.");
