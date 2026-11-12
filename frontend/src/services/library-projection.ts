import * as characters from "../api/characters";
import { referenceAPI, type ReferenceKind } from "../api/references";
import { getAsset, getAssetFileURL } from "../api/assets";
import { useStore } from "../stores/store";
import { type Data } from "../domain/types";
export async function refreshReferenceLibrary(signal: AbortSignal) {
  const projectId = "reference-library";
  const seen = {
    character: new Set<string>(),
    place: new Set<string>(),
    prop: new Set<string>(),
  };
  const sources = [
    { kind: "character", api: characters },
    ...(["place", "prop"] as ReferenceKind[]).map((kind) => ({
      kind,
      api: referenceAPI(kind),
    })),
  ];
  for (const source of sources) {
    let cursor: string | undefined;
    do {
      const page = await source.api.listCharacters(cursor, signal);
      for (const summary of page.items) {
        seen[source.kind as keyof typeof seen].add(summary.id);
        const detail = await source.api.getCharacter(summary.id, signal);
        const versions: characters.CharacterVersion[] = [];
        let after: string | undefined;
        do {
          const page = await source.api.characterVersions(
            summary.id,
            after,
            signal,
          );
          versions.push(...page.items);
          after = page.nextCursor ?? undefined;
        } while (after);
        const assets: Data["assets"][string][] = [];
        for (const version of versions.filter((v) =>
          detail.views.some((view) => view.selectedVersionId === v.id),
        )) {
          const item = await getAsset(version.assetId, signal);
          const file = item.files.find((f) => f.role === "original");
          if (!file) continue;
          const link = await getAssetFileURL(file.id, signal);
          assets.push({
            id: item.id,
            serverAssetId: item.id,
            projectId,
            title: detail.name,
            kind: item.kind,
            url: link.url,
            provenance: "Saved reference",
          });
        }
        if (signal.aborted) return;
        useStore.getState().mutate((data) => {
          data.projects[projectId] ??= {
            id: projectId,
            title: "Asset library",
            description: "",
            cover: "",
            episodeIds: [],
            bible: "",
            defaultDuration: 6,
            revision: 1,
            unfiled: true,
            assetLibrary: true,
          };
          for (const asset of assets) data.assets[asset.id] = asset;
          for (const version of versions)
            data.studio.versions[version.id] = {
              id: version.id,
              projectId,
              ownerKind:
                source.kind === "character"
                  ? version.view === "front"
                    ? "identity"
                    : "reference"
                  : source.kind === "place"
                    ? "location"
                    : "prop",
              ownerId: detail.id,
              assetId: version.assetId,
              approval: version.approval,
              revision: version.appearanceRevision,
              sourceIdentityVersionId:
                version.sourceIdentityVersionId ?? undefined,
              specification: version.prompt,
              createdAt: Date.parse(version.createdAt),
              viewType: version.view,
            };
          const front = versions.find(
            (v) => v.id === detail.canonicalVersionId,
          );
          if (source.kind === "character") {
            data.characters[detail.id] = {
              id: detail.id,
              projectId,
              name: detail.name,
              description: detail.appearance,
              appearance: detail.appearance,
              notes: detail.notes,
              reference: front ? (data.assets[front.assetId]?.url ?? "") : "",
              approved: !!front,
              canonicalVersionId: detail.canonicalVersionId ?? undefined,
              revision: detail.appearanceRevision,
            };
            for (const view of detail.views.filter((v) => v.type !== "front")) {
              const id = `reference-${detail.id}-${view.type}`;
              data.studio.references[id] = {
                id,
                characterId: detail.id,
                type: view.type as Data["studio"]["references"][string]["type"],
                activeVersionId: view.selectedVersionId ?? undefined,
              };
              const version =
                data.studio.versions[view.selectedVersionId ?? ""];
              if (version) version.ownerId = id;
            }
          } else if (source.kind === "place") {
            data.studio.locations[detail.id] = {
              id: detail.id,
              projectId,
              name: detail.name,
              description: detail.appearance,
              revision: detail.appearanceRevision,
              referenceAssetIds: [],
              assetId: front?.assetId,
              primaryVersionId: detail.canonicalVersionId ?? undefined,
              savedViewIds: Object.fromEntries(
                detail.views
                  .filter((v) => v.selectedVersionId)
                  .map((v) => [v.type, v.selectedVersionId!]),
              ),
            };
          } else {
            const elements = (data.projects[projectId].worldElements ??= []);
            const old = elements.findIndex((e) => e.id === detail.id);
            const prop = {
              id: detail.id,
              name: detail.name,
              kind: "prop" as const,
              description: detail.appearance,
              revision: detail.appearanceRevision,
              assetId: front?.assetId,
              primaryVersionId: detail.canonicalVersionId ?? undefined,
              savedViewIds: Object.fromEntries(
                detail.views
                  .filter((v) => v.selectedVersionId)
                  .map((v) => [v.type, v.selectedVersionId!]),
              ),
            };
            if (old < 0) elements.push(prop);
            else elements[old] = prop;
          }
        });
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }
  if (!signal.aborted)
    useStore.getState().mutate((data) => {
      for (const character of Object.values(data.characters)) {
        if (
          character.projectId === projectId &&
          !seen.character.has(character.id)
        ) {
          delete data.characters[character.id];
          for (const ref of Object.values(data.studio.references))
            if (ref.characterId === character.id)
              delete data.studio.references[ref.id];
        }
      }
      for (const place of Object.values(data.studio.locations))
        if (place.projectId === projectId && !seen.place.has(place.id))
          delete data.studio.locations[place.id];
      const library = data.projects[projectId];
      if (library)
        library.worldElements = library.worldElements?.filter((p) =>
          seen.prop.has(p.id),
        );
    });
}
