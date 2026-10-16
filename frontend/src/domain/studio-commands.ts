import {
  CONFIG,
  uid,
  type Data,
  type StudioOperation,
  type CastAssignment,
  type SceneDirection,
  type StudioChange,
  type Scope,
} from "./types";
import {
  characterLooks,
  characterReferences,
  effectiveCast,
  referenceTypes,
  targetBusy,
  validVersion,
  lookReady,
} from "./studio-selectors";
import { identityFields, lookFields } from "./studio-schemas";
export function bumpStudio(d: Data, pid: string) {
  d.projects[pid].revision++;
  d.projects[pid].updatedAt = Date.now();
}
export function markShotsStale(d: Data, ids: string[]) {
  const eps = new Set<string>();
  for (const id of ids) {
    const s = d.shots[id];
    if (!s) continue;
    s.revision++;
    s.stale = !!s.currentTakeId || !!s.imageTakeId;
    eps.add(d.scenes[s.sceneId].episodeId);
  }
  for (const id of eps) d.episodes[id].timelineVersion++;
}
export const affectedShots = (d: Data, cid: string, lid?: string) =>
  Object.values(d.shots)
    .filter((s) =>
      effectiveCast(d, s.id).some(
        (a) => a.characterId === cid && (!lid || a.lookId === lid),
      ),
    )
    .map((s) => s.id);
export function createCharacter(d: Data, pid: string) {
  if (!d.projects[pid]) throw Error("Project not found.");
  const id = uid("character");
  d.characters[id] = {
    id,
    projectId: pid,
    name: "Untitled character",
    description: "",
    reference: "",
    approved: false,
    role: "",
    appearance: "",
    personality: "",
    notes: "",
    revision: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  for (const type of referenceTypes) {
    const rid = uid("reference");
    d.studio.references[rid] = { id: rid, characterId: id, type };
  }
  createLook(d, id, "Default");
  return id;
}
export function updateCharacter(
  d: Data,
  id: string,
  fields: Record<string, string>,
) {
  const c = d.characters[id];
  if (!c) throw Error("Character not found.");
  const f = identityFields.parse({
    name: c.name,
    role: c.role ?? "",
    appearance: c.appearance ?? "",
    personality: c.personality ?? "",
    notes: c.notes ?? "",
    ...fields,
  });
  Object.assign(c, f, {
    description: f.appearance,
    revision: (c.revision ?? 1) + 1,
    updatedAt: Date.now(),
  });
  bumpStudio(d, c.projectId);
}
export function createLook(d: Data, cid: string, name = "Untitled Look") {
  const c = d.characters[cid];
  if (!c) throw Error("Character not found.");
  const id = uid("look");
  d.studio.looks[id] = {
    id,
    characterId: cid,
    name,
    description: "",
    styling: "Preserve face and hairstyle.",
    notes: "",
    revision: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  bumpStudio(d, c.projectId);
  return id;
}
export function updateLook(
  d: Data,
  id: string,
  fields: Record<string, string>,
) {
  const l = d.studio.looks[id];
  if (!l) throw Error("Look not found.");
  const f = lookFields.parse({ ...l, ...fields });
  const changed = f.description !== l.description || f.styling !== l.styling;
  Object.assign(l, f, { updatedAt: Date.now() });
  if (changed) {
    l.revision++;
    markShotsStale(d, affectedShots(d, l.characterId, id));
  }
  bumpStudio(d, d.characters[l.characterId].projectId);
}
export function targetInfo(d: Data, kind: StudioOperation, id: string) {
  if (kind === "identity") {
    const c = d.characters[id];
    if (!c) throw Error("Character no longer exists.");
    return {
      projectId: c.projectId,
      name: c.name,
      revision: c.revision ?? 1,
      identity: c.canonicalVersionId,
      spec: c.appearance ?? "",
      characterId: c.id,
    };
  }
  if (kind === "look") {
    const l = d.studio.looks[id],
      c = l ? d.characters[l.characterId] : undefined;
    if (!l || !c) throw Error("Look no longer exists.");
    return {
      projectId: c.projectId,
      name: `${c.name} / ${l.name}`,
      revision: l.revision,
      identity: c.canonicalVersionId,
      spec: l.description + "\n" + l.styling,
      characterId: c.id,
    };
  }
  if (kind === "reference") {
    const r = d.studio.references[id],
      c = r ? d.characters[r.characterId] : undefined;
    if (!r || !c) throw Error("Reference no longer exists.");
    return {
      projectId: c.projectId,
      name: `${c.name} / ${r.type}`,
      revision: c.revision ?? 1,
      identity: c.canonicalVersionId,
      spec: r.type,
      sourceLook: r.lookId
        ? d.studio.looks[r.lookId]?.primaryVersionId
        : undefined,
      characterId: c.id,
    };
  }
  const l = d.studio.locations[id];
  if (!l) throw Error("Location no longer exists.");
  return {
    projectId: l.projectId,
    name: l.name,
    revision: l.revision,
    identity: undefined,
    spec: l.description,
    characterId: undefined,
  };
}
export const studioCost = (kind: StudioOperation) =>
  CONFIG.imageCost * (kind === "identity" ? 3 : 1);
export function enqueueStudio(
  d: Data,
  kind: StudioOperation,
  ids: string[],
  simulateFailure = false,
) {
  const eligible = [...new Set(ids)].filter((id) => !targetBusy(d, kind, id));
  const infos = eligible.map((id) => targetInfo(d, kind, id));
  for (const info of infos) {
    if (kind === "identity" && !info.spec.trim())
      throw Error(
        "Describe the physical appearance before generating identity candidates.",
      );
    if (
      (kind === "look" || kind === "reference") &&
      !validVersion(d, info.identity)
    )
      throw Error("Approve the character identity first.");
    if (kind === "look" && !info.spec.split("\n")[0].trim())
      throw Error("Describe this Look before generation.");
  }
  if (kind === "reference")
    for (const id of eligible) {
      const r = d.studio.references[id];
      if (r.lookId && !lookReady(d, r.lookId))
        throw Error("Approve the Look before generating its additional angle.");
    }
  const total = eligible.length * studioCost(kind);
  if (d.credits < total) throw Error("Not enough demo credits.");
  eligible.forEach((id, i) => {
    const info = infos[i];
    const prior = Object.values(d.jobs).filter(
      (j) => j.target?.kind === kind && j.target.id === id,
    );
    const jid = uid("job");
    d.jobs[jid] = {
      id: jid,
      projectId: info.projectId,
      episodeId: "",
      sceneId: "",
      shotId: "",
      operation: kind,
      target: { kind, id },
      state: "queued",
      attempt: Math.max(0, ...prior.map((j) => j.attempt)) + 1,
      cost: studioCost(kind),
      progress: 0,
      revision: info.revision,
      sourceIdentityVersionId: info.identity,
      sourceLookVersionId: "sourceLook" in info ? info.sourceLook : undefined,
      specification: info.spec,
      replacement: true,
      simulateFailure,
    };
  });
  d.credits -= total;
  return eligible.length;
}
export function completeStudioJob(d: Data, id: string) {
  const j = d.jobs[id];
  if (!j?.target || j.state !== "running") return;
  const { kind, id: targetId } = j.target;
  let info;
  try {
    info = targetInfo(d, kind, targetId);
  } catch {
    j.state = "canceled";
    return;
  }
  if (j.simulateFailure) {
    j.state = "failed";
    j.error = "Demo interruption. Retry creates a fresh recoverable attempt.";
    return;
  }
  const count = kind === "identity" ? 3 : 1;
  j.outputVersionIds = [];
  for (let i = 0; i < count; i++) {
    const aid = uid("asset"),
      vid = uid("version");
    let url =
      kind === "identity"
        ? `/media/studio-identity-${i + 1}.svg`
        : kind === "look"
          ? `/media/studio-look-${/summer|white T-shirt/i.test(j.specification ?? "") ? "summer" : /formal|suit/i.test(j.specification ?? "") ? "formal" : /winter|coat/i.test(j.specification ?? "") ? "winter" : "default"}.svg`
          : kind === "location"
            ? "/media/arrival.svg"
            : `/media/studio-${d.studio.references[targetId]?.type ?? "custom"}.svg`;
    d.assets[aid] = {
      id: aid,
      projectId: j.projectId,
      title: `${info.name} · demo candidate ${i + 1}`,
      kind: "image",
      url,
      provenance:
        "Original labeled diagram placeholder. Simulated image job; no real AI generation or photographic identity consistency.",
    };
    d.studio.versions[vid] = {
      id: vid,
      projectId: j.projectId,
      ownerKind: kind,
      ownerId: targetId,
      assetId: aid,
      approval: "needs_review",
      revision: j.revision,
      sourceIdentityVersionId: j.sourceIdentityVersionId,
      sourceLookVersionId: j.sourceLookVersionId,
      specification: j.specification ?? "",
      createdAt: Date.now() + i,
    };
    j.outputVersionIds.push(vid);
  }
  j.state = "succeeded";
  j.progress = 100;
}
export function approveVersion(d: Data, id: string) {
  const v = d.studio.versions[id];
  if (!v || v.approval === "rejected")
    throw Error("This candidate is unavailable.");
  const info = targetInfo(d, v.ownerKind, v.ownerId);
  if (v.revision !== info.revision)
    throw Error(
      "This candidate belongs to an older specification. Generate a current version.",
    );
  if (
    v.ownerKind !== "identity" &&
    v.ownerKind !== "location" &&
    v.sourceIdentityVersionId !== info.identity
  )
    throw Error("The canonical identity changed. Generate a new candidate.");
  if (!d.assets[v.assetId]?.url || d.assets[v.assetId]?.missing)
    throw Error("Reattach the image first.");
  if (
    v.ownerKind === "reference" &&
    d.studio.references[v.ownerId]?.lookId &&
    (!lookReady(d, d.studio.references[v.ownerId].lookId) ||
      v.sourceLookVersionId !==
        ("sourceLook" in info ? info.sourceLook : undefined))
  )
    throw Error("The Look changed. Generate a new angle.");
  v.approval = "approved";
  if (v.ownerKind === "identity") {
    const c = d.characters[v.ownerId];
    const changed = c.canonicalVersionId !== v.id;
    c.canonicalVersionId = v.id;
    c.reference = d.assets[v.assetId].url;
    c.approved = true;
    let front = characterReferences(d, c.id).find((r) => r.type === "front");
    if (!front) {
      const rid = uid("reference");
      front = { id: rid, characterId: c.id, type: "front" };
      d.studio.references[rid] = front;
    }
    const rid = uid("version");
    d.studio.versions[rid] = {
      ...v,
      id: rid,
      ownerKind: "reference",
      ownerId: front.id,
      sourceIdentityVersionId: v.id,
    };
    front.activeVersionId = rid;
    if (changed) markShotsStale(d, affectedShots(d, c.id));
  } else if (v.ownerKind === "look") {
    const l = d.studio.looks[v.ownerId];
    if (l.primaryVersionId !== v.id)
      markShotsStale(d, affectedShots(d, l.characterId, l.id));
    l.primaryVersionId = v.id;
  } else if (v.ownerKind === "reference") {
    const r = d.studio.references[v.ownerId];
    if (r.activeVersionId !== v.id)
      markShotsStale(
        d,
        Object.values(d.shots)
          .filter((s) =>
            effectiveCast(d, s.id).some((a) => a.referenceIds?.includes(r.id)),
          )
          .map((s) => s.id),
      );
    r.activeVersionId = v.id;
  } else {
    const l = d.studio.locations[v.ownerId];
    l.primaryVersionId = v.id;
    l.assetId = v.assetId;
    for (const setup of Object.values(d.studio.setups))
      if (setup.locationId === l.id)
        markShotsStale(d, d.scenes[setup.sceneId].shotIds);
  }
  bumpStudio(d, v.projectId);
}
export function rejectVersion(d: Data, id: string) {
  const v = d.studio.versions[id];
  if (v?.approval === "needs_review") v.approval = "rejected";
}
export function setSceneCast(d: Data, sid: string, cast: CastAssignment[]) {
  const setup = d.studio.setups[sid],
    sc = d.scenes[sid];
  if (!setup || !sc) throw Error("Scene not found.");
  const pid = d.episodes[sc.episodeId].projectId;
  const seen = new Set<string>();
  for (const a of cast) {
    if (d.characters[a.characterId]?.projectId !== pid)
      throw Error("Choose a character from this project.");
    if (seen.has(a.characterId))
      throw Error("This character is already assigned.");
    seen.add(a.characterId);
    if (a.lookId && d.studio.looks[a.lookId]?.characterId !== a.characterId)
      throw Error("The selected Look belongs to another character.");
  }
  setup.cast = structuredClone(cast);
  setup.revision++;
  for (const id of sc.shotIds)
    if (!d.shots[id].castOverride)
      d.shots[id].characters = cast.map((a) => a.characterId);
  markShotsStale(
    d,
    sc.shotIds.filter((id) => !d.shots[id].castOverride),
  );
  bumpStudio(d, pid);
}
export function updateDirection(
  d: Data,
  sid: string,
  fields: Partial<SceneDirection>,
) {
  const setup = d.studio.setups[sid];
  if (!setup) return;
  if (
    Object.entries(fields).every(
      ([k, v]) => setup.direction[k as keyof SceneDirection] === v,
    )
  )
    return;
  d.scenes[sid].planRevision = (d.scenes[sid].planRevision ?? 1) + 1;
  Object.assign(setup.direction, fields);
  setup.revision++;
  markShotsStale(d, d.scenes[sid].shotIds);
  bumpStudio(d, d.episodes[d.scenes[sid].episodeId].projectId);
}
export function createLocation(
  d: Data,
  pid: string,
  name = "New location",
  assetId?: string,
) {
  if (
    assetId &&
    (d.assets[assetId]?.projectId !== pid || d.assets[assetId].kind !== "image")
  )
    throw Error("Choose an image from this project.");
  const id = uid("location");
  d.studio.locations[id] = {
    id,
    projectId: pid,
    name,
    description: "",
    assetId,
    referenceAssetIds: [],
    revision: 1,
  };
  return id;
}
export function setLocation(
  d: Data,
  sid: string,
  mode: "none" | "inferred" | "selected" | "required",
  id?: string,
) {
  const setup = d.studio.setups[sid];
  const pid = d.episodes[d.scenes[sid].episodeId].projectId;
  if (id && d.studio.locations[id]?.projectId !== pid)
    throw Error("Location must belong to this project.");
  setup.locationMode = mode;
  setup.locationId = id;
  setup.revision++;
  markShotsStale(d, d.scenes[sid].shotIds);
  bumpStudio(d, pid);
}
export function addLookAngle(d: Data, lid: string) {
  const l = d.studio.looks[lid];
  const existing = Object.values(d.studio.references).find(
    (r) => r.lookId === lid,
  );
  if (existing) return existing.id;
  const id = uid("reference");
  d.studio.references[id] = {
    id,
    characterId: l.characterId,
    lookId: lid,
    type: "custom",
  };
  return id;
}
export function duplicateCharacter(d: Data, id: string) {
  const c = d.characters[id];
  const next = createCharacter(d, c.projectId);
  Object.assign(d.characters[next], {
    name: c.name + " (copy)",
    appearance: c.appearance,
    description: c.description,
    role: c.role,
    personality: c.personality,
    notes: c.notes,
  });
  if (c.canonicalVersionId) {
    const source = d.studio.versions[c.canonicalVersionId],
      vid = uid("version");
    d.studio.versions[vid] = {
      ...source,
      id: vid,
      ownerId: next,
      approval: "needs_review",
      revision: 1,
    };
  }
  for (const l of characterLooks(d, id)) {
    if (l.name === "Default") continue;
    const lid = createLook(d, next, l.name);
    Object.assign(d.studio.looks[lid], {
      description: l.description,
      styling: l.styling,
      notes: l.notes,
    });
  }
  return next;
}
export function deleteCharacter(d: Data, id: string) {
  const c = d.characters[id];
  if (!c) return;
  markShotsStale(d, affectedShots(d, id));
  for (const setup of Object.values(d.studio.setups))
    setup.cast = setup.cast.filter((a) => a.characterId !== id);
  for (const s of Object.values(d.shots)) {
    s.characters = s.characters.filter((x) => x !== id);
    if (s.castOverride)
      s.castOverride = s.castOverride.filter((a) => a.characterId !== id);
  }
  for (const j of Object.values(d.jobs))
    if (
      j.target &&
      ((j.target.kind === "identity" && j.target.id === id) ||
        (j.target.kind === "look" &&
          d.studio.looks[j.target.id]?.characterId === id) ||
        (j.target.kind === "reference" &&
          d.studio.references[j.target.id]?.characterId === id))
    ) {
      if (["queued", "running", "waiting"].includes(j.state))
        j.state = "canceled";
    }
  for (const l of characterLooks(d, id)) delete d.studio.looks[l.id];
  for (const r of Object.values(d.studio.references))
    if (r.characterId === id) delete d.studio.references[r.id];
  delete d.characters[id];
  bumpStudio(d, c.projectId);
}
export function deleteLook(d: Data, id: string) {
  const l = d.studio.looks[id];
  if (!l) return;
  markShotsStale(d, affectedShots(d, l.characterId, id));
  for (const setup of Object.values(d.studio.setups))
    for (const a of setup.cast) if (a.lookId === id) a.lookId = undefined;
  for (const s of Object.values(d.shots))
    for (const a of s.castOverride ?? [])
      if (a.lookId === id) a.lookId = undefined;
  for (const j of Object.values(d.jobs))
    if (
      j.target?.kind === "look" &&
      j.target.id === id &&
      ["queued", "running", "waiting"].includes(j.state)
    )
      j.state = "canceled";
  for (const r of Object.values(d.studio.references))
    if (r.lookId === id) {
      for (const j of Object.values(d.jobs))
        if (
          j.target?.kind === "reference" &&
          j.target.id === r.id &&
          ["running", "queued", "waiting"].includes(j.state)
        )
          j.state = "canceled";
      for (const a of [
        ...Object.values(d.studio.setups).flatMap((s) => s.cast),
        ...Object.values(d.shots).flatMap((s) => s.castOverride ?? []),
      ])
        a.referenceIds = a.referenceIds?.filter((x) => x !== r.id);
      delete d.studio.references[r.id];
    }
  delete d.studio.looks[id];
  bumpStudio(d, d.characters[l.characterId].projectId);
}
export function studioProposal(
  d: Data,
  scope: Scope,
  text: string,
): string | undefined {
  const lower = text.toLowerCase();
  let change: StudioChange | undefined;
  if (scope.characterId) {
    const c = d.characters[scope.characterId];
    if (!c) return;
    if (/summer|t-shirt|jeans|outfit/.test(lower))
      change = {
        kind: scope.lookId ? "edit_look" : "create_look",
        fields: {
          name: "Summer Casual",
          description: "White T-shirt, blue jeans, and sneakers.",
          styling: "Preserve face and hairstyle.",
        },
      };
    else if (scope.lookId && /jacket.*black|black.*jacket/.test(lower))
      change = {
        kind: "edit_look",
        fields: {
          description:
            (d.studio.looks[scope.lookId]?.description ?? "") +
            " Black jacket; keep all other details unchanged.",
        },
      };
    else if (/woman|man|appearance|black hair|character/.test(lower))
      change = {
        kind: "identity",
        fields: {
          appearance: /woman|black hair/.test(lower) ? text : text,
          personality: /mysterious/.test(lower)
            ? "Mysterious, reserved, and observant."
            : (c.personality ?? ""),
          role: c.role || "Supporting character",
        },
      };
  } else if (scope.sceneId && scope.setup) {
    if (/add leo/.test(lower)) {
      const c = Object.values(d.characters).find(
        (c) => c.projectId === scope.projectId && c.name === "Leo Hart",
      );
      if (c) change = { kind: "cast", fields: { characterId: c.id } };
    } else if (/dark|suspense|mood|light/.test(lower))
      change = {
        kind: "direction",
        fields: {
          lighting: "Low-key lighting with deep shadows",
          mood: "Dark and suspenseful",
        },
      };
  }
  if (!change) return;
  const id = uid("proposal");
  d.proposals[id] = {
    id,
    scope: structuredClone(scope),
    shotIds: [],
    intent: "studio",
    change,
    before: scope.lookId
      ? (d.studio.looks[scope.lookId]?.description ?? "")
      : scope.characterId
        ? (d.characters[scope.characterId]?.appearance ?? "")
        : JSON.stringify(d.studio.setups[scope.sceneId ?? ""]?.direction ?? {}),
    after: Object.entries(change.fields)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n"),
    state: "proposed",
    cost: 0,
  };
  return id;
}
export function applyStudioProposal(d: Data, id: string) {
  const p = d.proposals[id];
  if (!p?.change || p.state !== "proposed") return;
  if (d.projects[p.scope.projectId]?.revision !== p.scope.revision)
    throw Error("The original context changed. Request a revised proposal.");
  const c = p.change;
  switch (c.kind) {
    case "identity":
      updateCharacter(d, p.scope.characterId!, c.fields);
      break;
    case "create_look": {
      const lid = createLook(d, p.scope.characterId!, c.fields.name);
      updateLook(d, lid, c.fields);
      break;
    }
    case "edit_look":
      updateLook(d, p.scope.lookId!, c.fields);
      break;
    case "direction":
      updateDirection(d, p.scope.sceneId!, c.fields);
      break;
    case "cast": {
      const sid = p.scope.sceneId!,
        cid = c.fields.characterId;
      setSceneCast(d, sid, [
        ...d.studio.setups[sid].cast,
        { characterId: cid, lookId: characterLooks(d, cid)[0]?.id },
      ]);
      break;
    }
  }
  p.state = "applied";
}
