import { CONFIG, uid, type Character, type Data } from "./types";
import {
  createCharacter,
  enqueueStudio,
  setSceneCast,
} from "./studio-commands";
import {
  characterReferences,
  referenceValid,
  targetBusy,
  validVersion,
  versionAsset,
} from "./studio-selectors";
import { createWorkspaceProject } from "./workspace";
import { episodeContinuity } from "./episode-resources";

export const characterViewSlots = [
  { type: "front", label: "Front portrait" },
  { type: "three_quarter", label: "Three-quarter" },
  { type: "profile", label: "Left profile" },
  { type: "right_profile", label: "Right profile" },
  { type: "full_body", label: "Full body" },
  { type: "back", label: "Back view" },
] as const;
export type CharacterViewType = (typeof characterViewSlots)[number]["type"];

/** Legacy production characters remain available as sources without migrating saved projects. */
export function assetCharacters(data: Data) {
  return Object.values(data.characters).filter(
    (character) =>
      !character.sourceCharacterId &&
      data.projects[character.projectId] &&
      !data.projects[character.projectId].archived,
  );
}

export function assetLibraryOwner(data: Data) {
  let owner = Object.values(data.projects).find(
    (project) => project.assetLibrary && !project.archived,
  );
  if (!owner) {
    const id = createWorkspaceProject(data, "Asset library");
    owner = data.projects[id];
    owner.unfiled = true;
    owner.assetLibrary = true;
  }
  return owner.id;
}
export function createAssetCharacter(data: Data) {
  return createCharacter(data, assetLibraryOwner(data));
}

export function characterView(
  data: Data,
  character: Character,
  type: CharacterViewType,
) {
  const reference = characterReferences(data, character.id).find(
    (item) => item.type === type,
  );
  const operation = type === "front" ? "identity" : "reference";
  const ownerId = type === "front" ? character.id : reference?.id;
  const currentId =
    type === "front"
      ? character.canonicalVersionId
      : reference?.activeVersionId;
  const asset = versionAsset(data, currentId);
  const valid =
    type === "front"
      ? validVersion(data, currentId)
      : !!reference && referenceValid(data, reference.id);
  return {
    operation,
    ownerId,
    currentId,
    image:
      asset && !asset.missing && !asset.archived
        ? asset.url
        : type === "front"
          ? character.reference
          : undefined,
    ready: valid && !!asset && !asset.archived,
    busy: !!ownerId && targetBusy(data, operation, ownerId),
  } as const;
}

export function generateAssetCharacterViews(
  data: Data,
  characterId: string,
  types: CharacterViewType[],
  count = 1,
  prompt = "",
) {
  const character = data.characters[characterId];
  if (!character) throw Error("Character unavailable.");
  if (!Number.isInteger(count) || count < 1 || count > 4)
    throw Error("Choose between one and four images.");
  const slots = [...new Set(types)];
  if (!slots.length) throw Error("Choose a view to generate.");
  if (data.credits < slots.length * count * CONFIG.imageCost)
    throw Error("Not enough credits.");
  for (const type of slots) {
    let target = characterView(data, character, type);
    if (target.busy) throw Error("This view is already generating.");
    if (!target.ownerId) {
      const id = uid("reference");
      data.studio.references[id] = {
        id,
        characterId,
        type,
      };
      target = characterView(data, character, type);
    }
    const label = characterViewSlots.find((slot) => slot.type === type)!.label;
    enqueueStudio(data, target.operation, [target.ownerId!], false, {
      count,
      specification: `${label}. ${prompt.trim() || character.appearance || character.description}\nPreserve face, haircut and neutral lighting.`,
    });
  }
}

export function characterEpisodeUsage(data: Data, sourceId: string) {
  const family = new Set(
    Object.values(data.characters)
      .filter(
        (character) =>
          character.id === sourceId || character.sourceCharacterId === sourceId,
      )
      .map((character) => character.id),
  );
  return Object.values(data.episodes).filter(
    (episode) =>
      !episode.archived &&
      !data.projects[episode.projectId]?.archived &&
      data.projects[episode.projectId]?.episodeIds.includes(episode.id) &&
      ((episode.characterIds ?? []).some((id) => family.has(id)) ||
        episodeContinuity(data, episode.id).cast.some((cast) =>
          family.has(cast.id),
        )),
  );
}

/** Reuse snapshots the source into a production; foreign IDs never enter its cast or media. */
export function productionCharacter(
  data: Data,
  sourceId: string,
  projectId: string,
) {
  const source = data.characters[sourceId];
  if (
    !source ||
    !data.projects[source.projectId] ||
    data.projects[source.projectId].archived
  )
    throw Error("Character unavailable.");
  if (
    source.canonicalVersionId &&
    !validVersion(data, source.canonicalVersionId)
  )
    throw Error("Save a current front portrait before reusing this character.");
  if (source.projectId === projectId) return source.id;
  const existing = Object.values(data.characters).find(
    (character) =>
      character.projectId === projectId &&
      character.sourceCharacterId === sourceId,
  );
  if (existing) return existing.id;
  const id = createCharacter(data, projectId);
  Object.assign(data.characters[id], structuredClone(source), {
    id,
    projectId,
    sourceCharacterId: sourceId,
    canonicalVersionId: undefined,
  });
  const assets = new Map<string, string>();
  const versions = new Map<string, string>();
  const copyVersion = (
    versionId: string,
    ownerKind: "identity" | "reference",
    ownerId: string,
  ) => {
    const original = data.studio.versions[versionId];
    const asset = original && data.assets[original.assetId];
    if (!original || !asset || asset.missing || asset.archived)
      return undefined;
    let assetId = assets.get(asset.id);
    if (!assetId) {
      assetId = uid("asset");
      assets.set(asset.id, assetId);
      data.assets[assetId] = {
        ...structuredClone(asset),
        id: assetId,
        projectId,
      };
    }
    const next = uid("version");
    if (ownerKind === "identity") versions.set(versionId, next);
    data.studio.versions[next] = {
      ...structuredClone(original),
      id: next,
      projectId,
      assetId,
      ownerKind,
      ownerId,
      sourceIdentityVersionId:
        versions.get(original.sourceIdentityVersionId ?? "") ??
        (ownerKind === "reference" && original.ownerKind === "identity"
          ? data.characters[id].canonicalVersionId
          : undefined),
    };
    return next;
  };
  if (source.canonicalVersionId)
    data.characters[id].canonicalVersionId = copyVersion(
      source.canonicalVersionId,
      "identity",
      id,
    );
  for (const reference of characterReferences(data, sourceId)) {
    const target = characterReferences(data, id).find(
      (item) => item.type === reference.type,
    );
    const refId = target?.id ?? uid("reference");
    data.studio.references[refId] = {
      id: refId,
      characterId: id,
      type: reference.type,
      activeVersionId: reference.activeVersionId
        ? copyVersion(reference.activeVersionId, "reference", refId)
        : undefined,
    };
  }
  return id;
}

export function useAssetCharacterInScene(
  data: Data,
  sourceId: string,
  sceneId: string,
) {
  const scene = data.scenes[sceneId];
  const episode = scene && data.episodes[scene.episodeId];
  const project = episode && data.projects[episode.projectId];
  if (
    !scene ||
    scene.archived ||
    !episode ||
    episode.archived ||
    !project ||
    project.archived ||
    project.unfiled ||
    !project.episodeIds.includes(episode.id) ||
    !episode.sceneIds.includes(sceneId)
  )
    throw Error("Choose an active episode scene.");
  if (scene.shotIds.some((id) => data.shots[id]?.locked))
    throw Error("Unlock the scene's shots before changing its cast.");
  const characterId = productionCharacter(data, sourceId, project.id);
  const cast = data.studio.setups[sceneId]?.cast ?? [];
  if (!cast.some((entry) => entry.characterId === characterId))
    setSceneCast(data, sceneId, [...cast, { characterId }]);
  return characterId;
}
