import type { Data } from "./types";
import { generationInputs, effectiveWorldElements } from "./generation-inputs";
import { effectiveCast } from "./studio-selectors";
import { activeEpisodeShots } from "./episode-review";

interface ReferenceUsage {
  id: string;
  sceneIds: string[];
}

/** Shared source assets stay project-owned; membership in an episode follows actual usage. */
export function episodeMediaAssetIds(
  data: Data,
  episodeId: string,
): Set<string> {
  const ids = new Set<string>();
  const episode = data.episodes[episodeId];
  if (
    !episode ||
    episode.archived ||
    data.projects[episode.projectId]?.archived ||
    !data.projects[episode.projectId]?.episodeIds.includes(episodeId)
  )
    return ids;
  const add = (id?: string) => {
    if (id && data.assets[id]?.projectId === episode.projectId) ids.add(id);
  };
  const version = (id?: string) => add(data.studio.versions[id ?? ""]?.assetId);
  for (const id of episode.mediaAssetIds ?? []) add(id);
  const shots = activeEpisodeShots(data, episodeId),
    shotIds = new Set(shots.map((shot) => shot.id));
  for (const take of Object.values(data.takes)) {
    if (
      !shotIds.has(take.shotId) ||
      data.shots[take.shotId].discardedTakeIds?.includes(take.id)
    )
      continue;
    add(take.assetId);
    for (const ref of take.references ?? []) {
      version(ref.identityVersionId);
      version(ref.lookVersionId);
      ref.referenceVersionIds.forEach(version);
    }
  }
  for (const characterId of episode.characterIds ?? []) {
    version(data.characters[characterId]?.canonicalVersionId);
    for (const ref of Object.values(data.studio.references))
      if (ref.characterId === characterId && !ref.lookId)
        version(ref.activeVersionId);
  }
  for (const look of Object.values(data.studio.looks)) {
    if (look.episodeId !== episodeId) continue;
    version(look.primaryVersionId);
    for (const ref of Object.values(data.studio.references))
      if (ref.lookId === look.id) version(ref.activeVersionId);
  }
  const refs = episodeContinuity(data, episodeId);
  for (const entry of refs.cast) {
    version(data.characters[entry.id]?.canonicalVersionId);
    for (const lookId of entry.lookIds)
      version(data.studio.looks[lookId]?.primaryVersionId);
  }
  for (const entry of refs.locations) {
    const location = data.studio.locations[entry.id];
    add(location.assetId);
    version(location.primaryVersionId);
    location.referenceAssetIds.forEach(add);
    Object.values(location.savedViewIds ?? {}).forEach(version);
  }
  for (const entry of refs.props) {
    const prop = data.projects[episode.projectId].worldElements?.find(
      (item) => item.id === entry.id,
    );
    add(prop?.assetId);
    version(prop?.primaryVersionId);
    Object.values(prop?.savedViewIds ?? {}).forEach(version);
  }
  for (const sceneId of episode.sceneIds) {
    const scene = data.scenes[sceneId];
    if (!scene || scene.archived || scene.episodeId !== episodeId) continue;
    const scopedShots = shots.filter((shot) => shot.sceneId === sceneId);
    for (const shot of scopedShots.length ? scopedShots : [undefined]) {
      const inputs = generationInputs(data, sceneId, shot?.id);
      add(inputs.startingFrameAssetId);
      add(inputs.endingFrameAssetId);
      inputs.referenceInputs.forEach((ref) => add(ref.assetId));
      for (const cast of shot
        ? effectiveCast(data, shot.id)
        : (data.studio.setups[sceneId]?.cast ?? [])) {
        for (const referenceId of cast.referenceIds ?? [])
          version(data.studio.references[referenceId]?.activeVersionId);
      }
      for (const elementId of effectiveWorldElements(data, sceneId, shot?.id))
        add(
          data.projects[episode.projectId].worldElements?.find(
            (element) => element.id === elementId,
          )?.assetId,
        );
    }
  }
  return ids;
}

export function attachEpisodeMedia(
  data: Data,
  episodeId: string,
  assetId: string,
) {
  const episode = data.episodes[episodeId],
    asset = data.assets[assetId];
  if (
    !episode ||
    episode.archived ||
    !data.projects[episode.projectId]?.episodeIds.includes(episodeId) ||
    !asset ||
    asset.projectId !== episode.projectId ||
    asset.archived
  )
    throw Error("Choose media from this episode's production.");
  const ids = (episode.mediaAssetIds ??= []);
  if (!ids.includes(assetId)) ids.push(assetId);
}
interface CastUsage extends ReferenceUsage {
  lookIds: string[];
}

/** Episode references come from its active scene and shot assignments, never the project library. */
export function episodeContinuity(data: Data, episodeId: string) {
  const episode = data.episodes[episodeId];
  const cast = new Map<string, CastUsage>();
  const locations = new Map<string, ReferenceUsage>();
  const props = new Map<string, ReferenceUsage>();
  const notes: { sceneId: string; text: string }[] = [];
  if (
    !episode ||
    episode.archived ||
    !data.projects[episode.projectId]?.episodeIds.includes(episodeId) ||
    data.projects[episode.projectId]?.archived
  )
    return { cast: [], locations: [], props: [], notes };

  const projectProps = new Set(
    (data.projects[episode.projectId]?.worldElements ?? [])
      .filter((element) => element.kind === "prop")
      .map((element) => element.id),
  );
  const addUsage = (
    entries: Map<string, ReferenceUsage>,
    id: string,
    sceneId: string,
  ) => {
    const entry = entries.get(id) ?? { id, sceneIds: [] };
    if (!entry.sceneIds.includes(sceneId)) entry.sceneIds.push(sceneId);
    entries.set(id, entry);
  };

  for (const id of episode.locationIds ?? [])
    if (data.studio.locations[id]?.projectId === episode.projectId)
      locations.set(id, { id, sceneIds: [] });
  for (const id of episode.propIds ?? [])
    if (projectProps.has(id)) props.set(id, { id, sceneIds: [] });

  for (const sceneId of episode.sceneIds) {
    const scene = data.scenes[sceneId];
    if (!scene || scene.archived || scene.episodeId !== episodeId) continue;
    const setup = data.studio.setups[sceneId];
    const text = setup?.direction.notes.trim();
    if (text) notes.push({ sceneId, text });
    const shots = scene.shotIds.filter(
      (id) => data.shots[id]?.sceneId === sceneId && !data.shots[id].archived,
    );
    // A scene can have references before its first shot is added.
    const scopes = scene.shotIds.length ? shots : [undefined];
    for (const shotId of scopes) {
      const assignments = shotId
        ? effectiveCast(data, shotId)
        : (setup?.cast ?? []);
      for (const assignment of assignments) {
        const character = data.characters[assignment.characterId];
        if (character?.projectId !== episode.projectId) continue;
        const entry = cast.get(character.id) ?? {
          id: character.id,
          sceneIds: [],
          lookIds: [],
        };
        if (!entry.sceneIds.includes(sceneId)) entry.sceneIds.push(sceneId);
        if (
          assignment.lookId &&
          data.studio.looks[assignment.lookId]?.characterId === character.id &&
          !entry.lookIds.includes(assignment.lookId)
        )
          entry.lookIds.push(assignment.lookId);
        cast.set(character.id, entry);
      }
      const inputs = generationInputs(data, sceneId, shotId);
      if (
        inputs.locationId &&
        ["selected", "required"].includes(inputs.locationMode) &&
        data.studio.locations[inputs.locationId]?.projectId ===
          episode.projectId
      )
        addUsage(locations, inputs.locationId, sceneId);
      for (const propId of effectiveWorldElements(data, sceneId, shotId))
        if (projectProps.has(propId)) addUsage(props, propId, sceneId);
    }
  }
  return {
    cast: [...cast.values()],
    locations: [...locations.values()],
    props: [...props.values()],
    notes,
  };
}
