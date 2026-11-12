import type {
  CastAssignment,
  Data,
  GenerationJob,
  ReferenceType,
  StudioOperation,
} from "./types";
export const referenceLabels: Record<ReferenceType, string> = {
  front: "Front portrait",
  three_quarter: "Three-quarter portrait",
  profile: "Side profile",
  right_profile: "Right profile",
  back: "Back view",
  full_body: "Full-body front",
  full_body_three_quarter: "Full-body three-quarter",
  custom: "Additional angle",
};
export const referenceTypes = [
  "front",
  "three_quarter",
  "profile",
  "full_body",
  "full_body_three_quarter",
] as const;
export const jobActive = (j: GenerationJob) =>
  ["queued", "waiting", "running"].includes(j.state);
export const targetJobs = (d: Data, kind: StudioOperation, id: string) =>
  Object.values(d.jobs).filter(
    (j) => j.target?.kind === kind && j.target.id === id,
  );
export const targetBusy = (d: Data, kind: StudioOperation, id: string) =>
  targetJobs(d, kind, id).some(jobActive);
export const versionsFor = (d: Data, kind: StudioOperation, id: string) =>
  Object.values(d.studio.versions)
    .filter((v) => v.ownerKind === kind && v.ownerId === id)
    .sort((a, b) => b.createdAt - a.createdAt);
export const versionAsset = (d: Data, id?: string) =>
  id ? d.assets[d.studio.versions[id]?.assetId] : undefined;
export function validVersion(d: Data, id?: string) {
  const v = id ? d.studio.versions[id] : undefined;
  return (
    !!v &&
    v.approval === "approved" &&
    !!d.assets[v.assetId]?.url &&
    !d.assets[v.assetId]?.missing
  );
}
export const characterLooks = (d: Data, id: string, episodeId?: string) =>
  Object.values(d.studio.looks).filter(
    (look) =>
      look.characterId === id &&
      (!episodeId || !look.episodeId || look.episodeId === episodeId),
  );
export const characterReferences = (d: Data, id: string) =>
  Object.values(d.studio.references).filter(
    (r) => r.characterId === id && !r.lookId,
  );
export function referenceValid(d: Data, id: string) {
  const r = d.studio.references[id];
  if (!r || !validVersion(d, r.activeVersionId)) return false;
  const v = d.studio.versions[r.activeVersionId!];
  if (
    r.lookId &&
    (!lookReady(d, r.lookId) ||
      v.sourceLookVersionId !== d.studio.looks[r.lookId]?.primaryVersionId)
  )
    return false;
  return (
    v.sourceIdentityVersionId ===
    d.characters[r.characterId]?.canonicalVersionId
  );
}
export function characterReady(d: Data, id: string) {
  const c = d.characters[id];
  return (
    !!c &&
    validVersion(d, c.canonicalVersionId) &&
    characterReferences(d, id).some((r) => referenceValid(d, r.id))
  );
}
export function lookReady(d: Data, id?: string) {
  if (!id) return true;
  const l = d.studio.looks[id];
  if (!l || !validVersion(d, l.primaryVersionId)) return false;
  const v = d.studio.versions[l.primaryVersionId!];
  return (
    v.sourceIdentityVersionId ===
      d.characters[l.characterId]?.canonicalVersionId &&
    v.revision === l.revision
  );
}
export function characterStatus(d: Data, id: string) {
  if (characterReady(d, id)) return "Ready for scenes";
  if (targetBusy(d, "identity", id)) return "Creating identity";
  if (characterReferences(d, id).some((r) => targetBusy(d, "reference", r.id)))
    return "Creating references";
  if (versionsFor(d, "identity", id).some((v) => v.approval === "needs_review"))
    return "Needs review";
  return "Draft";
}
export function referenceStatus(d: Data, id: string) {
  const r = d.studio.references[id];
  if (!r) return "Missing";
  const j = targetJobs(d, "reference", id).filter(jobActive)[0];
  if (j) return j.state === "running" ? "Generating" : "Queued";
  if (
    versionsFor(d, "reference", id).some((v) => v.approval === "needs_review")
  )
    return "Needs review";
  if (referenceValid(d, id)) return "Approved";
  if (r.activeVersionId) return "Needs review · identity changed";
  if (targetJobs(d, "reference", id).at(-1)?.state === "failed")
    return "Failed";
  return "Missing";
}
export const effectiveCast = (d: Data, shotId: string): CastAssignment[] => {
  const s = d.shots[shotId];
  return (
    s?.castOverride ??
    d.studio.setups[s?.sceneId]?.cast ??
    s?.characters.map((characterId) => ({ characterId })) ??
    []
  );
};
export function studioJobPath(d: Data, j: GenerationJob) {
  if (!j.target)
    return `/projects/${j.projectId}/episodes/${j.episodeId}/scenes/${j.sceneId}`;
  const { kind, id } = j.target;
  const reference = kind === "reference" ? d.studio.references[id] : undefined;
  const look = d.studio.looks[kind === "look" ? id : (reference?.lookId ?? "")];
  if (look?.episodeId)
    return `/projects/${j.projectId}/episodes/${look.episodeId}/references/characters/${look.characterId}/looks/${look.id}?tab=views&view=${reference?.type ?? "front"}`;
  const params = new URLSearchParams({
    kind:
      kind === "location" ? "places" : kind === "prop" ? "props" : "characters",
    tab: "views",
    view: j.viewType ?? reference?.type ?? "front",
  });
  params.set(
    kind === "location" || kind === "prop"
      ? "asset"
      : kind === "look"
        ? "look"
        : "character",
    kind === "reference" ? (reference?.characterId ?? id) : id,
  );
  return `/assets?${params}`;
}
export function studioJobTitle(d: Data, j: GenerationJob) {
  const t = j.target;
  if (!t) return `${d.scenes[j.sceneId]?.title} / ${d.shots[j.shotId]?.title}`;
  if (t.kind === "identity")
    return `${d.characters[t.id]?.name} · identity candidates`;
  if (t.kind === "look")
    return `${d.characters[d.studio.looks[t.id]?.characterId]?.name} / ${d.studio.looks[t.id]?.name}`;
  if (t.kind === "reference") {
    const r = d.studio.references[t.id];
    return `${d.characters[r?.characterId]?.name} · ${r ? referenceLabels[r.type] : "reference"}`;
  }
  if (t.kind === "prop")
    return `${d.projects[j.projectId]?.worldElements?.find((item) => item.id === t.id)?.name ?? "Prop"} · image candidates`;
  return `${d.studio.locations[t.id]?.name} · location image`;
}

/** A look sheet opens on its front portrait; legacy look images remain usable. */
export function lookFrontPortrait(d: Data, lookId: string) {
  const look = d.studio.looks[lookId];
  if (!look) return undefined;
  const front = Object.values(d.studio.references).find(
    (ref) =>
      ref.characterId === look.characterId &&
      ref.lookId === lookId &&
      ref.type === "front",
  );
  for (const id of [front?.activeVersionId, look.primaryVersionId]) {
    const version = id ? d.studio.versions[id] : undefined;
    const asset =
      version && version.approval !== "rejected"
        ? d.assets[version.assetId]
        : undefined;
    if (asset?.url && !asset.missing) return asset;
  }
  return undefined;
}
