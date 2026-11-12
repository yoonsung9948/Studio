import { uid, type Data } from "./types";
import {
  assetSourceSubject,
  assetSubject,
  objectOwner,
  type AssetSubject,
} from "./asset-library";
import { episodeContinuity } from "./episode-resources";
import {
  episodeReferenceCharacters,
  linkCharacterToEpisode,
  lookSceneUsage,
  referenceEpisode,
} from "./episode-characters";
import { produceUrl } from "./produce-route";

export function episodeAssetSubjects(
  data: Data,
  episodeId: string,
  category: string,
): AssetSubject[] {
  referenceEpisode(data, episodeId);
  if (category === "characters")
    return episodeReferenceCharacters(data, episodeId).map((c) => ({
      kind: "character",
      id: c.id,
    }));
  const refs = episodeContinuity(data, episodeId);
  return (category === "places" ? refs.locations : refs.props).map((entry) => ({
    kind: category === "places" ? "place" : "prop",
    id: entry.id,
  }));
}

/** Usage is derived from membership and assignments; it is never maintained as a second connection list. */
export function assetUsage(
  data: Data,
  subject: AssetSubject,
  episodeId?: string,
) {
  const source = assetSourceSubject(data, subject);
  const family = (candidate: AssetSubject) =>
    assetSourceSubject(data, candidate).id === source.id;
  return Object.values(data.episodes)
    .filter((e) => !episodeId || e.id === episodeId)
    .flatMap((episode) => {
      const project = data.projects[episode.projectId];
      if (
        episode.archived ||
        !project ||
        project.archived ||
        project.unfiled ||
        !project.episodeIds.includes(episode.id)
      )
        return [];
      const refs = episodeContinuity(data, episode.id);
      const matches =
        subject.kind === "look"
          ? lookSceneUsage(data, episode.id, subject.id).map(
              (entry) => entry.scene.id,
            )
          : subject.kind === "character"
            ? refs.cast
                .filter((entry) => family({ kind: "character", id: entry.id }))
                .flatMap((entry) => entry.sceneIds)
            : (subject.kind === "place" ? refs.locations : refs.props)
                .filter((entry) => family({ ...subject, id: entry.id }))
                .flatMap((entry) => entry.sceneIds);
      const linked =
        subject.kind === "look"
          ? data.studio.looks[subject.id]?.episodeId === episode.id ||
            matches.length > 0
          : episodeAssetSubjects(
              data,
              episode.id,
              subject.kind === "character"
                ? "characters"
                : subject.kind === "place"
                  ? "places"
                  : "props",
            ).some(family);
      if (!linked) return [];
      return [
        {
          episode,
          project,
          referencePath: `/projects/${project.id}/episodes/${episode.id}/references?kind=${subject.kind === "prop" ? "props" : subject.kind === "place" ? "places" : "characters"}`,
          scenes: [...new Set(matches)].flatMap((id) => {
            const scene = data.scenes[id];
            return scene && !scene.archived && scene.episodeId === episode.id
              ? [
                  {
                    scene,
                    path: produceUrl(project.id, episode.id, "plan", id),
                  },
                ]
              : [];
          }),
        },
      ];
    });
}

/** Copy source media once into the production, preserving project ownership and episode isolation. */
export function linkAssetToEpisode(
  data: Data,
  episodeId: string,
  subject: AssetSubject,
): AssetSubject {
  const episode = referenceEpisode(data, episodeId);
  if (subject.kind === "character")
    return {
      kind: "character",
      id: linkCharacterToEpisode(data, episodeId, subject.id),
    };
  if (subject.kind === "look") throw Error("Add the character identity first.");
  const source = assetSubject(data, subject),
    owner = objectOwner(data, subject);
  if (!source || !owner) throw Error("Asset unavailable.");
  let id = subject.id;
  if (source.projectId !== episode.projectId) {
    const existing =
      subject.kind === "place"
        ? Object.values(data.studio.locations).find(
            (l) =>
              l.projectId === episode.projectId &&
              l.sourceAssetId === subject.id,
          )
        : data.projects[episode.projectId].worldElements?.find(
            (p) => p.kind === "prop" && p.sourceAssetId === subject.id,
          );
    id = existing?.id ?? uid(subject.kind);
    if (!existing) {
      const media = new Map<string, string>();
      const copyAsset = (oldId?: string) => {
        if (
          !oldId ||
          !data.assets[oldId] ||
          data.assets[oldId].projectId !== source.projectId ||
          data.assets[oldId].archived ||
          data.assets[oldId].missing
        )
          return undefined;
        if (!media.has(oldId)) {
          const nextId = uid("asset");
          media.set(oldId, nextId);
          data.assets[nextId] = {
            ...data.assets[oldId],
            id: nextId,
            projectId: episode.projectId,
          };
        }
        return media.get(oldId);
      };
      const versions = new Map<string, string>();
      const copyVersion = (oldId?: string) => {
        if (!oldId) return undefined;
        if (versions.has(oldId)) return versions.get(oldId);
        const old = data.studio.versions[oldId];
        if (
          !old ||
          old.ownerId !== subject.id ||
          old.ownerKind !== (subject.kind === "place" ? "location" : "prop")
        )
          return undefined;
        const assetId = copyAsset(old.assetId);
        if (!assetId) return undefined;
        const nextId = uid("version");
        versions.set(oldId, nextId);
        data.studio.versions[nextId] = {
          ...old,
          id: nextId,
          projectId: episode.projectId,
          ownerId: id,
          assetId,
        };
        return nextId;
      };
      const savedViewIds: Record<string, string> = {};
      for (const [view, version] of Object.entries(owner.savedViewIds ?? {})) {
        const copied = copyVersion(version);
        if (copied) savedViewIds[view] = copied;
      }
      const shared = {
        id,
        name: owner.name,
        description: owner.description,
        revision: owner.revision ?? 1,
        sourceAssetId: subject.id,
        assetId: copyAsset(owner.assetId),
        primaryVersionId: copyVersion(owner.primaryVersionId),
        savedViewIds,
      };
      if (subject.kind === "place") {
        const location = data.studio.locations[subject.id];
        data.studio.locations[id] = {
          ...location,
          ...shared,
          projectId: episode.projectId,
          referenceAssetIds: location.referenceAssetIds.flatMap(
            (a) => copyAsset(a) ?? [],
          ),
        };
      } else
        (data.projects[episode.projectId].worldElements ??= []).push({
          ...shared,
          kind: "prop",
        });
    }
  }
  const ids =
    subject.kind === "place"
      ? (episode.locationIds ??= [])
      : (episode.propIds ??= []);
  if (!ids.includes(id)) ids.push(id);
  return { ...subject, id };
}
