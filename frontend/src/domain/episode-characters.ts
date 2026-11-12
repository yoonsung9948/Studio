import { CONFIG, uid, type Data } from "./types";
import { productionCharacter } from "./asset-characters";
import { episodeContinuity } from "./episode-resources";
import { createLook, enqueueStudio, setSceneCast } from "./studio-commands";
import {
  effectiveCast,
  lookReady,
  referenceValid,
  targetBusy,
  versionAsset,
} from "./studio-selectors";

export function referenceEpisode(data: Data, episodeId: string) {
  const episode = data.episodes[episodeId];
  const project = episode && data.projects[episode.projectId];
  if (
    !episode ||
    episode.archived ||
    !project ||
    project.archived ||
    project.unfiled ||
    !project.episodeIds.includes(episodeId)
  )
    throw Error("Episode unavailable.");
  return episode;
}
export function episodeReferenceCharacters(data: Data, episodeId: string) {
  const episode = referenceEpisode(data, episodeId);
  return [
    ...new Set([
      ...(episode.characterIds ?? []),
      ...episodeContinuity(data, episodeId).cast.map((entry) => entry.id),
    ]),
  ]
    .map((id) => data.characters[id])
    .filter(
      (character) => character && character.projectId === episode.projectId,
    );
}
export function linkCharacterToEpisode(
  data: Data,
  episodeId: string,
  sourceId: string,
) {
  const episode = referenceEpisode(data, episodeId);
  const id = productionCharacter(data, sourceId, episode.projectId);
  const ids = (episode.characterIds ??= []);
  if (!ids.includes(id)) ids.push(id);
  return id;
}
export function createEpisodeLook(
  data: Data,
  episodeId: string,
  characterId: string,
  name = "Untitled look",
) {
  const episode = referenceEpisode(data, episodeId);
  if (
    !episodeReferenceCharacters(data, episodeId).some(
      (character) => character.id === characterId,
    )
  )
    throw Error("Link this character to the episode first.");
  const id = createLook(data, characterId, name);
  data.studio.looks[id].episodeId = episode.id;
  return id;
}
export function lookSceneUsage(data: Data, episodeId: string, lookId: string) {
  const episode = referenceEpisode(data, episodeId);
  return episode.sceneIds
    .map((id) => data.scenes[id])
    .filter(
      (scene) => scene && !scene.archived && scene.episodeId === episodeId,
    )
    .flatMap((scene) => {
      const shots = scene.shotIds
        .map((id) => data.shots[id])
        .filter((shot) => shot && !shot.archived && shot.sceneId === scene.id);
      const inherited = data.studio.setups[scene.id]?.cast.some(
        (cast) => cast.lookId === lookId,
      );
      const used = shots.filter((shot) =>
        effectiveCast(data, shot.id).some((cast) => cast.lookId === lookId),
      );
      return inherited || used.length
        ? [
            {
              scene,
              shots: used.length,
              inherited: inherited
                ? shots.filter((shot) => !shot.castOverride).length
                : 0,
            },
          ]
        : [];
    });
}
export function episodeCharacterLooks(
  data: Data,
  episodeId: string,
  characterId: string,
) {
  referenceEpisode(data, episodeId);
  return Object.values(data.studio.looks).filter(
    (look) =>
      look.characterId === characterId &&
      (look.episodeId === episodeId ||
        (!look.episodeId &&
          lookSceneUsage(data, episodeId, look.id).length > 0)),
  );
}

/** Localize a legacy shared look without changing its images or another episode's assignments. */
export function localizeEpisodeLook(
  data: Data,
  episodeId: string,
  lookId: string,
) {
  const episode = referenceEpisode(data, episodeId),
    source = data.studio.looks[lookId];
  if (
    !source ||
    data.characters[source.characterId]?.projectId !== episode.projectId
  )
    throw Error("Look unavailable.");
  if (source.episodeId === episodeId) return lookId;
  if (source.episodeId) throw Error("Look belongs to another episode.");
  const existing = Object.values(data.studio.looks).find(
    (look) => look.episodeId === episodeId && look.sourceLookId === lookId,
  );
  if (existing) return existing.id;
  if (!lookSceneUsage(data, episodeId, lookId).length)
    throw Error("Look belongs to another episode.");
  const id = createEpisodeLook(
    data,
    episodeId,
    source.characterId,
    source.name,
  );
  Object.assign(data.studio.looks[id], structuredClone(source), {
    id,
    episodeId,
    sourceLookId: source.id,
    primaryVersionId: undefined,
  });
  const copyVersion = (
    versionId: string | undefined,
    ownerKind: "look" | "reference",
    ownerId: string,
    front?: string,
  ) => {
    const version = data.studio.versions[versionId ?? ""];
    if (!version) return undefined;
    const next = uid("version");
    data.studio.versions[next] = {
      ...structuredClone(version),
      id: next,
      ownerKind,
      ownerId,
      sourceLookVersionId: front,
    };
    return next;
  };
  const front = copyVersion(source.primaryVersionId, "look", id);
  data.studio.looks[id].primaryVersionId = front;
  const refs = new Map<string, string>();
  for (const ref of Object.values(data.studio.references).filter(
    (ref) => ref.lookId === lookId,
  )) {
    const next = uid("reference");
    refs.set(ref.id, next);
    data.studio.references[next] = {
      ...ref,
      id: next,
      lookId: id,
      activeVersionId: copyVersion(
        ref.activeVersionId,
        "reference",
        next,
        data.studio.versions[ref.activeVersionId ?? ""]?.sourceLookVersionId ===
          source.primaryVersionId
          ? front
          : undefined,
      ),
    };
  }
  const remap = (cast: NonNullable<Data["shots"][string]["castOverride"]>) =>
    cast.map((entry) =>
      entry.lookId === lookId
        ? {
            ...entry,
            lookId: id,
            referenceIds: entry.referenceIds?.map(
              (ref) => refs.get(ref) ?? ref,
            ),
          }
        : entry,
    );
  for (const sceneId of episode.sceneIds) {
    const scene = data.scenes[sceneId];
    if (!scene || scene.archived || scene.episodeId !== episodeId) continue;
    const setup = data.studio.setups[sceneId];
    if (setup) setup.cast = remap(setup.cast);
    for (const shotId of scene.shotIds) {
      const shot = data.shots[shotId];
      if (shot && !shot.archived && shot.castOverride)
        shot.castOverride = remap(shot.castOverride);
    }
  }
  return id;
}

/** Only the selected scenes inherit this look; explicit shot overrides remain explicit. */
export function assignEpisodeLook(
  data: Data,
  episodeId: string,
  lookId: string,
  sceneIds: string[],
) {
  const episode = referenceEpisode(data, episodeId),
    look = data.studio.looks[lookId];
  if (!look || look.episodeId !== episodeId)
    throw Error("Choose a look from this episode.");
  for (const sceneId of new Set(sceneIds)) {
    const scene = data.scenes[sceneId];
    if (
      !scene ||
      scene.archived ||
      scene.episodeId !== episodeId ||
      !episode.sceneIds.includes(sceneId)
    )
      throw Error("Choose scenes from this episode.");
    if (
      scene.shotIds.some(
        (id) =>
          data.shots[id]?.locked &&
          !data.shots[id].archived &&
          !data.shots[id].castOverride,
      )
    )
      throw Error("Unlock the selected scene's shots first.");
    const cast = data.studio.setups[sceneId]?.cast ?? [];
    const current = cast.find(
      (entry) => entry.characterId === look.characterId,
    );
    if (current?.lookId === lookId) continue;
    const assignment = { characterId: look.characterId, lookId };
    setSceneCast(
      data,
      sceneId,
      current
        ? cast.map((entry) =>
            entry.characterId === look.characterId ? assignment : entry,
          )
        : [...cast, assignment],
    );
  }
}
export function removeEpisodeLookFromScene(
  data: Data,
  episodeId: string,
  lookId: string,
  sceneId: string,
) {
  const episode = referenceEpisode(data, episodeId),
    look = data.studio.looks[lookId];
  if (
    !look ||
    look.episodeId !== episodeId ||
    !episode.sceneIds.includes(sceneId)
  )
    throw Error("Scene unavailable.");
  const scene = data.scenes[sceneId];
  if (
    !scene ||
    scene.archived ||
    scene.shotIds.some(
      (id) => data.shots[id]?.locked && !data.shots[id].castOverride,
    )
  )
    throw Error("Unlock the scene's shots first.");
  const cast = data.studio.setups[sceneId]?.cast ?? [];
  setSceneCast(
    data,
    sceneId,
    cast.map((entry) =>
      entry.lookId === lookId ? { characterId: entry.characterId } : entry,
    ),
  );
}
export const lookViewSlots = [
  { type: "front", label: "Front portrait" },
  { type: "profile", label: "Profile" },
  { type: "full_body", label: "Full body" },
  { type: "back", label: "Back view" },
] as const;
export type LookViewType = (typeof lookViewSlots)[number]["type"];
export function episodeLookView(
  data: Data,
  lookId: string,
  type: LookViewType,
) {
  const look = data.studio.looks[lookId];
  const reference = Object.values(data.studio.references).find(
    (ref) => ref.lookId === lookId && ref.type === type,
  );
  const operation = type === "front" ? "look" : "reference";
  const ownerId = type === "front" ? look.id : reference?.id;
  const currentId =
    type === "front" ? look.primaryVersionId : reference?.activeVersionId;
  const asset = versionAsset(data, currentId);
  return {
    operation,
    ownerId,
    currentId,
    image: asset && !asset.missing && !asset.archived ? asset.url : undefined,
    ready:
      type === "front"
        ? lookReady(data, lookId) && !asset?.archived
        : !!reference && referenceValid(data, reference.id) && !asset?.archived,
    busy: !!ownerId && targetBusy(data, operation, ownerId),
  } as const;
}
export function generateEpisodeLookViews(
  data: Data,
  episodeId: string,
  lookId: string,
  types: LookViewType[],
  count: number,
  prompt: string,
) {
  referenceEpisode(data, episodeId);
  const look = data.studio.looks[lookId];
  if (!look || look.episodeId !== episodeId)
    throw Error("Look belongs to another episode.");
  const slots = [...new Set(types)];
  if (!slots.length || !Number.isInteger(count) || count < 1 || count > 4)
    throw Error("Choose one to four images.");
  if (data.credits < slots.length * count * CONFIG.imageCost)
    throw Error("Not enough credits.");
  if (!look.description.trim() && !prompt.trim())
    throw Error("Describe the look before generation.");
  for (const type of slots) {
    let target = episodeLookView(data, lookId, type);
    if (target.busy) throw Error("This view is already generating.");
    if (!target.ownerId) {
      const id = uid("reference");
      data.studio.references[id] = {
        id,
        lookId,
        characterId: look.characterId,
        type,
      };
      target = episodeLookView(data, lookId, type);
    }
    enqueueStudio(data, target.operation, [target.ownerId!], false, {
      count,
      specification: `${lookViewSlots.find((slot) => slot.type === type)!.label}. ${look.description}\n${prompt}\n${look.styling}`,
    });
  }
}
