import type { Asset, Data } from "../domain/types";

/** Derive labels from production records rather than the image or filename. */
export function describeLibraryAsset(data: Data, asset: Asset) {
  const version = Object.values(data.studio.versions).find(
    (version) => version.assetId === asset.id,
  );
  const takes = Object.values(data.takes).filter(
    (take) => take.assetId === asset.id,
  );
  const location = Object.values(data.studio.locations).some(
    (location) =>
      location.assetId === asset.id ||
      location.referenceAssetIds.includes(asset.id),
  );
  const prop = data.projects[asset.projectId]?.worldElements?.some(
    (element) => element.kind === "prop" && element.assetId === asset.id,
  );
  return {
    category:
      location || version?.ownerKind === "location"
        ? "Location"
        : prop || version?.ownerKind === "prop"
          ? "Prop"
          : version
            ? "Reference"
            : takes.length
              ? asset.kind === "video"
                ? "Take"
                : "Frame"
              : "Imported",
    approval:
      version?.approval ??
      (takes.some((take) => take.approved)
        ? "approved"
        : takes.length
          ? "needs_review"
          : undefined),
  } as const;
}
