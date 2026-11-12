import type {
  Asset,
  Character,
  Data,
  LocationReference,
} from "../../domain/types";

/** Only display available images belonging to the current production. */
export function referenceImage(
  data: Data,
  projectId: string,
  assetId?: string,
) {
  const asset = data.assets[assetId ?? ""];
  return asset?.projectId === projectId &&
    asset.kind === "image" &&
    asset.url &&
    !asset.archived &&
    !asset.missing
    ? asset
    : undefined;
}

export function characterPortrait(data: Data, character: Character) {
  const version = data.studio.versions[character.canonicalVersionId ?? ""];
  if (version)
    return referenceImage(data, character.projectId, version.assetId)?.url;
  return character.reference || undefined;
}

/** A contact sheet contains saved views, never historical generation candidates. */
export function locationImages(
  data: Data,
  location: LocationReference,
): Asset[] {
  const primary = data.studio.versions[location.primaryVersionId ?? ""];
  const ids = [
    primary?.assetId,
    location.assetId,
    ...location.referenceAssetIds,
    ...Object.values(location.savedViewIds ?? {}).map(
      (id) => data.studio.versions[id]?.assetId,
    ),
  ];
  const images: Asset[] = [];
  const urls = new Set<string>();
  for (const id of ids) {
    const image = referenceImage(data, location.projectId, id);
    if (image && !urls.has(image.url)) {
      urls.add(image.url);
      images.push(image);
    }
  }
  return images;
}

export const worldReferencePath = (
  projectId: string,
  kind: "place" | "prop",
  id: string,
) => `/projects/${projectId}/world?${new URLSearchParams({ kind, id })}`;
