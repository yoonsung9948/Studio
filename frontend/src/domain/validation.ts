import type { Data } from "./types";
/** Validate stored relationships, not only the shape of individual records. */
export function validateRelations(d: Data): void {
  const fail = () => {
    throw Error("Invalid saved project relationships.");
  };
  for (const p of Object.values(d.projects))
    for (const id of p.episodeIds)
      if (d.episodes[id]?.projectId !== p.id) fail();
  for (const e of Object.values(d.episodes)) {
    if (!d.projects[e.projectId]) fail();
    for (const id of e.sceneIds) if (d.scenes[id]?.episodeId !== e.id) fail();
  }
  for (const s of Object.values(d.scenes)) {
    if (!d.episodes[s.episodeId]) fail();
    for (const id of s.shotIds) if (d.shots[id]?.sceneId !== s.id) fail();
  }
  for (const s of Object.values(d.shots)) {
    if (
      !d.scenes[s.sceneId] ||
      !Number.isInteger(s.inFrame) ||
      !Number.isInteger(s.outFrame) ||
      s.inFrame < 0 ||
      s.outFrame <= s.inFrame
    )
      fail();
    for (const id of [s.currentTakeId, s.candidateTakeId, s.imageTakeId])
      if (id && d.takes[id]?.shotId !== s.id) fail();
    const visited = new Set([s.id]);
    let dep = s.dependsOn;
    while (dep) {
      if (visited.has(dep) || !d.shots[dep]) fail();
      visited.add(dep);
      dep = d.shots[dep].dependsOn;
    }
  }
  for (const t of Object.values(d.takes))
    if (!d.shots[t.shotId] || !d.assets[t.assetId]) fail();
  for (const c of Object.values(d.characters)) {
    if (!d.projects[c.projectId]) fail();
    if (c.canonicalVersionId) {
      const v = d.studio.versions[c.canonicalVersionId];
      if (
        !v ||
        v.ownerKind !== "identity" ||
        v.ownerId !== c.id ||
        v.projectId !== c.projectId
      )
        fail();
    }
  }
  for (const l of Object.values(d.studio.looks)) {
    if (!d.characters[l.characterId]) fail();
    if (l.primaryVersionId) {
      const v = d.studio.versions[l.primaryVersionId];
      if (!v || v.ownerKind !== "look" || v.ownerId !== l.id) fail();
    }
  }
  for (const r of Object.values(d.studio.references)) {
    if (
      !d.characters[r.characterId] ||
      (r.lookId && d.studio.looks[r.lookId]?.characterId !== r.characterId)
    )
      fail();
    if (r.activeVersionId) {
      const v = d.studio.versions[r.activeVersionId];
      if (
        !v ||
        !(
          (v.ownerKind === "reference" && v.ownerId === r.id) ||
          (r.type === "front" &&
            v.ownerKind === "identity" &&
            v.ownerId === r.characterId)
        )
      )
        fail();
    }
  }
  for (const v of Object.values(d.studio.versions))
    if (!d.assets[v.assetId] || d.assets[v.assetId].projectId !== v.projectId)
      fail();
  for (const setup of Object.values(d.studio.setups))
    if (!d.scenes[setup.sceneId]) fail();
  for (const j of Object.values(d.jobs))
    if (
      !j.target &&
      (!d.shots[j.shotId] ||
        !d.projects[j.projectId] ||
        !d.episodes[j.episodeId] ||
        !d.scenes[j.sceneId])
    )
      fail();
}
