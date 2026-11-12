import { reviseEpisodeScript, scenePlanApproved } from "./workflow";
import {
  completeStudioJob,
  deleteLook,
  enqueueStudio,
  targetInfo,
  studioProposal,
  applyStudioProposal,
} from "./studio-commands";
import {
  craftInstructions,
  generationInputSnapshot,
} from "./generation-inputs";
import { scenePreflight, referenceSnapshot } from "./scene-preflight";
import {
  CONFIG,
  uid,
  type Data,
  type GenerationJob,
  type Operation,
  type Scope,
} from "./types";
import {
  active,
  dependencyReady,
  isBusy,
  nextOperation,
  preflight,
  shotsOfEpisode,
  shotsOfScene,
} from "./selectors";
import { trimSchema } from "./schemas";
export function touch(d: Data, shotId: string) {
  const ep = d.episodes[d.scenes[d.shots[shotId].sceneId].episodeId];
  ep.timelineVersion++;
  d.projects[ep.projectId].revision++;
}
export function enqueueGeneration(d: Data, ids: string[], replacement = false) {
  const sceneIds = [
    ...new Set(ids.map((id) => d.shots[id]?.sceneId).filter(Boolean)),
  ];
  for (const sid of sceneIds) {
    const p = scenePreflight(d, sid, undefined, undefined, ids);
    if (!p.ready)
      throw Error(p.issues.find((i) => i.level === "blocker")!.message);
  }
  const estimated = preflight(d, ids, replacement).reduce(
    (n, w) => n + w.cost,
    0,
  );
  if (estimated > d.credits) throw Error("Not enough demo credits.");
  let added = 0;
  for (const w of preflight(d, ids, replacement)) {
    const s = d.shots[w.shotId];
    const sc = d.scenes[s.sceneId];
    const ep = d.episodes[sc.episodeId];
    if (d.credits < w.cost)
      throw Error("Not enough demo credits. Reset the demo in Settings.");
    const history = Object.values(d.jobs).filter(
      (j) => j.shotId === s.id && j.operation === w.operation,
    );
    const j: GenerationJob = {
      id: uid("job"),
      projectId: ep.projectId,
      episodeId: ep.id,
      sceneId: sc.id,
      shotId: s.id,
      operation: w.operation,
      state: w.blocked ? "waiting" : "queued",
      attempt: Math.max(0, ...history.map((j) => j.attempt)) + 1,
      cost: w.cost,
      progress: 0,
      revision: s.revision,
      replacement,
      references: referenceSnapshot(d, s.id),
      inputs: generationInputSnapshot(
        d,
        s.id,
        w.operation === "video" ? "video" : "image",
      ),
      dependencyShotId: w.operation === "video" ? s.dependsOn : undefined,
    };
    d.jobs[j.id] = j;
    d.credits -= w.cost;
    added++;
  }
  return added;
}
export function enqueueFrameImage(
  d: Data,
  shotId: string,
  instructions: string,
) {
  const shot = d.shots[shotId];
  if (!shot || isBusy(d, shotId))
    throw Error("Wait for this shot's current generation to finish.");
  if (!instructions.trim()) throw Error("Describe the composition first.");
  if (d.credits < CONFIG.imageCost) throw Error("Not enough demo credits.");
  const scene = d.scenes[shot.sceneId],
    episode = d.episodes[scene.episodeId];
  const inputs = generationInputSnapshot(d, shotId, "image");
  const job: GenerationJob = {
    id: uid("frame-job"),
    projectId: episode.projectId,
    episodeId: episode.id,
    sceneId: scene.id,
    shotId,
    operation: "image",
    state: "queued",
    progress: 0,
    attempt:
      1 +
      Object.values(d.jobs).filter(
        (j) => j.shotId === shotId && j.operation === "image",
      ).length,
    cost: CONFIG.imageCost,
    revision: shot.revision,
    replacement: false,
    references: referenceSnapshot(d, shotId),
    inputs: {
      ...inputs,
      instructions: [
        instructions.trim(),
        inputs.craft ? craftInstructions(inputs.craft) : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  };
  d.jobs[job.id] = job;
  d.credits -= job.cost;
  return job.id;
}
export function completeJob(d: Data, id: string) {
  const j = d.jobs[id];
  if (!j || j.state !== "running") return;
  if (j.target) {
    completeStudioJob(d, id);
    return;
  }
  const s = d.shots[j.shotId];
  if (!s) {
    j.state = "canceled";
    return;
  }
  for (let output = 0; output < (j.outputCount ?? 1); output++) {
    const aid = uid("asset");
    const tid = uid("take");
    const sourceAsset =
      j.operation === "video"
        ? d.assets[j.inputs?.startingFrameAssetId ?? ""]
        : d.assets[d.takes[s.imageTakeId ?? ""]?.assetId ?? ""];
    d.assets[aid] = {
      id: aid,
      projectId: j.projectId,
      title: `${s.title} · demo ${j.operation} ${j.attempt}`,
      kind: "image",
      url:
        sourceAsset?.url && !sourceAsset.missing
          ? sourceAsset.url
          : d.scenes[s.sceneId].cover,
      provenance:
        "Simulated result using bundled AI-created demo photography; no live generation or video rendering.",
    };
    d.takes[tid] = {
      id: tid,
      shotId: s.id,
      kind: j.operation,
      revision: j.revision,
      approved: false,
      sourceFrames: j.inputs?.targetFrames ?? s.targetFrames,
      assetId: aid,
      createdAt: Date.now(),
      sourceTakeId: j.sourceTakeId,
      references: j.references,
      inputs: j.inputs,
    };
    if (j.operation === "image") {
      if (!s.imageTakeId) s.imageTakeId = tid;
    } else s.candidateTakeId = tid;
  }
  j.state = "succeeded";
  j.progress = 100;
}
export function tick(d: Data) {
  for (const j of Object.values(d.jobs)) {
    if (j.state !== "running") continue;
    j.progress = Math.min(100, (j.progress ?? 0) + CONFIG.progressStep);
    if (j.progress >= 100) completeJob(d, j.id);
  }
  let running = Object.values(d.jobs).filter(
    (j) => j.state === "running",
  ).length;
  for (const j of Object.values(d.jobs)) {
    if (!["waiting", "queued"].includes(j.state)) continue;
    if (j.target) {
      if (running < CONFIG.concurrency) {
        j.state = "running";
        running++;
      }
      continue;
    }
    const s = d.shots[j.shotId];
    if (!s) {
      j.state = "canceled";
      continue;
    }
    if (j.operation === "video" && !dependencyReady(d, s)) {
      j.state = "waiting";
      continue;
    }
    j.state = "queued";
    if (running >= CONFIG.concurrency) continue;
    j.state = "running";
    j.sourceTakeId = s.dependsOn
      ? d.shots[s.dependsOn]?.currentTakeId
      : undefined;
    running++;
  }
}
export function retryJob(d: Data, id: string) {
  const j = d.jobs[id];
  if (j?.target && ["failed", "canceled"].includes(j.state)) {
    const info = targetInfo(d, j.target.kind, j.target.id);
    const sameSource =
      info.revision === j.revision &&
      info.identity === j.sourceIdentityVersionId &&
      (!("sourceLook" in info) || info.sourceLook === j.sourceLookVersionId);
    enqueueStudio(d, j.target.kind, [j.target.id], false, {
      count: j.outputCount,
      viewType: j.viewType,
      specification: sameSource ? j.specification : undefined,
    });
    return;
  }
  if (!j || !["failed", "canceled"].includes(j.state) || isBusy(d, j.shotId))
    return;
  const s = d.shots[j.shotId];
  if (!s) return;
  const readiness = scenePreflight(d, s.sceneId, undefined, undefined, [s.id]);
  if (!readiness.ready)
    throw Error(readiness.issues.find((i) => i.level === "blocker")!.message);
  if (d.credits < j.cost) throw Error("Not enough demo credits.");
  const attempt =
    Math.max(
      ...Object.values(d.jobs)
        .filter((x) => x.shotId === s.id && x.operation === j.operation)
        .map((x) => x.attempt),
    ) + 1;
  const next = {
    ...j,
    id: uid("job"),
    state: "queued" as const,
    progress: 0,
    error: undefined,
    revision: s.revision,
    references: referenceSnapshot(d, s.id),
    inputs: generationInputSnapshot(
      d,
      s.id,
      j.operation === "video" ? "video" : "image",
    ),
    attempt,
  };
  d.jobs[next.id] = next;
  d.credits -= next.cost;
}
export function approveTake(d: Data, shotId: string, takeId: string) {
  const s = d.shots[shotId],
    t = d.takes[takeId];
  if (!s || !t || t.shotId !== s.id)
    throw Error("This take does not belong to the selected shot.");
  if (t.revision !== s.revision)
    throw Error(
      "This candidate belongs to an older revision. Generate a replacement for the current revision.",
    );
  if (
    t.kind === "video" &&
    s.dependsOn &&
    t.sourceTakeId !== d.shots[s.dependsOn]?.currentTakeId
  )
    throw Error("The continuation source changed. Generate a new candidate.");
  if (!scenePlanApproved(d, s.sceneId))
    throw Error("Approve the current scene plan before accepting this result.");
  t.approved = true;
  if (t.kind === "image") s.imageTakeId = t.id;
  if (t.kind === "video") {
    s.currentTakeId = t.id;
    if (s.candidateTakeId === t.id) s.candidateTakeId = undefined;
    s.stale = false;
    for (const x of Object.values(d.shots))
      if (x.dependsOn === s.id && (x.currentTakeId || x.candidateTakeId))
        x.stale = true;
    touch(d, s.id);
  }
}
export function trimShot(
  d: Data,
  id: string,
  inFrame: number,
  outFrame: number,
) {
  trimSchema.parse({ inFrame, outFrame });
  const s = d.shots[id];
  const max = s.currentTakeId
    ? d.takes[s.currentTakeId].sourceFrames
    : s.targetFrames;
  if (outFrame > max) throw Error(`Out point exceeds the ${max / 30}s source.`);
  s.inFrame = inFrame;
  s.outFrame = outFrame;
  touch(d, id);
}
export function reorderShots(d: Data, sceneId: string, ids: string[]) {
  const sc = d.scenes[sceneId];
  if (
    ids.length !== sc.shotIds.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !sc.shotIds.includes(id))
  )
    throw Error("Invalid shot order.");
  for (const id of ids) {
    const dep = d.shots[id].dependsOn;
    if (dep && ids.indexOf(dep) >= ids.indexOf(id))
      throw Error("A continuation must stay after its source shot.");
  }
  sc.shotIds = ids;
  touch(d, ids[0]);
}
export function updateScript(d: Data, id: string, script: string) {
  reviseEpisodeScript(d, id, script);
}
export function proposal(d: Data, scope: Scope, text: string) {
  const studioId = studioProposal(d, scope, text);
  if (studioId) return studioId;
  const lower = text.toLowerCase();
  let intent:
    "develop" | "suspense" | "trim" | "generate" | "replace" | undefined;
  if (/shorten|trim/.test(lower)) intent = "trim";
  else if (/regenerate|replacement/.test(lower)) intent = "replace";
  else if (/generate/.test(lower)) intent = "generate";
  else if (/suspense/.test(lower)) intent = "suspense";
  else if (/develop/.test(lower)) intent = "develop";
  if (!intent) return undefined;
  const ids = scope.shotId
    ? [scope.shotId]
    : scope.sceneId
      ? shotsOfScene(d, scope.sceneId).map((s) => s.id)
      : scope.episodeId
        ? shotsOfEpisode(d, scope.episodeId).map((s) => s.id)
        : [];
  if (!ids.length) return undefined;
  if (intent === "trim" && ids.length !== 1) return undefined;
  const id = uid("proposal");
  d.proposals[id] = {
    id,
    scope: structuredClone(scope),
    shotIds: ids,
    intent,
    before: ids.map((s) => d.shots[s].action).join("\n"),
    after:
      intent === "trim"
        ? "Shorten the selected shot by one second."
        : intent === "suspense"
          ? "Hold on the silence. Delay the reveal. Keep Maya’s identity, wardrobe, and the apartment unchanged."
          : intent === "develop"
            ? "Build the episode around the necklace: establish the empty room, reveal the recording, discover the clue, then let Leo interrupt."
            : intent === "replace"
              ? "Create a replacement candidate. Preserve character, wardrobe, and framing."
              : "Generate eligible work, keeping image approval checkpoints.",
    state: "proposed",
    cost: ["generate", "replace"].includes(intent)
      ? preflight(d, ids, intent === "replace").reduce((n, w) => n + w.cost, 0)
      : 0,
  };
  return id;
}
export function applyEditProposal(d: Data, id: string) {
  const p = d.proposals[id];
  if (!p || p.state !== "proposed") return;
  if (p.intent === "studio") {
    applyStudioProposal(d, id);
    return;
  }
  if (!d.projects[p.scope.projectId] || p.shotIds.some((s) => !d.shots[s]))
    throw Error("The original target no longer exists.");
  if (d.projects[p.scope.projectId].revision !== p.scope.revision)
    throw Error(
      "The project changed since this proposal. Submit a new request to review the current context.",
    );
  if (p.intent === "generate" || p.intent === "replace")
    throw Error("Generation requires separate spending confirmation.");
  if (p.intent === "trim") {
    const s = d.shots[p.shotIds[0]];
    trimShot(d, s.id, s.inFrame, s.outFrame - 30);
  } else
    for (const id of p.shotIds) {
      const s = d.shots[id];
      d.scenes[s.sceneId].planRevision =
        (d.scenes[s.sceneId].planRevision ?? 1) + 1;
      s.action = p.after;
      s.revision++;
      s.stale = !!s.currentTakeId;
      touch(d, id);
    }
  p.state = "applied";
}
export function cancelJob(d: Data, id: string) {
  if (d.jobs[id] && active(d.jobs[id])) d.jobs[id].state = "canceled";
}
export function deleteEpisode(d: Data, id: string) {
  const ep = d.episodes[id];
  if (!ep) return;
  for (const look of Object.values(d.studio.looks))
    if (look.episodeId === id) deleteLook(d, look.id);
  for (const s of shotsOfEpisode(d, id)) {
    for (const j of Object.values(d.jobs))
      if (j.shotId === s.id) delete d.jobs[j.id];
    for (const t of Object.values(d.takes))
      if (t.shotId === s.id) delete d.takes[t.id];
    delete d.shots[s.id];
  }
  for (const sid of ep.sceneIds) {
    delete d.scenes[sid];
    delete d.studio.setups[sid];
  }
  for (const e of Object.values(d.exports))
    if (e.episodeId === id) delete d.exports[e.id];
  delete d.threads[id];
  d.projects[ep.projectId].episodeIds = d.projects[
    ep.projectId
  ].episodeIds.filter((x) => x !== id);
  delete d.episodes[id];
}
export function duplicateEpisode(d: Data, id: string) {
  const source = d.episodes[id];
  const eid = uid("ep");
  const ep = {
    ...structuredClone(source),
    id: eid,
    title: `${source.title} (copy)`,
    sceneIds: [] as string[],
    timelineVersion: 1,
  };
  d.episodes[eid] = ep;
  d.projects[ep.projectId].episodeIds.push(eid);
  const shotMap: Record<string, string> = {};
  for (const s of shotsOfEpisode(d, id)) shotMap[s.id] = uid("shot");
  for (const sid of source.sceneIds) {
    const sc = d.scenes[sid],
      nid = uid("scene");
    d.scenes[nid] = {
      ...structuredClone(sc),
      id: nid,
      episodeId: eid,
      shotIds: sc.shotIds.map((s) => shotMap[s]),
    };
    ep.sceneIds.push(nid);
    if (d.studio.setups[sid])
      d.studio.setups[nid] = {
        ...structuredClone(d.studio.setups[sid]),
        sceneId: nid,
      };
    for (const qid of sc.shotIds) {
      const s = {
        ...structuredClone(d.shots[qid]),
        id: shotMap[qid],
        sceneId: nid,
        characters: [...d.shots[qid].characters],
        dependsOn: d.shots[qid].dependsOn
          ? shotMap[d.shots[qid].dependsOn!]
          : undefined,
      };
      for (const key of [
        "imageTakeId",
        "currentTakeId",
        "candidateTakeId",
      ] as const) {
        const tid = s[key];
        if (tid) {
          const newId = uid("take");
          d.takes[newId] = { ...d.takes[tid], id: newId, shotId: s.id };
          s[key] = newId;
        }
      }
      d.shots[s.id] = s;
    }
  }
  for (const sid of ep.sceneIds)
    for (const qid of d.scenes[sid].shotIds) {
      const s = d.shots[qid];
      if (s.dependsOn)
        for (const t of Object.values(d.takes))
          if (t.shotId === qid)
            t.sourceTakeId = d.shots[s.dependsOn].currentTakeId;
    }
  return eid;
}
export function enqueueExact(d: Data, ids: string[], op: Operation) {
  return enqueueGeneration(
    d,
    ids.filter((id) => nextOperation(d, d.shots[id]) === op),
  );
}
