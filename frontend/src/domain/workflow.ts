import { uid, type Data, type Episode, type Scene } from "./types";
import { ensureSetup } from "./scene-preflight";
import { markShotsStale, bumpStudio } from "./studio-commands";
import { generationInputs } from "./generation-inputs";
export const scriptApproved = (ep: Episode) =>
  !!ep.script.trim() && ep.scriptApprovedRevision === (ep.scriptRevision ?? 1);
export function scenePlanApproved(d: Data, id: string) {
  const s = d.scenes[id],
    ep = s ? d.episodes[s.episodeId] : undefined;
  return (
    !!s &&
    !!ep &&
    scriptApproved(ep) &&
    s.planApprovedRevision === (s.planRevision ?? 1) &&
    s.sourceScriptRevision === (ep.scriptRevision ?? 1)
  );
}
/** Existing production is imported as an approved plan, without touching takes, IDs or edits. */
export function migrateWorkflow(d: Data) {
  for (const ep of Object.values(d.episodes)) {
    if (ep.scriptRevision !== undefined) continue;
    ep.scriptRevision = 1;
    ep.scriptHistory = [];
    if (ep.script.trim() && ep.sceneIds.length) {
      ep.scriptApprovedRevision = 1;
      ep.scriptHistory.push({ revision: 1, script: ep.script, approvedAt: 0 });
    }
    for (const id of ep.sceneIds) {
      const sc = d.scenes[id];
      if (!sc || sc.planRevision !== undefined) continue;
      sc.planRevision = 1;
      sc.sourceScriptRevision = 1;
      sc.dialogue = sc.shotIds
        .map((id) => d.shots[id]?.dialogue)
        .filter(Boolean)
        .join("\n");
      sc.settingDescription = "";
      sc.creativeNotes = "";
      sc.planHistory = [];
      if (ep.scriptApprovedRevision) {
        sc.planApprovedRevision = 1;
        sc.planHistory.push(planSnapshot(d, id));
      }
    }
  }
}
function planSnapshot(d: Data, id: string) {
  const s = d.scenes[id],
    ep = d.episodes[s.episodeId];
  return {
    revision: s.planRevision ?? 1,
    scriptRevision: ep.scriptRevision ?? 1,
    title: s.title,
    description: s.description,
    screenplay: s.screenplay,
    dialogue: s.dialogue ?? "",
    settingDescription: s.settingDescription ?? "",
    creativeNotes: s.creativeNotes ?? "",
    targetSeconds: ensureSetup(d, id).targetSeconds,
    direction: structuredClone(ensureSetup(d, id).direction),
    shots: s.shotIds.map((id) => ({
      id,
      action: d.shots[id].action,
      dialogue: d.shots[id].dialogue,
      targetFrames: d.shots[id].targetFrames,
    })),
    approvedAt: Date.now(),
  };
}
export function reviseEpisodeScript(d: Data, id: string, text: string) {
  const ep = d.episodes[id];
  if (!ep) throw Error("Episode no longer exists.");
  if (ep.script === text) return;
  if (text.length > 50000) throw Error("Use a script under 50,000 characters.");
  ep.script = text;
  ep.scriptRevision = (ep.scriptRevision ?? 1) + 1;
  ep.revision++;
  markShotsStale(
    d,
    ep.sceneIds.flatMap((id) => d.scenes[id].shotIds),
  );
  bumpStudio(d, ep.projectId);
}
export function approveScript(d: Data, id: string) {
  const ep = d.episodes[id];
  if (!ep?.script.trim()) throw Error("Write or generate a script first.");
  ep.scriptRevision ??= 1;
  if (scriptApproved(ep)) return;
  ep.scriptApprovedRevision = ep.scriptRevision;
  (ep.scriptHistory ??= []).push({
    revision: ep.scriptRevision,
    script: ep.script,
    approvedAt: Date.now(),
  });
  bumpStudio(d, ep.projectId);
}
export function updateScenePlan(
  d: Data,
  id: string,
  fields: Partial<
    Pick<
      Scene,
      | "title"
      | "screenplay"
      | "description"
      | "dialogue"
      | "settingDescription"
      | "creativeNotes"
    >
  >,
  seconds?: number,
) {
  const s = d.scenes[id];
  if (!s) throw Error("Scene no longer exists.");
  if (
    fields.title !== undefined &&
    (!fields.title.trim() || fields.title.trim().length > 120)
  )
    throw Error("Name this scene using 1–120 characters.");
  if (Object.values(fields).some((v) => v && v.length > 10000))
    throw Error("Keep each field under 10,000 characters.");
  const setup = ensureSetup(d, id);
  if (
    seconds !== undefined &&
    (!Number.isFinite(seconds) || seconds < 3 || seconds > 90)
  )
    throw Error("Scene duration must be 3–90 seconds.");
  if (
    Object.entries(fields).every(([k, v]) => s[k as keyof Scene] === v) &&
    (seconds === undefined || Math.abs(seconds - setup.targetSeconds) < 1 / 30)
  )
    return;
  const affectsGeneration =
    seconds !== undefined ||
    Object.entries(fields).some(
      ([key, value]) => key !== "title" && s[key as keyof Scene] !== value,
    );
  Object.assign(
    s,
    fields,
    fields.title !== undefined ? { title: fields.title.trim() } : {},
  );
  if (!affectsGeneration) {
    bumpStudio(d, d.episodes[s.episodeId].projectId);
    return;
  }
  s.planRevision = (s.planRevision ?? 1) + 1;
  setup.revision++;
  if (seconds !== undefined) {
    setup.targetSeconds = Math.round(seconds * 30) / 30;
    const total = Math.round(seconds * 30);
    if (total < s.shotIds.length * 30 || total > s.shotIds.length * 900)
      throw Error(
        "Each shot must stay between 1 and 30 seconds. Adjust the shot breakdown first.",
      );
    s.shotIds.forEach((id, i) => {
      d.shots[id].targetFrames =
        Math.floor(total / s.shotIds.length) +
        (i < total % s.shotIds.length ? 1 : 0);
    });
  }
  if (
    fields.description !== undefined &&
    setup.generation &&
    s.screenplay === undefined
  )
    setup.generation.instructions = fields.description;
  if (fields.screenplay !== undefined && setup.generation)
    setup.generation.instructions = fields.screenplay;
  if (fields.dialogue !== undefined && s.shotIds.length)
    d.shots[s.shotIds.at(-1)!].dialogue = fields.dialogue;
  markShotsStale(d, s.shotIds);
  bumpStudio(d, d.episodes[s.episodeId].projectId);
}
export function approveScenePlan(d: Data, id: string) {
  const s = d.scenes[id],
    ep = s ? d.episodes[s.episodeId] : undefined;
  if (!s || !ep || !scriptApproved(ep))
    throw Error("Approve the current script first.");
  if (!s.title.trim() || !s.description.trim() || !s.shotIds.length)
    throw Error("Add a scene title, detailed description, and shot plan.");
  const setup = ensureSetup(d, id);
  const total = s.shotIds.reduce(
    (n, id) => n + d.shots[id].targetFrames / 30,
    0,
  );
  if (
    setup.targetSeconds < 3 ||
    setup.targetSeconds > 90 ||
    Math.abs(total - setup.targetSeconds) > 1 / 30 ||
    s.shotIds.some(
      (id) => d.shots[id].targetFrames < 30 || d.shots[id].targetFrames > 900,
    )
  )
    throw Error("Match the scene duration to valid 1–30 second shot targets.");
  if (scenePlanApproved(d, id)) return;
  s.planRevision ??= 1;
  s.planApprovedRevision = s.planRevision;
  s.sourceScriptRevision = ep.scriptRevision ?? 1;
  (s.planHistory ??= []).push(planSnapshot(d, id));
  bumpStudio(d, ep.projectId);
}
export function approveEpisodePlans(d: Data, id: string) {
  const ep = d.episodes[id];
  if (!ep?.sceneIds.length) throw Error("Plan the scenes first.");
  for (const sid of ep.sceneIds) approveScenePlan(d, sid);
}
export function createPlannedScene(
  d: Data,
  eid: string,
  title: string,
  description: string,
  seconds = 15,
) {
  const ep = d.episodes[eid];
  if (!ep || !scriptApproved(ep))
    throw Error("Approve the script before planning scenes.");
  const id = uid("scene");
  const frames = Math.round(seconds * 30),
    count = Math.max(
      1,
      Math.min(3, Math.floor(seconds / 3), Math.ceil(seconds / 10)),
    );
  const shotIds = Array.from({ length: count }, () => uid("shot"));
  d.scenes[id] = {
    id,
    episodeId: eid,
    title,
    description,
    shotIds,
    cover: d.projects[ep.projectId].cover,
    planRevision: 1,
    sourceScriptRevision: ep.scriptRevision ?? 1,
    dialogue: "",
    settingDescription: "",
    creativeNotes: "",
    planHistory: [],
  };
  shotIds.forEach((qid, i) => {
    const targetFrames =
      Math.floor(frames / count) + (i < frames % count ? 1 : 0);
    d.shots[qid] = {
      id: qid,
      sceneId: id,
      title:
        count === 1
          ? "Scene moment"
          : ["Establish the moment", "Follow the action", "Hold the reaction"][
              i
            ],
      action: description,
      dialogue: "",
      characters: [],
      targetFrames,
      inFrame: 0,
      outFrame: targetFrames,
      revision: 1,
      stale: false,
    };
  });
  ep.sceneIds.push(id);
  ensureSetup(d, id);
  ep.timelineVersion++;
  bumpStudio(d, ep.projectId);
  return id;
}
export function draftScript(ep: Episode) {
  const premise =
    ep.synopsis.trim() || "A small discovery changes an ordinary day.";
  return `INT. A FAMILIAR PLACE — EVENING\n\nTITLE: ${ep.title}\n\n${premise}\n\nA quiet opening establishes the person at the center of the story. An unexpected detail interrupts the routine.\n\nEXT. THE THRESHOLD — MOMENTS LATER\n\nThe discovery forces a choice. A small gesture reveals what the character has been holding back.\n\nINT. THE SAME PLACE — LATER\n\nThe character returns to the original moment with a different understanding. Hold on the consequence of the choice.\n\nEND.`;
}
function dialogueFromScript(text: string) {
  const lines = text.split("\n"),
    result: string[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const speaker = lines[i].trim();
    if (
      /^[A-Z][A-Z .'-]{1,35}$/.test(speaker) &&
      !/^(INT|EXT|SCENE|END)/.test(speaker)
    ) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j < lines.length && !/^(INT|EXT|SCENE)/.test(lines[j])) {
        result.push(speaker + ": " + lines[j].trim());
        i = j;
      }
    }
  }
  return result.join("\n");
}
export function planScenes(d: Data, eid: string, count = 3) {
  const ep = d.episodes[eid];
  if (!ep || !scriptApproved(ep))
    throw Error("Approve the current script before planning scenes.");
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 8 ||
    ep.targetSeconds < count * 3
  )
    throw Error(
      "Choose a scene count that allows at least 3 seconds per scene.",
    );
  const chunks = ep.script
    .split(/(?=^(?:INT\.|EXT\.|INT\/EXT\.|SCENE\s+\d+))/m)
    .map((s) => s.trim())
    .filter(Boolean);
  const paragraphs = ep.script
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const descriptions = Array.from({ length: count }, (_, i) =>
    chunks.length > 1
      ? chunks[
          Math.min(chunks.length - 1, Math.floor((i * chunks.length) / count))
        ]
      : paragraphs
          .slice(
            Math.floor((i * paragraphs.length) / count),
            Math.max(
              Math.floor(((i + 1) * paragraphs.length) / count),
              Math.floor((i * paragraphs.length) / count) + 1,
            ),
          )
          .join("\n\n") || ep.script,
  );
  if (ep.sceneIds.length) {
    ep.sceneIds.forEach((id, i) => {
      const s = d.scenes[id];
      updateScenePlan(d, id, {
        description: descriptions[Math.min(i, count - 1)],
        settingDescription: descriptions[Math.min(i, count - 1)].split("\n")[0],
        dialogue: dialogueFromScript(descriptions[Math.min(i, count - 1)]),
      });
      s.sourceScriptRevision = ep.scriptRevision ?? 1;
      s.planApprovedRevision = undefined;
    });
    return ep.sceneIds;
  }
  const total = Math.round(ep.targetSeconds * 30);
  descriptions.forEach((desc, i) => {
    const seconds =
      (Math.floor(total / count) + (i < total % count ? 1 : 0)) / 30;
    const first = desc.split("\n")[0];
    const id = createPlannedScene(
      d,
      eid,
      first.length < 75 ? first : `Scene ${i + 1}`,
      desc,
      seconds,
    );
    d.scenes[id].settingDescription = /^(INT|EXT)/.test(first) ? first : "";
    d.scenes[id].dialogue = dialogueFromScript(desc);
    d.shots[d.scenes[id].shotIds.at(-1)!].dialogue =
      d.scenes[id].dialogue ?? "";
  });
  return ep.sceneIds;
}
export function splitScene(d: Data, id: string) {
  const s = d.scenes[id];
  if (!s || s.shotIds.length < 2)
    throw Error("A scene needs at least two shots to split.");
  if (
    s.shotIds
      .slice(0, Math.ceil(s.shotIds.length / 2))
      .reduce((n, id) => n + d.shots[id].targetFrames / 30, 0) < 3 ||
    s.shotIds
      .slice(Math.ceil(s.shotIds.length / 2))
      .reduce((n, id) => n + d.shots[id].targetFrames / 30, 0) < 3
  )
    throw Error("Each split scene needs at least 3 seconds.");
  const ep = d.episodes[s.episodeId],
    setup = ensureSetup(d, id),
    cut = Math.ceil(s.shotIds.length / 2),
    moved = s.shotIds.splice(cut),
    next = uid("scene");
  d.scenes[next] = {
    ...structuredClone(s),
    id: next,
    title: s.title + " · Part 2",
    shotIds: moved,
    planRevision: 1,
    planApprovedRevision: undefined,
    planHistory: [],
  };
  s.planRevision = (s.planRevision ?? 1) + 1;
  s.planApprovedRevision = undefined;
  d.studio.setups[next] = {
    ...structuredClone(setup),
    sceneId: next,
    targetSeconds: moved.reduce(
      (n, id) => n + d.shots[id].targetFrames / 30,
      0,
    ),
  };
  setup.targetSeconds = s.shotIds.reduce(
    (n, id) => n + d.shots[id].targetFrames / 30,
    0,
  );
  for (const qid of moved) {
    const q = d.shots[qid];
    q.sceneId = next;
    for (const j of Object.values(d.jobs))
      if (j.shotId === qid) j.sceneId = next;
    if (q.dependsOn && !moved.includes(q.dependsOn)) q.dependsOn = undefined;
  }
  ep.sceneIds.splice(ep.sceneIds.indexOf(id) + 1, 0, next);
  markShotsStale(d, [...s.shotIds, ...moved]);
  bumpStudio(d, ep.projectId);
  return next;
}
export function mergeSceneWithNext(d: Data, id: string) {
  const s = d.scenes[id],
    ep = s ? d.episodes[s.episodeId] : undefined;
  if (!s || !ep) throw Error("Scene not found.");
  const nextId = ep.sceneIds[ep.sceneIds.indexOf(id) + 1],
    next = d.scenes[nextId];
  if (!next) throw Error("There is no following scene to merge.");
  const setup = ensureSetup(d, id),
    other = ensureSetup(d, nextId);
  if (setup.targetSeconds + other.targetSeconds > 90)
    throw Error("Merged scenes must fit within 90 seconds.");
  for (const qid of next.shotIds) {
    const q = d.shots[qid];
    q.castOverride ??= structuredClone(other.cast);
    q.generationOverride ??= generationInputs(d, nextId, qid);
    q.sceneId = id;
  }
  s.description += "\n\n" + next.description;
  s.dialogue = [s.dialogue, next.dialogue].filter(Boolean).join("\n");
  s.shotIds.push(...next.shotIds);
  s.planHistory = [...(s.planHistory ?? []), ...(next.planHistory ?? [])];
  s.planRevision = (s.planRevision ?? 1) + 1;
  s.planApprovedRevision = undefined;
  setup.targetSeconds += other.targetSeconds;
  ep.sceneIds = ep.sceneIds.filter((x) => x !== nextId);
  delete d.scenes[nextId];
  delete d.studio.setups[nextId];
  for (const j of Object.values(d.jobs))
    if (j.sceneId === nextId) j.sceneId = id;
  markShotsStale(d, s.shotIds);
  bumpStudio(d, ep.projectId);
}
export function sceneWorkflowLabel(d: Data, id: string) {
  const s = d.scenes[id];
  if (!scenePlanApproved(d, id)) return "Review plan";
  if (
    s.shotIds.some((id) =>
      Object.values(d.jobs).some(
        (j) =>
          j.shotId === id && ["queued", "running", "waiting"].includes(j.state),
      ),
    )
  )
    return "Generating";
  if (
    s.shotIds.some(
      (id) =>
        d.shots[id].candidateTakeId ||
        (d.shots[id].imageTakeId &&
          !d.takes[d.shots[id].imageTakeId!]?.approved),
    )
  )
    return "Review results";
  if (s.shotIds.every((id) => d.shots[id].currentTakeId && !d.shots[id].stale))
    return "Ready to edit";
  return "Choose references";
}
