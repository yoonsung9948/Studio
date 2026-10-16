import {
  type Data,
  type GenerationPreferences,
  type GenerationInputSnapshot,
  type CastAssignment,
} from "./types";
import {
  generationPreferencesSchema,
  generationOverrideSchema,
} from "./studio-schemas";
import { ensureSetup, updateShotPlan } from "./scene-preflight";
import { bumpStudio, markShotsStale, setSceneCast } from "./studio-commands";
export const referencePurposes = {
  visual_style: "Visual style",
  setting: "Setting",
  camera_movement: "Camera movement",
  audio: "Audio / sound",
  continuity: "Continuity",
} as const;
export function generationInputs(d: Data, sid: string, shotId?: string) {
  const sc = d.scenes[sid],
    s = d.studio.setups[sid];
  const defaults: GenerationPreferences = {
    instructions: [sc?.description, sc?.creativeNotes]
      .filter(Boolean)
      .join("\n\n"),
    referenceInputs: [],
    model: "demo",
    aspectRatio: "9:16",
  };
  const prefs = s?.generation ?? defaults;
  const override = shotId ? d.shots[shotId]?.generationOverride : undefined;
  return {
    ...prefs,
    locationMode: s?.locationMode ?? "inferred",
    locationId: s?.locationId,
    ...override,
  };
}
export function saveGenerationInputs(
  d: Data,
  sid: string,
  fields: Partial<ReturnType<typeof generationInputs>>,
  shotId?: string,
) {
  const setup = ensureSetup(d, sid);
  const next = { ...generationInputs(d, sid, shotId), ...fields };
  if (JSON.stringify(next) === JSON.stringify(generationInputs(d, sid, shotId)))
    return;
  const pid = d.episodes[d.scenes[sid].episodeId].projectId;
  if (next.locationId && d.studio.locations[next.locationId]?.projectId !== pid)
    throw Error("Choose a setting from this project.");
  if (next.endingFrameAssetId && !next.startingFrameAssetId)
    throw Error("Choose a starting frame before an ending frame.");
  for (const aid of [next.startingFrameAssetId, next.endingFrameAssetId].filter(
    Boolean,
  ) as string[]) {
    const asset = d.assets[aid];
    if (
      !asset ||
      asset.projectId !== pid ||
      asset.kind !== "image" ||
      asset.missing ||
      !asset.url
    )
      throw Error(
        "Choose an available image from this project for frame conditioning.",
      );
  }
  for (const ref of next.referenceInputs)
    if (d.assets[ref.assetId]?.projectId !== pid)
      throw Error("Choose references from this project.");
  if (shotId) {
    if (d.shots[shotId]?.sceneId !== sid)
      throw Error("Shot belongs to another scene.");
    updateShotPlan(d, shotId, {});
    d.shots[shotId].generationOverride = generationOverrideSchema.parse(next);
  } else {
    setup.generation = generationPreferencesSchema.parse(next);
    setup.locationMode = next.locationMode;
    setup.locationId = next.locationId;
    setup.revision++;
    markShotsStale(
      d,
      d.scenes[sid].shotIds.filter((id) => !d.shots[id].generationOverride),
    );
    bumpStudio(d, pid);
  }
}
export function saveGenerationCast(
  d: Data,
  sid: string,
  cast: CastAssignment[],
  shotId?: string,
) {
  if (shotId && d.shots[shotId]?.sceneId !== sid)
    throw Error("Shot belongs to another scene.");
  if (shotId) updateShotPlan(d, shotId, { castOverride: cast });
  else setSceneCast(d, sid, cast);
}
export function generationInputSnapshot(
  d: Data,
  shotId: string,
): GenerationInputSnapshot {
  const shot = d.shots[shotId],
    inputs = generationInputs(d, shot.sceneId, shotId);
  return structuredClone({
    ...inputs,
    scriptRevision:
      d.episodes[d.scenes[shot.sceneId].episodeId].scriptRevision ?? 1,
    planRevision: d.scenes[shot.sceneId].planRevision ?? 1,
    instructions: [
      inputs.instructions,
      d.scenes[shot.sceneId].settingDescription
        ? `Setting: ${d.scenes[shot.sceneId].settingDescription}`
        : "",
      d.scenes[shot.sceneId].creativeNotes &&
      !inputs.instructions.includes(d.scenes[shot.sceneId].creativeNotes!)
        ? d.scenes[shot.sceneId].creativeNotes
        : "",
      shot.action,
      shot.dialogue ? `Dialogue: ${shot.dialogue}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    locationAssetId: inputs.locationId
      ? d.studio.locations[inputs.locationId]?.assetId
      : undefined,
    direction: d.studio.setups[shot.sceneId].direction,
    targetFrames: shot.targetFrames,
  });
}
