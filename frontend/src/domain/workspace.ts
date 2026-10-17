import {
  markShotsStale as markDomainShotsStale,
  bumpStudio,
} from "./studio-commands";
import { retryJob } from "./commands";
import { CONFIG, uid, type Data, type Operation, type Shot } from "./types";
import {
  approveScript,
  approveScenePlan,
  createPlannedScene,
  planScenes,
  updateScenePlan,
  scriptApproved,
} from "./workflow";
import {
  approveTake,
  enqueueFrameImage,
  enqueueGeneration,
  reorderShots,
  trimShot,
  updateScript,
} from "./commands";
import {
  ensureSetup,
  scenePreflight,
  updateShotPlan,
  referenceSnapshot,
} from "./scene-preflight";
import {
  generationInputs,
  saveGenerationInputs,
  saveGenerationCast,
} from "./generation-inputs";
import { effectiveCast } from "./studio-selectors";
import {
  createCharacter,
  createLocation,
  updateCharacter,
  updateDirection,
  setSceneCast,
} from "./studio-commands";
import { active, isBusy, shotsOfEpisode } from "./selectors";

export function shotStatus(
  _d: Data,
  s: Shot,
): "Draft" | "Still" | "Video" | "Locked" {
  if (s.locked) return "Locked";
  if (s.currentTakeId || s.candidateTakeId) return "Video";
  return s.imageTakeId ? "Still" : "Draft";
}
export function shotBadges(d: Data, s: Shot) {
  const jobs = Object.values(d.jobs).filter((j) => j.shotId === s.id);
  return [
    (s.candidateTakeId ||
      (s.imageTakeId && !d.takes[s.imageTakeId]?.approved)) &&
      "New take",
    s.stale && "Needs update",
    jobs.some(active) && "Generating",
    jobs.at(-1)?.state === "failed" && "Failed",
  ].filter(Boolean) as string[];
}
export function shotAsset(d: Data, s: Shot) {
  const id = s.candidateTakeId ?? s.currentTakeId ?? s.imageTakeId;
  return id ? d.assets[d.takes[id]?.assetId] : undefined;
}
export function createWorkspaceEpisode(
  d: Data,
  pid: string,
  idea: string,
  seconds = 30,
) {
  if (!d.projects[pid]) throw Error("Choose a project first.");
  const id = uid("episode");
  d.episodes[id] = {
    id,
    projectId: pid,
    title: idea.trim().split(/[.\n]/)[0].slice(0, 65) || "Untitled episode",
    synopsis: idea,
    script: idea.trim(),
    targetSeconds: Math.max(3, Math.min(90, seconds)),
    sceneIds: [],
    revision: 1,
    timelineVersion: 1,
    scriptRevision: 1,
    scriptHistory: [],
  };
  d.projects[pid].episodeIds.push(id);
  if (idea.trim()) {
    approveScript(d, id);
    planScenes(d, id, Math.max(1, Math.min(3, Math.floor(seconds / 5))));
  }
  return id;
}
export function createWorkspaceProject(d: Data, name: string) {
  const id = uid("project");
  d.projects[id] = {
    id,
    title: name.trim() || "Untitled project",
    description: "",
    cover: Object.values(d.projects)[0]?.cover ?? "/media/apartment.svg",
    episodeIds: [],
    bible: "",
    defaultDuration: 30,
    revision: 1,
  };
  return id;
}
/** Unfiled work still uses the same episode/scene/shot engine, without a user-facing project. */
export function createHomeDraft(
  d: Data,
  idea: string,
  kind: "episode" | "scene" | "shot",
  projectId?: string,
  seconds = 30,
) {
  if (!idea.trim()) throw Error("Describe what you want to create.");
  let pid = projectId;
  if (!pid) {
    pid = Object.values(d.projects).find((p) => p.unfiled)?.id;
    if (!pid) {
      pid = createWorkspaceProject(d, "Unfiled");
      d.projects[pid].unfiled = true;
    }
  }
  if (!d.projects[pid])
    throw Error("Choose an existing project, or select No project.");
  if (kind === "shot" && (seconds < 3 || seconds > 30))
    throw Error("Choose a shot duration from 3 to 30 seconds.");
  const eid = createWorkspaceEpisode(
    d,
    pid,
    kind === "episode" ? idea : "",
    seconds,
  );
  const ep = d.episodes[eid];
  ep.creationKind = kind;
  if (kind !== "episode") {
    ep.title = idea.trim().split(/[.\n]/)[0].slice(0, 65);
    ep.synopsis = idea;
    ep.script = idea.trim();
    approveScript(d, eid);
    const sid = createPlannedScene(d, eid, ep.title, idea.trim(), seconds);
    if (kind === "shot") {
      const sc = d.scenes[sid],
        first = d.shots[sc.shotIds[0]];
      for (const id of sc.shotIds.slice(1)) delete d.shots[id];
      sc.shotIds = [first.id];
      first.title = ep.title;
      first.targetFrames = first.outFrame = Math.round(seconds * 30);
    }
  }
  return {
    projectId: pid,
    episodeId: eid,
    sceneId: ep.sceneIds[0],
    shotId: d.scenes[ep.sceneIds[0]]?.shotIds[0],
  };
}
export function addWorkspaceScene(d: Data, eid: string) {
  const ep = d.episodes[eid];
  if (!ep) throw Error("Episode missing.");
  if (!ep.script.trim())
    updateScript(d, eid, "INT. SCENE — DAY\nDescribe what happens.");
  const approved = ep.scriptApprovedRevision,
    history = structuredClone(ep.scriptHistory);
  approveScript(d, eid);
  const id = createPlannedScene(
    d,
    eid,
    `Scene ${ep.sceneIds.length + 1}`,
    "",
    8,
  );
  if (d.projects[ep.projectId].strictApprovals) {
    ep.scriptApprovedRevision = approved;
    ep.scriptHistory = history;
  }
  const previous = ep.sceneIds.at(-2);
  if (previous && d.studio.setups[previous]) {
    const prev = d.studio.setups[previous],
      next = ensureSetup(d, id);
    next.cast = structuredClone(prev.cast);
    next.locationId = prev.locationId;
    next.locationMode = prev.locationMode;
  }
  return id;
}
export function addWorkspaceShot(d: Data, sid: string) {
  const sc = d.scenes[sid],
    ep = d.episodes[sc.episodeId],
    id = uid("shot");
  d.shots[id] = {
    id,
    sceneId: sid,
    title: `Shot ${sc.shotIds.length + 1}`,
    action: sc.description,
    dialogue: "",
    characters: [],
    targetFrames: 120,
    inFrame: 0,
    outFrame: 120,
    revision: 1,
    stale: false,
  };
  sc.shotIds.push(id);
  const setup = ensureSetup(d, sid);
  setup.targetSeconds = sc.shotIds.reduce(
    (n, q) => n + d.shots[q].targetFrames / 30,
    0,
  );
  sc.planRevision = (sc.planRevision ?? 1) + 1;
  ep.timelineVersion++;
  return id;
}
export function reorderWorkspaceScenes(d: Data, eid: string, ids: string[]) {
  const ep = d.episodes[eid];
  if (
    ids.length !== ep.sceneIds.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !ep.sceneIds.includes(id))
  )
    throw Error("Keep all scenes in this episode.");
  ep.sceneIds = ids;
  ep.timelineVersion++;
}
export { reorderShots };
export function changeShot(
  d: Data,
  id: string,
  fields: Partial<Pick<Shot, "title" | "action" | "dialogue">>,
) {
  const shot = d.shots[id];
  if (!shot) throw Error("Shot missing.");
  if (shot.locked) throw Error("Unlock this shot before editing.");
  Object.assign(shot, fields);
  invalidateWorkspaceShots(d, [id]);
}
export function setShotDuration(d: Data, id: string, seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 30)
    throw Error("Use 1–30 seconds.");
  const s = d.shots[id];
  if (s.locked) throw Error("Unlock the shot first.");
  if (s.currentTakeId) {
    trimShot(d, id, s.inFrame, s.inFrame + Math.round(seconds * 30));
    return;
  }
  s.targetFrames = Math.round(seconds * 30);
  s.outFrame = s.inFrame + s.targetFrames;
  const sc = d.scenes[s.sceneId];
  ensureSetup(d, sc.id).targetSeconds = sc.shotIds.reduce(
    (n, id) => n + d.shots[id].targetFrames / 30,
    0,
  );
  invalidateWorkspaceShots(d, [id]);
}
export function changeScene(
  d: Data,
  id: string,
  fields: Partial<{
    title: string;
    description: string;
    settingDescription: string;
  }>,
) {
  updateScenePlan(d, id, fields);
}
export function changeEpisode(
  d: Data,
  id: string,
  fields: Partial<{ title: string; style: string; targetSeconds: number }>,
) {
  if (
    fields.targetSeconds !== undefined &&
    (!Number.isFinite(fields.targetSeconds) ||
      fields.targetSeconds < 3 ||
      fields.targetSeconds > 90)
  )
    throw Error("Use a 3–90 second target.");
  if (fields.style !== undefined && fields.style !== d.episodes[id].style)
    invalidateWorkspaceShots(
      d,
      shotsOfEpisode(d, id).map((s) => s.id),
    );
  Object.assign(d.episodes[id], fields);
  d.episodes[id].revision++;
}
export function buildBoard(d: Data, eid: string) {
  const ep = d.episodes[eid];
  if (!ep.script.trim()) throw Error("Write a screenplay first.");
  approveScript(d, eid);
  planScenes(
    d,
    eid,
    ep.sceneIds.length ||
      Math.max(1, Math.min(3, Math.floor(ep.targetSeconds / 5))),
  );
}
function prepare(d: Data, ids: string[], op: Operation) {
  for (const eid of new Set(
    ids.map((id) => d.scenes[d.shots[id].sceneId].episodeId),
  )) {
    const ep = d.episodes[eid];
    if (!d.projects[ep.projectId].strictApprovals) {
      if (!ep.script.trim())
        updateScript(
          d,
          eid,
          ids.map((id) => d.shots[id].action || d.shots[id].title).join("\n\n"),
        );
      approveScript(d, eid);
      for (const sid of new Set(
        ids
          .filter((id) => d.scenes[d.shots[id].sceneId].episodeId === eid)
          .map((id) => d.shots[id].sceneId),
      )) {
        d.scenes[sid].sourceScriptRevision = ep.scriptRevision ?? 1;
        approveScenePlan(d, sid);
      }
    }
  }
  for (const id of ids) {
    const s = d.shots[id],
      setup = ensureSetup(d, s.sceneId);
    setup.generation = {
      ...generationInputs(d, s.sceneId),
      videoMode: op === "video" ? "direct" : "image_first",
    };
    if (s.generationOverride)
      s.generationOverride.videoMode =
        op === "video" ? "direct" : "image_first";
    if (
      op === "video" &&
      !generationInputs(d, s.sceneId, id).startingFrameAssetId &&
      s.imageTakeId
    ) {
      const still = d.takes[s.imageTakeId],
        asset = still ? d.assets[still.assetId] : undefined;
      if (
        still?.revision === s.revision &&
        asset?.url &&
        !asset.missing &&
        asset.kind === "image"
      )
        s.generationOverride = {
          ...generationInputs(d, s.sceneId, id),
          startingFrameAssetId: asset.id,
          videoMode: "direct",
        };
    }
  }
}
export function workspacePreflight(
  data: Data,
  ids: string[],
  op: Operation,
  proposalId?: string,
) {
  const d = structuredClone(data);
  const valid = [...new Set(ids)].filter((id) => d.shots[id]);
  const blockers: { shotId: string; message: string; fix: string }[] = [];
  if (!valid.length)
    return {
      ids: valid,
      blockers: [
        {
          shotId: "",
          message: "Add a scene and shot first.",
          fix: "Add scene",
        },
      ],
      cost: 0,
    };
  if (proposalId) {
    const p = d.proposals[proposalId];
    if (
      !p ||
      p.state !== "proposed" ||
      d.projects[p.scope.projectId]?.revision !== p.scope.revision
    )
      blockers.push({
        shotId: valid[0],
        message: "The proposal context changed. Request a new proposal.",
        fix: "Ask Director",
      });
  }
  try {
    prepare(d, valid, op);
  } catch (e) {
    blockers.push({
      shotId: valid[0],
      message: (e as Error).message,
      fix: "Review script",
    });
  }
  for (const id of valid) {
    const s = d.shots[id];
    if (s.locked)
      blockers.push({ shotId: id, message: "Shot is locked.", fix: "Unlock" });
    if (isBusy(d, id))
      blockers.push({
        shotId: id,
        message: "This shot is generating.",
        fix: "Show activity",
      });
    if (
      op === "video" &&
      s.candidateTakeId &&
      d.takes[s.candidateTakeId]?.revision === s.revision
    )
      blockers.push({
        shotId: id,
        message: "A new take is waiting.",
        fix: "Review takes",
      });
    for (const i of scenePreflight(d, s.sceneId, undefined, undefined, [
      id,
    ]).issues.filter((i) => i.level === "blocker" && i.group !== "Budget"))
      blockers.push({
        shotId: id,
        message: i.message,
        fix:
          i.group === "Plan"
            ? "Approve source"
            : i.group === "Cast"
              ? "Edit cast"
              : "Edit references",
      });
  }
  const cost =
    valid.length * (op === "image" ? CONFIG.imageCost : CONFIG.videoCost);
  if (cost > d.credits)
    blockers.push({
      shotId: valid[0],
      message: `Requires ${cost} credits; ${d.credits} available.`,
      fix: "Account",
    });
  return { ids: valid, blockers, cost };
}
export function generateWorkspace(
  d: Data,
  ids: string[],
  op: Operation,
  proposalId?: string,
) {
  const preview = workspacePreflight(d, ids, op, proposalId);
  if (preview.blockers.length) throw Error(preview.blockers[0].message);
  prepare(d, preview.ids, op);
  if (proposalId) d.proposals[proposalId].state = "applied";
  if (op === "image") {
    for (const id of preview.ids)
      enqueueFrameImage(
        d,
        id,
        generationInputs(d, d.shots[id].sceneId, id).instructions ||
          d.shots[id].action ||
          d.shots[id].title,
      );
  } else {
    const current = preview.ids.filter((id) => d.shots[id].currentTakeId),
      fresh = preview.ids.filter((id) => !d.shots[id].currentTakeId);
    if (current.length) enqueueGeneration(d, current, true);
    if (fresh.length) enqueueGeneration(d, fresh);
  }
}
export function useWorkspaceTake(d: Data, shotId: string, takeId: string) {
  const s = d.shots[shotId];
  if (s.locked) throw Error("Unlock the shot to replace its take.");
  prepare(d, [shotId], d.takes[takeId].kind);
  approveTake(d, shotId, takeId);
  s.discardedTakeIds = (s.discardedTakeIds ?? []).filter((id) => id !== takeId);
}
export function discardWorkspaceTake(d: Data, shotId: string, takeId: string) {
  const s = d.shots[shotId];
  if (s.currentTakeId === takeId)
    throw Error("Choose another take before discarding footage in the edit.");
  s.discardedTakeIds = [...new Set([...(s.discardedTakeIds ?? []), takeId])];
  if (s.candidateTakeId === takeId) s.candidateTakeId = undefined;
  if (s.imageTakeId === takeId) s.imageTakeId = undefined;
}
export function lockWorkspace(d: Data, ids: string[], locked: boolean) {
  for (const id of ids) if (d.shots[id]) d.shots[id].locked = locked;
}
export function assignWorld(
  d: Data,
  shotIds: string[],
  kind: string,
  worldId: string,
) {
  for (const id of shotIds) {
    const shot = d.shots[id];
    if (!shot) continue;
    if (shot.locked) throw Error("Unlock the shot first.");
    if (kind === "character") {
      const cast = effectiveCast(d, id);
      if (!cast.some((c) => c.characterId === worldId))
        saveGenerationCast(
          d,
          shot.sceneId,
          [...cast, { characterId: worldId }],
          id,
        );
    }
    if (kind === "place")
      saveGenerationInputs(
        d,
        shot.sceneId,
        { locationMode: "selected", locationId: worldId },
        id,
      );
    if (kind === "prop" || kind === "note") {
      const project =
        d.projects[d.episodes[d.scenes[shot.sceneId].episodeId].projectId];
      if (
        !project.worldElements?.some((e) => e.id === worldId && e.kind === kind)
      )
        throw Error("Choose a world element from this project.");
      shot.worldElementIds = [
        ...new Set([...(shot.worldElementIds ?? []), worldId]),
      ];
      invalidateWorkspaceShots(d, [id]);
    }
  }
}
export function setWorkspaceSceneCast(
  d: Data,
  sid: string,
  characterId: string,
  include: boolean,
) {
  const cast = ensureSetup(d, sid).cast;
  setSceneCast(
    d,
    sid,
    include
      ? [...cast, { characterId }]
      : cast.filter((c) => c.characterId !== characterId),
  );
}
export function changeShotInputs(
  d: Data,
  id: string,
  fields: Parameters<typeof saveGenerationInputs>[2],
) {
  saveGenerationInputs(d, d.shots[id].sceneId, fields, id);
}
export function changeShotCamera(
  d: Data,
  id: string,
  fields: Partial<{ framing: string; movement: string }>,
) {
  Object.assign(d.shots[id], fields);
  invalidateWorkspaceShots(d, [id]);
}
export function approveWorkspaceSource(d: Data, id: string) {
  const sc = d.scenes[d.shots[id].sceneId];
  approveScript(d, sc.episodeId);
  sc.sourceScriptRevision = d.episodes[sc.episodeId].scriptRevision ?? 1;
  approveScenePlan(d, sc.id);
}
export function worldAppearances(d: Data, kind: string, id: string) {
  return Object.values(d.shots).filter((s) =>
    kind === "character"
      ? effectiveCast(d, s.id).some((c) => c.characterId === id)
      : kind === "place"
        ? generationInputs(d, s.sceneId, s.id).locationId === id
        : (s.worldElementIds ?? []).includes(id),
  );
}
export type WorldElementKind = "character" | "place" | "prop" | "note";
export interface WorldElementCard {
  id: string;
  kind: WorldElementKind;
  name: string;
  description: string;
  assetId?: string;
  looks: number;
  angles: number;
  appearances: number;
}
export function worldElementCards(
  d: Data,
  projectId: string,
): WorldElementCard[] {
  const items: Omit<WorldElementCard, "appearances">[] = [
    ...Object.values(d.characters)
      .filter((c) => c.projectId === projectId)
      .map((c) => {
        const version =
          d.studio.versions[c.canonicalVersionId ?? ""] ??
          Object.values(d.studio.versions)
            .filter(
              (v) =>
                v.ownerKind === "identity" &&
                v.ownerId === c.id &&
                v.approval !== "rejected",
            )
            .sort((a, b) => b.createdAt - a.createdAt)[0];
        return {
          id: c.id,
          kind: "character" as const,
          name: c.name,
          description: c.appearance ?? c.description,
          assetId: version?.assetId,
          looks: Object.values(d.studio.looks).filter(
            (l) => l.characterId === c.id,
          ).length,
          angles: Object.values(d.studio.references).filter(
            (r) => r.characterId === c.id,
          ).length,
        };
      }),
    ...Object.values(d.studio.locations)
      .filter((l) => l.projectId === projectId)
      .map((l) => ({
        id: l.id,
        kind: "place" as const,
        name: l.name,
        description: l.description,
        assetId:
          l.assetId ?? d.studio.versions[l.primaryVersionId ?? ""]?.assetId,
        looks: 0,
        angles: 0,
      })),
    ...(d.projects[projectId]?.worldElements ?? []).map((e) => ({
      ...e,
      looks: 0,
      angles: 0,
    })),
    ...(d.projects[projectId]?.bible?.trim()
      ? [
          {
            id: `bible-${projectId}`,
            kind: "note" as const,
            name: "Story notes",
            description: d.projects[projectId].bible,
            looks: 0,
            angles: 0,
          },
        ]
      : []),
  ];
  return items.map((item) => ({
    ...item,
    appearances: worldAppearances(d, item.kind, item.id).length,
  }));
}
export function createWorldElement(
  d: Data,
  pid: string,
  kind: string,
  name: string,
) {
  if (kind === "character") {
    const id = createCharacter(d, pid);
    updateCharacter(d, id, { name });
    return id;
  }
  if (kind === "place") return createLocation(d, pid, name);
  const id = uid(kind),
    p = d.projects[pid];
  p.worldElements ??= [];
  p.worldElements.push({
    id,
    kind: kind === "prop" ? "prop" : "note",
    name,
    description: "",
  });
  return id;
}
export function editWorldElement(
  d: Data,
  pid: string,
  kind: string,
  id: string,
  fields: { name?: string; description?: string },
) {
  if (kind === "note" && id === `bible-${pid}`) {
    if (fields.description !== undefined)
      d.projects[pid].bible = fields.description;
    return;
  }
  if (kind === "character")
    updateCharacter(d, id, {
      ...(fields.name !== undefined ? { name: fields.name } : {}),
      ...(fields.description !== undefined
        ? { appearance: fields.description }
        : {}),
    });
  else if (kind === "place") {
    Object.assign(d.studio.locations[id], fields);
    d.studio.locations[id].revision++;
  } else {
    const e = d.projects[pid].worldElements?.find((e) => e.id === id);
    if (e) Object.assign(e, fields);
  }
}
export function updateWorldShots(d: Data, kind: string, id: string) {
  invalidateWorkspaceShots(
    d,
    worldAppearances(d, kind, id).map((s) => s.id),
  );
}
export function scriptSuggestions(d: Data, pid: string) {
  const names = new Set(
    d.projects[pid].episodeIds.flatMap((id) =>
      (d.episodes[id].script.match(/^[A-Z][A-Z '-]{1,28}$/gm) ?? [])
        .filter((n) => !/[.:]/.test(n) && !["END", "NIGHT", "DAY"].includes(n))
        .map((n) => n.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())),
    ),
  );
  return [...names].filter(
    (n) =>
      !Object.values(d.characters).some(
        (c) => c.projectId === pid && c.name.toLowerCase() === n.toLowerCase(),
      ),
  );
}
export function assetUsages(d: Data, id: string) {
  return Object.values(d.shots).filter((s) => {
    const inputs = generationInputs(d, s.sceneId, s.id),
      pid = d.episodes[d.scenes[s.sceneId].episodeId].projectId;
    const versionAssets = referenceSnapshot(d, s.id)
      .flatMap((r) => [
        r.identityVersionId,
        r.lookVersionId,
        ...r.referenceVersionIds,
      ])
      .map((v) => (v ? d.studio.versions[v]?.assetId : undefined));
    const propAssets = (d.projects[pid].worldElements ?? [])
      .filter((e) => s.worldElementIds?.includes(e.id))
      .map((e) => e.assetId);
    return (
      Object.values(d.takes).some(
        (t) =>
          t.shotId === s.id &&
          [
            t.assetId,
            t.inputs?.startingFrameAssetId,
            t.inputs?.endingFrameAssetId,
            ...(t.inputs?.referenceInputs ?? []).map((r) => r.assetId),
          ].includes(id),
      ) ||
      [
        inputs.startingFrameAssetId,
        inputs.endingFrameAssetId,
        inputs.locationId
          ? d.studio.locations[inputs.locationId]?.assetId
          : undefined,
        ...inputs.referenceInputs.map((r) => r.assetId),
        ...versionAssets,
        ...propAssets,
      ].includes(id)
    );
  });
}
export function setEpisodeFormat(
  d: Data,
  eid: string,
  aspectRatio: "9:16" | "16:9" | "1:1",
) {
  for (const sid of d.episodes[eid].sceneIds)
    saveGenerationInputs(d, sid, { aspectRatio });
}
export function archiveWorkspaceAssets(
  d: Data,
  ids: string[],
  archived: boolean,
) {
  for (const id of ids) if (d.assets[id]) d.assets[id].archived = archived;
}
export function setStrictApprovals(d: Data, pid: string, enabled: boolean) {
  d.projects[pid].strictApprovals = enabled;
}
export { updateScript, updateDirection, scriptApproved, shotsOfEpisode };

export function changeWorldAsset(
  d: Data,
  pid: string,
  id: string,
  assetId?: string,
) {
  const item = d.projects[pid].worldElements?.find((e) => e.id === id);
  if (!item) throw Error("World element missing.");
  if (
    assetId &&
    (!d.assets[assetId] ||
      d.assets[assetId].projectId !== pid ||
      d.assets[assetId].kind !== "image")
  )
    throw Error("Choose an image from this project.");
  item.assetId = assetId;
  updateWorldShots(d, item.kind, id);
}
export function importWorkspaceAsset(
  d: Data,
  pid: string,
  title: string,
  mime: string,
  url: string,
) {
  if (!d.projects[pid]) throw Error("Project missing.");
  if (
    !/^(image\/(png|jpeg|webp)|video\/(mp4|webm)|audio\/(mpeg|wav|ogg))$/.test(
      mime,
    )
  )
    throw Error("Choose a PNG, JPEG, WebP, MP4, WebM, MP3, WAV or OGG file.");
  const id = uid("upload");
  d.assets[id] = {
    id,
    projectId: pid,
    title,
    kind: mime.startsWith("image/")
      ? "image"
      : mime.startsWith("video/")
        ? "video"
        : "audio",
    url,
    sessionOnly: true,
    provenance: "User upload · session only; reattach after reload",
  };
  return id;
}
export function renameWorkspaceAsset(d: Data, id: string, title: string) {
  if (d.assets[id]) d.assets[id].title = title.trim() || "Untitled media";
}
export function archiveWorkspaceEpisodes(
  d: Data,
  ids: string[],
  archived: boolean,
) {
  for (const id of ids) if (d.episodes[id]) d.episodes[id].archived = archived;
}
export function renameWorkspaceProject(d: Data, id: string, title: string) {
  if (d.projects[id]) d.projects[id].title = title.trim() || "Untitled project";
}
export function restoreWorkspaceSceneCast(d: Data, id: string) {
  const s = d.shots[id];
  s.castOverride = undefined;
  invalidateWorkspaceShots(d, [id]);
}
export function setWorkspaceContinuity(
  d: Data,
  id: string,
  dependsOn?: string,
) {
  updateShotPlan(d, id, { dependsOn });
}

export function setShotWorldElement(
  d: Data,
  shotId: string,
  kind: string,
  id: string,
  include: boolean,
) {
  if (include) assignWorld(d, [shotId], kind, id);
  else {
    d.shots[shotId].worldElementIds = (
      d.shots[shotId].worldElementIds ?? []
    ).filter((value) => value !== id);
    invalidateWorkspaceShots(d, [shotId]);
  }
}

export function selectedWorkspaceShots(
  d: Data,
  keys: string[],
  episodeId?: string,
) {
  return [
    ...new Set(
      keys.flatMap((key) => {
        const split = key.indexOf(":"),
          kind = key.slice(0, split),
          id = key.slice(split + 1);
        return kind === "shot"
          ? [id]
          : kind === "scene"
            ? (d.scenes[id]?.shotIds ?? [])
            : kind === "episode"
              ? shotsOfEpisode(d, id).map((s) => s.id)
              : [];
      }),
    ),
  ].filter(
    (id) =>
      d.shots[id] &&
      (!episodeId || d.scenes[d.shots[id].sceneId].episodeId === episodeId),
  );
}

function invalidateWorkspaceShots(d: Data, ids: string[]) {
  markDomainShotsStale(d, ids);
  for (const pid of new Set(
    ids
      .filter((id) => d.shots[id])
      .map(
        (id) => d.episodes[d.scenes[d.shots[id].sceneId].episodeId].projectId,
      ),
  ))
    bumpStudio(d, pid);
}
export function retryWorkspaceJob(d: Data, id: string) {
  const job = d.jobs[id];
  if (!job) return;
  if (!job.target) {
    if (d.shots[job.shotId]?.locked)
      throw Error("Unlock the shot before retrying.");
    prepare(d, [job.shotId], job.operation as Operation);
  }
  retryJob(d, id);
}
