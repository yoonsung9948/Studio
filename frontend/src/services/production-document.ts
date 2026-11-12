import type { ProductionDocument } from "../api/production";
import type { Data } from "../domain/types";
const values = <T>(items: Record<string, T>) => Object.values(items);
export function productionDocument(
  data: Data,
  id: string,
  revision: number,
): ProductionDocument {
  const project = data.projects[id];
  const episodes = values(data.episodes).filter((e) => e.projectId === id);
  const episodeIds = new Set(episodes.map((e) => e.id));
  const scenes = values(data.scenes).filter((s) => episodeIds.has(s.episodeId));
  const sceneIds = new Set(scenes.map((s) => s.id));
  const shots = values(data.shots).filter((s) => sceneIds.has(s.sceneId));
  const shotIds = new Set(shots.map((s) => s.id));
  const characters = values(data.characters).filter((c) => c.projectId === id);
  const characterIds = new Set(characters.map((c) => c.id));
  const assets = values(data.assets)
    .filter((a) => a.projectId === id)
    .map(({ url, missing, sessionOnly, storedBlob, ...asset }) => ({
      ...asset,
      serverAssetId: asset.serverAssetId ?? asset.id,
    }));
  const clean = (value: unknown) =>
    JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  return {
    revision,
    project: clean({
      ...project,
      cover:
        project.cover.startsWith("/api/") || project.cover.startsWith("blob:")
          ? ""
          : project.cover,
    }),
    episodes: episodes.map(clean),
    scenes: scenes.map(clean),
    shots: shots.map(clean),
    characters: characters.map((c) => clean({ ...c, reference: "" })),
    looks: values(data.studio.looks)
      .filter((l) => characterIds.has(l.characterId))
      .map(clean),
    locations: values(data.studio.locations)
      .filter((l) => l.projectId === id)
      .map(clean),
    props: (project.worldElements ?? []).map((p) =>
      clean({ ...p, projectId: id }),
    ),
    versions: values(data.studio.versions)
      .filter((v) => v.projectId === id)
      .map(clean),
    takes: values(data.takes)
      .filter((t) => shotIds.has(t.shotId))
      .map((t) => {
        const { inputs, references, ...fields } = t;
        return clean(t.producerJobId ? fields : t);
      }),
    setups: values(data.studio.setups)
      .filter((s) => sceneIds.has(s.sceneId))
      .map((s) => clean({ ...s, id: s.sceneId })),
    references: values(data.studio.references)
      .filter((ref) => characterIds.has(ref.characterId))
      .map(clean),
    exports: values(data.exports)
      .filter((e) => episodeIds.has(e.episodeId))
      .map((e) => clean({ ...e, manifest: cleanManifest(e.manifest) })),
    assets: assets.map(clean),
  };
}
/** Only editorial records are projected; jobs, credits, auth and UI never enter the document. */
export function applyProduction(data: Data, document: ProductionDocument) {
  const id = String(document.project.id);
  const oldEpisodes = new Set(
    Object.values(data.episodes)
      .filter((e) => e.projectId === id)
      .map((e) => e.id),
  );
  const oldScenes = new Set(
    Object.values(data.scenes)
      .filter((s) => oldEpisodes.has(s.episodeId))
      .map((s) => s.id),
  );
  const oldShots = new Set(
    Object.values(data.shots)
      .filter((s) => oldScenes.has(s.sceneId))
      .map((s) => s.id),
  );
  const oldCharacters = new Set(
    Object.values(data.characters)
      .filter((c) => c.projectId === id)
      .map((c) => c.id),
  );
  const remove = (
    records: Record<string, unknown>,
    matches: (record: any) => boolean,
  ) => {
    for (const [key, record] of Object.entries(records))
      if (matches(record)) delete records[key];
  };
  remove(data.episodes, (e) => e.projectId === id);
  remove(data.scenes, (s) => oldEpisodes.has(s.episodeId));
  remove(data.shots, (s) => oldScenes.has(s.sceneId));
  remove(data.takes, (t) => oldShots.has(t.shotId));
  remove(data.characters, (c) => c.projectId === id);
  remove(data.assets, (a) => a.projectId === id);
  remove(data.studio.looks, (l) => oldCharacters.has(l.characterId));
  remove(data.studio.references, (r) => oldCharacters.has(r.characterId));
  remove(data.studio.versions, (v) => v.projectId === id);
  remove(data.studio.locations, (l) => l.projectId === id);
  remove(data.studio.setups, (s) => oldScenes.has(s.sceneId));
  remove(data.exports, (e) => oldEpisodes.has(e.episodeId));
  data.projects[id] = structuredClone(
    document.project,
  ) as unknown as Data["projects"][string];
  const assign = (
    target: Record<string, unknown>,
    records: Record<string, unknown>[],
  ) => {
    for (const record of records)
      target[String(record.id)] = structuredClone(record);
  };
  assign(data.episodes, document.episodes);
  assign(data.scenes, document.scenes);
  assign(data.shots, document.shots);
  assign(data.characters, document.characters);
  assign(data.studio.looks, document.looks);
  assign(data.studio.locations, document.locations);
  assign(data.studio.versions, document.versions);
  assign(data.takes, document.takes);
  assign(data.studio.setups, document.setups);
  assign(data.studio.references, document.references);
  assign(data.exports, document.exports);
  data.projects[id].worldElements = document.props.map((p) =>
    structuredClone(p),
  ) as unknown as Data["projects"][string]["worldElements"];
  for (const record of document.assets) {
    const asset = structuredClone(record) as unknown as Data["assets"][string];
    data.assets[asset.id] = { ...asset, url: "", missing: true };
  }
}

function cleanManifest(manifest: string): string {
  try {
    const strip = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(strip)
        : value && typeof value === "object"
          ? Object.fromEntries(
              Object.entries(value)
                .filter(([key]) => key !== "url")
                .map(([key, v]) => [key, strip(v)]),
            )
          : value;
    return JSON.stringify(strip(JSON.parse(manifest)));
  } catch {
    return "";
  }
}
