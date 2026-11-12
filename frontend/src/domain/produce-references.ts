import type { Data } from "./types";
import { effectiveCast, versionAsset } from "./studio-selectors";
import { generationInputs, effectiveWorldElements } from "./generation-inputs";
export function referenceCards(data: Data, sceneId: string, shotId?: string) {
  const scene = data.scenes[sceneId],
    episode = data.episodes[scene.episodeId];
  const inputs = generationInputs(data, sceneId, shotId);
  const cast = shotId
    ? effectiveCast(data, shotId)
    : (data.studio.setups[sceneId]?.cast ?? []);
  const characters = cast.flatMap((entry) => {
    const character = data.characters[entry.characterId],
      look = data.studio.looks[entry.lookId ?? ""];
    if (!character) return [];
    const image =
      versionAsset(data, look?.primaryVersionId)?.url ||
      versionAsset(data, character.canonicalVersionId)?.url ||
      character.reference;
    return [
      {
        id: character.id,
        category: "character",
        name: character.name,
        detail: look?.name ?? "Character",
        image,
      },
    ];
  });
  const location =
    inputs.locationMode === "none"
      ? undefined
      : data.studio.locations[inputs.locationId ?? ""];
  const props = (data.projects[episode.projectId].worldElements ?? []).filter(
    (item) => effectiveWorldElements(data, sceneId, shotId).includes(item.id),
  );
  return [
    ...characters,
    ...(location
      ? [
          {
            id: location.id,
            category: "place",
            name: location.name,
            detail: "Location",
            image:
              data.assets[location.assetId ?? ""]?.url ||
              versionAsset(data, location.primaryVersionId)?.url,
          },
        ]
      : []),
    ...props.map((item) => ({
      id: item.id,
      category: "prop",
      name: item.name,
      detail: "Prop",
      image: data.assets[item.assetId ?? ""]?.url,
    })),
    ...inputs.referenceInputs.map((entry) => ({
      id: entry.assetId,
      category: "upload",
      name: data.assets[entry.assetId]?.title ?? "Reference",
      detail: entry.purpose.replaceAll("_", " "),
      image: data.assets[entry.assetId]?.url,
    })),
  ];
}
