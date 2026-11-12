import { CONFIG, uid, type Data } from "./types";
import {
  assetCharacters,
  assetLibraryOwner,
  characterView,
  characterViewSlots,
  generateAssetCharacterViews,
} from "./asset-characters";
import {
  episodeLookView,
  generateEpisodeLookViews,
  lookViewSlots,
} from "./episode-characters";
import {
  bumpStudio,
  createLocation,
  enqueueStudio,
  targetInfo,
  approveVersion,
} from "./studio-commands";
import { targetBusy, versionsFor, versionAsset } from "./studio-selectors";

/** A view target is a reference to an existing domain entity, never another asset model. */
export type AssetSubject = {
  kind: "character" | "look" | "place" | "prop";
  id: string;
};
export type AssetCategory = "characters" | "places" | "props";
export const assetCategories: AssetCategory[] = [
  "characters",
  "places",
  "props",
];
export const categoryFor = (subject: AssetSubject): AssetCategory =>
  subject.kind === "place"
    ? "places"
    : subject.kind === "prop"
      ? "props"
      : "characters";
export const assetSubjectKey = (subject: AssetSubject) =>
  `${subject.kind}:${subject.id}`;

function availableImage(data: Data, projectId: string, assetId?: string) {
  const asset = data.assets[assetId ?? ""];
  return asset?.projectId === projectId &&
    asset.kind === "image" &&
    !asset.archived &&
    !asset.missing
    ? asset.url
    : undefined;
}
export function assetSubject(data: Data, subject: AssetSubject) {
  if (subject.kind === "character") {
    const item = data.characters[subject.id];
    if (
      item &&
      data.projects[item.projectId] &&
      !data.projects[item.projectId].archived
    )
      return {
        subject,
        name: item.name,
        description: item.appearance || item.description,
        projectId: item.projectId,
        image: item.canonicalVersionId
          ? availableImage(
              data,
              item.projectId,
              data.studio.versions[item.canonicalVersionId]?.assetId,
            )
          : item.reference,
        sourceId: item.sourceCharacterId,
        revision: item.revision ?? 1,
      };
  } else if (subject.kind === "look") {
    const item = data.studio.looks[subject.id],
      character = item && data.characters[item.characterId];
    if (
      item &&
      character &&
      data.projects[character.projectId] &&
      !data.projects[character.projectId].archived
    )
      return {
        subject,
        name: `${character.name} / ${item.name}`,
        description: item.description,
        projectId: character.projectId,
        image: item.primaryVersionId
          ? availableImage(
              data,
              character.projectId,
              data.studio.versions[item.primaryVersionId]?.assetId,
            )
          : character.reference,
        sourceId: character.sourceCharacterId ?? character.id,
        revision: item.revision,
      };
  } else if (subject.kind === "place") {
    const item = data.studio.locations[subject.id];
    if (
      item &&
      data.projects[item.projectId] &&
      !data.projects[item.projectId].archived
    )
      return {
        subject,
        name: item.name,
        description: item.description,
        projectId: item.projectId,
        image:
          availableImage(data, item.projectId, item.assetId) ||
          availableImage(
            data,
            item.projectId,
            data.studio.versions[item.primaryVersionId ?? ""]?.assetId,
          ),
        sourceId: item.sourceAssetId,
        revision: item.revision,
      };
  } else {
    const project = Object.values(data.projects).find(
      (p) =>
        !p.archived &&
        p.worldElements?.some((e) => e.id === subject.id && e.kind === "prop"),
    );
    const item = project?.worldElements?.find((e) => e.id === subject.id);
    if (item && project)
      return {
        subject,
        name: item.name,
        description: item.description,
        projectId: project.id,
        image:
          availableImage(data, project.id, item.assetId) ||
          availableImage(
            data,
            project.id,
            data.studio.versions[item.primaryVersionId ?? ""]?.assetId,
          ),
        sourceId: item.sourceAssetId,
        revision: item.revision ?? 1,
      };
  }
  return undefined;
}
export function librarySubjects(data: Data, category: AssetCategory) {
  const subjects: AssetSubject[] =
    category === "characters"
      ? assetCharacters(data).map((item) => ({
          kind: "character",
          id: item.id,
        }))
      : category === "places"
        ? Object.values(data.studio.locations)
            .filter((item) => !item.sourceAssetId)
            .map((item) => ({ kind: "place", id: item.id }))
        : Object.values(data.projects).flatMap((project) =>
            (project.worldElements ?? [])
              .filter((item) => item.kind === "prop" && !item.sourceAssetId)
              .map((item) => ({ kind: "prop" as const, id: item.id })),
          );
  return subjects.flatMap((subject) => assetSubject(data, subject) ?? []);
}
export function createLibraryObject(data: Data, category: "places" | "props") {
  const projectId = assetLibraryOwner(data);
  if (category === "places")
    return {
      kind: "place",
      id: createLocation(data, projectId, "Untitled place"),
    } as const;
  const id = uid("prop");
  (data.projects[projectId].worldElements ??= []).push({
    id,
    kind: "prop",
    name: "Untitled prop",
    description: "",
    revision: 1,
  });
  return { kind: "prop", id } as const;
}
export function objectOwner(data: Data, subject: AssetSubject) {
  if (subject.kind === "place") return data.studio.locations[subject.id];
  if (subject.kind === "prop")
    return Object.values(data.projects)
      .flatMap((p) => p.worldElements ?? [])
      .find((e) => e.id === subject.id && e.kind === "prop");
  return undefined;
}
export function viewSlots(subject: AssetSubject) {
  if (subject.kind === "character") return [...characterViewSlots];
  if (subject.kind === "look") return [...lookViewSlots];
  return subject.kind === "place"
    ? [
        { type: "front", label: "Primary view" },
        { type: "interior", label: "Interior" },
        { type: "entrance", label: "Entrance" },
        { type: "detail", label: "Detail" },
      ]
    : [
        { type: "front", label: "Front" },
        { type: "back", label: "Back" },
        { type: "detail", label: "Detail" },
        { type: "side", label: "Side" },
      ];
}
export function assetView(data: Data, subject: AssetSubject, type: string) {
  if (!viewSlots(subject).some((slot) => slot.type === type))
    throw Error("Choose an available view.");
  if (subject.kind === "character")
    return characterView(
      data,
      data.characters[subject.id],
      type as Parameters<typeof characterView>[2],
    );
  if (subject.kind === "look")
    return episodeLookView(
      data,
      subject.id,
      type as Parameters<typeof episodeLookView>[2],
    );
  const owner = objectOwner(data, subject);
  const operation = subject.kind === "place" ? "location" : "prop";
  const currentId =
    owner?.savedViewIds?.[type] ??
    (type === "front" &&
    (!owner?.primaryVersionId ||
      (data.studio.versions[owner.primaryVersionId]?.viewType ?? "front") ===
        "front")
      ? owner?.primaryVersionId
      : undefined);
  const asset =
    versionAsset(data, currentId) ??
    (type === "front" && !owner?.primaryVersionId
      ? data.assets[owner?.assetId ?? ""]
      : undefined);
  return {
    operation,
    ownerId: subject.id,
    currentId,
    image:
      asset?.url && !asset.missing && !asset.archived ? asset.url : undefined,
    ready:
      !!asset?.url &&
      !asset.missing &&
      !asset.archived &&
      (!currentId ||
        data.studio.versions[currentId]?.revision === (owner?.revision ?? 1)),
    busy: targetBusy(data, operation, subject.id),
  } as const;
}
export function assetViewCandidates(
  data: Data,
  subject: AssetSubject,
  type: string,
) {
  const target = assetView(data, subject, type);
  return target.ownerId
    ? versionsFor(data, target.operation, target.ownerId).filter(
        (v) =>
          v.projectId === assetSubject(data, subject)?.projectId &&
          data.assets[v.assetId]?.projectId === v.projectId &&
          v.approval !== "rejected" &&
          (subject.kind === "character" ||
            subject.kind === "look" ||
            (v.viewType ?? "front") === type) &&
          !!data.assets[v.assetId]?.url &&
          !data.assets[v.assetId].missing &&
          !data.assets[v.assetId].archived,
      )
    : [];
}
export function generateAssetView(
  data: Data,
  subject: AssetSubject,
  type: string,
  count: number,
  prompt: string,
) {
  if (
    !viewSlots(subject).some((slot) => slot.type === type) ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 4
  )
    throw Error("Choose a view and between 1 and 4 images.");
  const item = assetSubject(data, subject);
  if (!item || !prompt.trim())
    throw Error("Describe the image you want to generate.");
  if (subject.kind === "character")
    return generateAssetCharacterViews(
      data,
      subject.id,
      [type as Parameters<typeof characterView>[2]],
      count,
      prompt,
    );
  if (subject.kind === "look") {
    const look = data.studio.looks[subject.id];
    if (look.episodeId)
      return generateEpisodeLookViews(
        data,
        look.episodeId,
        look.id,
        [type as Parameters<typeof episodeLookView>[2]],
        count,
        prompt,
      );
    let target = assetView(data, subject, type);
    if (!target.ownerId) {
      const id = uid("reference");
      data.studio.references[id] = {
        id,
        characterId: look.characterId,
        lookId: look.id,
        type: type as Parameters<typeof characterView>[2],
      };
      target = assetView(data, subject, type);
    }
    if (target.busy) throw Error("Wait for the current generation to finish.");
    return enqueueStudio(data, target.operation, [target.ownerId!], false, {
      count,
      specification: `${look.description}\n${prompt}\n${look.styling}`,
    });
  }
  const target = assetView(data, subject, type);
  if (target.busy) throw Error("Wait for the current generation to finish.");
  return enqueueStudio(data, target.operation, [subject.id], false, {
    count,
    viewType: type,
    specification: `${item.name}: ${item.description}\n${viewSlots(subject).find((slot) => slot.type === type)?.label}\n${prompt}`,
  });
}
export function saveAssetView(
  data: Data,
  subject: AssetSubject,
  type: string,
  versionId: string,
) {
  if (!assetViewCandidates(data, subject, type).some((v) => v.id === versionId))
    throw Error("Choose a candidate from this view.");
  if (subject.kind === "character" || subject.kind === "look")
    return approveVersion(data, versionId);
  const version = data.studio.versions[versionId],
    info = targetInfo(data, version.ownerKind, version.ownerId);
  if (version.revision !== info.revision)
    throw Error(
      "This candidate belongs to an older description. Generate a current view.",
    );
  const owner = objectOwner(data, subject)!;
  version.approval = "approved";
  (owner.savedViewIds ??= {})[type] = versionId;
  if (!owner.assetId) approveVersion(data, versionId);
  else bumpStudio(data, info.projectId);
}
export function uploadAssetView(
  data: Data,
  subject: AssetSubject,
  type: string,
  url: string,
  title: string,
) {
  const item = assetSubject(data, subject);
  if (!item) throw Error("Asset unavailable.");
  let target = assetView(data, subject, type);
  if (!target.ownerId) {
    const refId = uid("reference"),
      look =
        subject.kind === "look" ? data.studio.looks[subject.id] : undefined;
    data.studio.references[refId] = {
      id: refId,
      characterId: look?.characterId ?? subject.id,
      lookId: look?.id,
      type: type as Parameters<typeof characterView>[2],
    };
    target = assetView(data, subject, type);
  }
  const info = targetInfo(data, target.operation, target.ownerId!),
    assetId = uid("asset"),
    id = uid("version");
  data.assets[assetId] = {
    id: assetId,
    projectId: item.projectId,
    title,
    kind: "image",
    url,
    provenance: "Uploaded asset reference",
  };
  data.studio.versions[id] = {
    id,
    projectId: item.projectId,
    ownerKind: target.operation,
    ownerId: target.ownerId!,
    viewType: type,
    assetId,
    approval: "needs_review",
    revision: info.revision,
    sourceIdentityVersionId: info.identity,
    sourceLookVersionId: "sourceLook" in info ? info.sourceLook : undefined,
    specification: item.description,
    createdAt: Date.now(),
  };
  return id;
}
export function assetViewsPath(subject: AssetSubject, tab = "views") {
  const params = new URLSearchParams({ kind: categoryFor(subject), tab });
  if (subject.kind === "character") params.set("character", subject.id);
  else if (subject.kind === "look") params.set("look", subject.id);
  else params.set("asset", subject.id);
  return `/assets?${params}`;
}
export function assetSourceSubject(
  data: Data,
  subject: AssetSubject,
): AssetSubject {
  const sourceId = assetSubject(data, subject)?.sourceId;
  return subject.kind === "look"
    ? {
        kind: "character",
        id: sourceId ?? data.studio.looks[subject.id].characterId,
      }
    : sourceId && assetSubject(data, { ...subject, id: sourceId })
      ? { ...subject, id: sourceId }
      : subject;
}
export { CONFIG };
