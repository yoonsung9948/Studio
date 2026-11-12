import {
  type Data,
  type GenerationPreferences,
  type GenerationInputSnapshot,
  type CastAssignment,
  type CraftSettings,
} from "./types";
import {
  generationPreferencesSchema,
  generationOverrideSchema,
  generationContextSchema,
} from "./studio-schemas";
import { ensureSetup, updateShotPlan } from "./scene-preflight";
import { bumpStudio, markShotsStale, setSceneCast } from "./studio-commands";
import { effectiveCast } from "./studio-selectors";
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
    instructions: [sc?.screenplay ?? sc?.description, sc?.creativeNotes]
      .filter(Boolean)
      .join("\n\n"),
    referenceInputs: [],
    model: "demo",
    aspectRatio: "9:16",
  };
  const prefs = { ...defaults, ...s?.generation };
  const override = shotId ? d.shots[shotId]?.generationOverride : undefined;
  return {
    ...prefs,
    locationMode: s?.locationMode ?? "inferred",
    locationId: s?.locationId,
    ...override,
    craft: { ...defaultCraft, ...prefs.craft, ...override?.craft },
  };
}
/** Props follow the same scene-default / explicit-shot-override rule as cast. */
export function effectiveWorldElements(
  d: Data,
  sceneId: string,
  shotId?: string,
) {
  return (
    (shotId ? d.shots[shotId]?.worldElementIds : undefined) ??
    d.studio.setups[sceneId]?.worldElementIds ??
    []
  );
}
export function saveGenerationInputs(
  d: Data,
  sid: string,
  fields: Partial<ReturnType<typeof generationInputs>>,
  shotId?: string,
) {
  const setup = ensureSetup(d, sid);
  const before = new Map(
    d.scenes[sid].shotIds.map((id) => [
      id,
      JSON.stringify(generationInputs(d, sid, id)),
    ]),
  );
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
    generationContextSchema.parse(next);
    updateShotPlan(d, shotId, {});
    const previous = d.shots[shotId].generationOverride;
    const override = generationOverrideSchema.parse({
      ...previous,
      ...fields,
      ...(fields.craft
        ? { craft: { ...previous?.craft, ...fields.craft } }
        : {}),
    });
    const inherited = generationInputs(d, sid);
    if (override.craft) {
      for (const key of Object.keys(
        override.craft,
      ) as (keyof CraftSettings)[]) {
        if (override.craft[key] === inherited.craft[key])
          delete override.craft[key];
      }
    }
    d.shots[shotId].generationOverride = override;
  } else {
    setup.generation = generationPreferencesSchema.parse(next);
    setup.locationMode = next.locationMode;
    setup.locationId = next.locationId;
    setup.revision++;
    markShotsStale(
      d,
      d.scenes[sid].shotIds.filter(
        (id) => before.get(id) !== JSON.stringify(generationInputs(d, sid, id)),
      ),
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
  const current = shotId ? effectiveCast(d, shotId) : ensureSetup(d, sid).cast;
  if (JSON.stringify(current) === JSON.stringify(cast)) return;
  if (shotId) updateShotPlan(d, shotId, { castOverride: cast });
  else setSceneCast(d, sid, cast);
}
export function generationInputSnapshot(
  d: Data,
  shotId: string,
  operation: "image" | "video" = "video",
): GenerationInputSnapshot {
  const shot = d.shots[shotId],
    inputs = generationInputs(d, shot.sceneId, shotId);
  const episode = d.episodes[d.scenes[shot.sceneId].episodeId];
  return structuredClone({
    ...inputs,
    sourceScript: d.scenes[shot.sceneId].screenplay ?? episode.script,
    sceneDescription: d.scenes[shot.sceneId].description,
    episodeStyle: episode.style,
    camera: { framing: shot.framing, movement: shot.movement },
    worldElements: [
      ...(d.projects[episode.projectId].worldElements ?? []),
      ...(d.projects[episode.projectId].bible?.trim()
        ? [
            {
              id: `bible-${episode.projectId}`,
              kind: "note" as const,
              name: "Story notes",
              description: d.projects[episode.projectId].bible,
            },
          ]
        : []),
    ].filter((e) =>
      effectiveWorldElements(d, shot.sceneId, shot.id).includes(e.id),
    ),
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
      craftInstructions(inputs.craft),
      operation === "video"
        ? videoMotionInstructions(
            inputs.craft,
            shot.movement,
            shot.targetFrames / 30,
            d.studio.setups[shot.sceneId]?.direction.notes,
            !!inputs.startingFrameAssetId,
          )
        : "",
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

/** Keep cinematic direction readable while preserving the structured settings in each job. */
export const defaultCraft: CraftSettings = {
  lens: "50 mm",
  angle: "Eye level",
  lighting: "Warm practical",
  focus: "Shallow",
  motionStrength: 25,
  easing: "Ease in / out",
  negativePrompt: "",
};
export function craftInstructions(craft?: CraftSettings) {
  if (!craft) return "";
  return [
    `Composition: ${craft.lens} lens look, ${craft.angle.toLowerCase()}, ${craft.focus.toLowerCase()} focus.`,
    `Lighting: ${craft.lighting}.`,
    `Motion: ${craft.motionStrength}% intensity, ${craft.easing.toLowerCase()}.`,
    craft.negativePrompt.trim() ? `Avoid: ${craft.negativePrompt.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Motion directions are only added to video prompts; frame generation keeps composition instructions. */
export function videoMotionInstructions(
  craft: CraftSettings,
  movement: string | undefined,
  seconds: number,
  continuity = "",
  hasStartingFrame = false,
) {
  return [
    hasStartingFrame ? "Begin from the provided starting image." : "",
    `Video duration: ${seconds} seconds.`,
    `Camera movement: ${movement || "Static"}${movement && movement !== "Static" && craft.cameraSpeed ? `, ${craft.cameraSpeed.toLowerCase()}` : ""}.`,
    craft.actionTiming ? `Action timing: ${craft.actionTiming}.` : "",
    craft.performanceTone ? `Performance: ${craft.performanceTone}.` : "",
    craft.gazeDirection ? `Gaze: ${craft.gazeDirection}.` : "",
    craft.environmentMotion?.trim()
      ? `Background motion: ${craft.environmentMotion.trim()}`
      : "",
    craft.endingBeat?.trim() ? `End of take: ${craft.endingBeat.trim()}` : "",
    continuity.trim() ? `Continuity: ${continuity.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
