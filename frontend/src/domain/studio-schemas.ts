import { z } from "zod";
const id = z.string();
const map = <T extends z.ZodType>(x: T) => z.record(id, x);
export const studioOperation = z.enum([
  "identity",
  "reference",
  "look",
  "location",
]);
export const referenceType = z.enum([
  "front",
  "three_quarter",
  "profile",
  "full_body",
  "full_body_three_quarter",
  "custom",
]);
export const castSchema = z.object({
  characterId: id,
  lookId: id.optional(),
  referenceIds: z.array(id).optional(),
});
export const directionSchema = z.object({
  time: id,
  lighting: id,
  mood: id,
  style: id,
  camera: id,
  notes: id,
});
export const snapshotSchema = z.object({
  characterId: id,
  identityVersionId: id.optional(),
  lookVersionId: id.optional(),
  referenceVersionIds: z.array(id),
});
export const generationPreferencesSchema = z.object({
  videoMode: z.enum(["direct", "image_first"]).optional(),
  startingFrameAssetId: id.optional(),
  endingFrameAssetId: id.optional(),
  instructions: z.string().max(10000),
  referenceInputs: z
    .array(
      z.object({
        assetId: id,
        purpose: z.enum([
          "visual_style",
          "setting",
          "camera_movement",
          "audio",
          "continuity",
        ]),
      }),
    )
    .max(12),
  model: z.literal("demo"),
  aspectRatio: z.enum(["9:16", "16:9", "1:1"]),
});
export const generationOverrideSchema = generationPreferencesSchema.extend({
  locationMode: z.enum(["none", "inferred", "selected", "required"]),
  locationId: id.optional(),
});
export const generationInputSchema = generationOverrideSchema.extend({
  sourceScript: z.string().optional(),
  sceneDescription: z.string().optional(),
  episodeStyle: z.string().optional(),
  camera: z
    .object({ framing: z.string().optional(), movement: z.string().optional() })
    .optional(),
  worldElements: z
    .array(
      z.object({
        id: z.string(),
        kind: z.enum(["prop", "note"]),
        name: z.string(),
        description: z.string(),
        assetId: z.string().optional(),
      }),
    )
    .optional(),
  scriptRevision: z.number().int().positive().optional(),
  planRevision: z.number().int().positive().optional(),
  locationAssetId: id.optional(),
  direction: directionSchema,
  targetFrames: z.number().int().min(30).max(900),
});
export const studioSchema = z.object({
  looks: map(
    z.object({
      id,
      characterId: id,
      name: id,
      description: id,
      styling: id,
      notes: id,
      revision: z.number().int(),
      primaryVersionId: id.optional(),
      createdAt: z.number(),
      updatedAt: z.number(),
    }),
  ),
  references: map(
    z.object({
      id,
      characterId: id,
      lookId: id.optional(),
      type: referenceType,
      activeVersionId: id.optional(),
    }),
  ),
  versions: map(
    z.object({
      id,
      projectId: id,
      ownerKind: studioOperation,
      ownerId: id,
      assetId: id,
      approval: z.enum(["needs_review", "approved", "rejected"]),
      revision: z.number(),
      sourceIdentityVersionId: id.optional(),
      sourceLookVersionId: id.optional(),
      specification: id,
      createdAt: z.number(),
    }),
  ),
  locations: map(
    z.object({
      id,
      projectId: id,
      name: id,
      description: id,
      primaryVersionId: id.optional(),
      assetId: id.optional(),
      referenceAssetIds: z.array(id),
      revision: z.number(),
    }),
  ),
  setups: map(
    z.object({
      sceneId: id,
      generation: generationPreferencesSchema.optional(),
      cast: z.array(castSchema),
      locationMode: z.enum(["none", "inferred", "selected", "required"]),
      locationId: id.optional(),
      direction: directionSchema,
      targetSeconds: z.number(),
      revision: z.number(),
    }),
  ),
});
export const identityFields = z.object({
  name: z.string().trim().min(1).max(100),
  role: z.string().max(150),
  appearance: z.string().max(3000),
  personality: z.string().max(2000),
  notes: z.string().max(2000),
});
export const lookFields = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(3000),
  styling: z.string().max(1000),
  notes: z.string().max(2000),
});
