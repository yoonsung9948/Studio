import { scriptApproved, scenePlanApproved } from "./workflow";
import { type Data, type SceneSetup, type ReferenceSnapshot } from "./types";
import { generationInputs, referencePurposes } from "./generation-inputs";
import { preflight, active, shotsOfScene } from "./selectors";
import {
  characterReady,
  lookReady,
  referenceValid,
  effectiveCast,
  characterReferences,
} from "./studio-selectors";
export interface Requirement {
  id: string;
  level: "blocker" | "warning";
  group: "Plan" | "Cast" | "References" | "Location" | "Shot plan" | "Budget";
  message: string;
  action: string;
  href: string;
}
export function scenePreflight(
  d: Data,
  sid: string,
  projectId?: string,
  episodeId?: string,
  shotIds?: string[],
) {
  const sc = d.scenes[sid],
    ep = sc ? d.episodes[sc.episodeId] : undefined;
  const pid = projectId ?? ep?.projectId ?? "";
  const eid = episodeId ?? ep?.id ?? "";
  const setup = d.studio.setups[sid];
  const href = `/projects/${pid}/episodes/${eid}/scenes/${sid}/setup`;
  const issues: Requirement[] = [];
  const add = (
    level: Requirement["level"],
    group: Requirement["group"],
    message: string,
    action = "Review setup",
    to = href,
  ) => {
    issues.push({
      id: `${group}-${issues.length}`,
      level,
      group,
      message,
      action,
      href: to,
    });
  };
  if (!sc || !ep || ep.projectId !== pid || sc.episodeId !== eid) {
    add(
      "blocker",
      "Shot plan",
      "This scene does not belong to the selected project and episode.",
    );
    return {
      issues,
      work: [],
      cost: 0,
      images: 0,
      videos: 0,
      dependencies: 0,
      reused: 0,
      ready: false,
    };
  }
  if (!scriptApproved(ep))
    add(
      "blocker",
      "Plan",
      "Approve the current episode script before generating.",
      "Review script",
      `/projects/${pid}/episodes/${eid}?tab=script`,
    );
  if (!scenePlanApproved(d, sid))
    add(
      "blocker",
      "Plan",
      "Approve this scene plan for the current script before generating.",
      "Review scene plan",
      `/projects/${pid}/episodes/${eid}/scenes/${sid}?step=plan`,
    );
  const allShots = shotsOfScene(d, sid);
  const shots = shotIds
    ? allShots.filter((s) => shotIds.includes(s.id))
    : allShots;
  if (!setup) add("blocker", "Shot plan", "Scene setup is missing.");
  if (
    !shots.length ||
    allShots.length !== sc.shotIds.length ||
    new Set(sc.shotIds).size !== sc.shotIds.length
  )
    add(
      "blocker",
      "Shot plan",
      "The shot plan must contain valid, unique shots.",
    );
  if (
    setup &&
    (!Number.isFinite(setup.targetSeconds) ||
      setup.targetSeconds < 3 ||
      setup.targetSeconds > 90)
  )
    add(
      "blocker",
      "Shot plan",
      "Scene target must be between 3 and 90 seconds.",
    );
  const planned = allShots.reduce((n, s) => n + s.targetFrames / 30, 0);
  if (setup && Math.abs(planned - setup.targetSeconds) > 1 / 30)
    add(
      "blocker",
      "Shot plan",
      `Shot targets total ${Number(planned.toFixed(2))}s; the scene target is ${setup.targetSeconds}s.`,
    );
  const casts = shots.flatMap((s) => effectiveCast(d, s.id));
  const unique = new Map(
    casts.map((a) => [
      `${a.characterId}/${a.lookId}/${a.referenceIds?.join(",")}`,
      a,
    ]),
  );
  for (const a of unique.values()) {
    const c = d.characters[a.characterId];
    const cp = `/projects/${pid}/characters/${a.characterId}?returnTo=${encodeURIComponent(href)}`;
    if (!c || c.projectId !== pid) {
      add(
        "blocker",
        "Cast",
        "An assigned character is missing or belongs to another project.",
        "Choose character",
      );
      continue;
    }
    if (!characterReady(d, c.id))
      add(
        "blocker",
        "Cast",
        `${c.name} needs an approved identity and one valid approved reference.`,
        "Open Character Studio",
        cp,
      );
    if (a.lookId) {
      const l = d.studio.looks[a.lookId];
      if (!l || l.characterId !== c.id)
        add(
          "blocker",
          "Cast",
          `${c.name} has a Look belonging to another character or a missing Look.`,
          "Choose Look",
        );
      else if (!lookReady(d, l.id))
        add(
          "blocker",
          "Cast",
          `${c.name}’s ${l.name} Look is not approved for the current identity.`,
          "Review Look",
          cp + `&tab=looks&look=${l.id}`,
        );
    }
    for (const rid of a.referenceIds ?? []) {
      const r = d.studio.references[rid];
      if (
        !r ||
        r.characterId !== c.id ||
        (r.lookId && r.lookId !== a.lookId) ||
        !referenceValid(d, rid)
      )
        add(
          "blocker",
          "References",
          `${c.name} has a selected reference that needs approval or has changed.`,
          "Review reference",
          cp + "&tab=references",
        );
    }
    if (
      characterReady(d, c.id) &&
      characterReferences(d, c.id).filter((r) => referenceValid(d, r.id))
        .length < 3
    )
      add(
        "warning",
        "References",
        `${c.name} is usable with one reference. Additional views may improve consistency.`,
        "Add references",
        cp + "&tab=references",
      );
  }
  const inputContexts = new Map(
    shots.map((s) => {
      const v = generationInputs(d, sid, s.id);
      return [JSON.stringify(v), v];
    }),
  );
  for (const inputs of inputContexts.values()) {
    if (inputs.endingFrameAssetId && !inputs.startingFrameAssetId)
      add(
        "blocker",
        "References",
        "An ending frame requires a starting frame.",
      );
    for (const aid of [
      inputs.startingFrameAssetId,
      inputs.endingFrameAssetId,
    ].filter(Boolean) as string[]) {
      const asset = d.assets[aid];
      if (
        !asset ||
        asset.projectId !== pid ||
        asset.kind !== "image" ||
        asset.missing ||
        !asset.url
      )
        add(
          "blocker",
          "References",
          "A conditioning frame is missing. Replace or remove it.",
        );
    }
    const l = inputs.locationId
      ? d.studio.locations[inputs.locationId]
      : undefined;
    if (inputs.locationId && (!l || l.projectId !== pid))
      add(
        "blocker",
        "Location",
        "The selected setting is missing or belongs to another project.",
        "Choose setting",
      );
    else if (
      ["selected", "required"].includes(inputs.locationMode) &&
      (!l?.assetId || !d.assets[l.assetId]?.url || d.assets[l.assetId]?.missing)
    )
      add(
        "blocker",
        "Location",
        "A setting image is required. Choose or upload a reference.",
        "Choose setting",
      );
    else if (inputs.locationMode === "inferred")
      add(
        "warning",
        "Location",
        "The setting will be inferred from the scene instructions. No image is required.",
      );
    for (const ref of inputs.referenceInputs) {
      const a = d.assets[ref.assetId];
      if (!a || a.projectId !== pid || !a.url || a.missing)
        add(
          "blocker",
          "References",
          "An additional reference is missing. Reattach or remove it.",
          "Review references",
        );
      else if (
        (ref.purpose === "audio" && a.kind !== "audio") ||
        (ref.purpose !== "audio" && a.kind === "audio") ||
        (ref.purpose === "setting" && a.kind !== "image")
      )
        add(
          "blocker",
          "References",
          `${a.title} cannot be used as ${referencePurposes[ref.purpose].toLowerCase()}. Choose a matching reference purpose.`,
          "Review references",
        );
    }
  }
  for (const s of shots) {
    if (
      s.sceneId !== sid ||
      !Number.isInteger(s.targetFrames) ||
      s.targetFrames < 30 ||
      s.targetFrames > 900 ||
      s.outFrame <= s.inFrame
    )
      add(
        "blocker",
        "Shot plan",
        `${s.title} must have a valid 1–30 second target and edit range.`,
      );
    if (
      s.requestedOperation &&
      !["image", "video"].includes(s.requestedOperation)
    )
      add(
        "blocker",
        "Shot plan",
        `${s.title} requests an unsupported generation operation.`,
      );
    const seen = new Set([s.id]);
    let dep = s.dependsOn;
    while (dep) {
      if (seen.has(dep)) {
        add(
          "blocker",
          "Shot plan",
          `${s.title} has a circular continuation dependency.`,
        );
        break;
      }
      seen.add(dep);
      if (!d.shots[dep] || d.shots[dep].sceneId !== sid) {
        add(
          "blocker",
          "Shot plan",
          `${s.title} depends on a missing shot or a shot outside this scene.`,
        );
        break;
      }
      if (sc.shotIds.indexOf(dep) >= sc.shotIds.indexOf(s.id)) {
        add("blocker", "Shot plan", `${s.title} must follow its source shot.`);
        break;
      }
      dep = d.shots[dep].dependsOn;
    }
    const cast = effectiveCast(d, s.id);
    if (cast.length > 1)
      add(
        "warning",
        "Shot plan",
        `${s.title} contains multiple interacting characters and may need additional attempts.`,
      );
    for (const view of s.referenceRequirements ?? [])
      for (const a of cast)
        if (
          !characterReferences(d, a.characterId).some(
            (r) => r.type === view && referenceValid(d, r.id),
          )
        )
          add(
            "warning",
            "References",
            `${s.title}: ${view.replaceAll("_", " ")} is recommended for ${d.characters[a.characterId]?.name ?? "this character"}, but is not required.`,
            "Review references",
            `/projects/${pid}/characters/${a.characterId}?tab=references&returnTo=${encodeURIComponent(href)}`,
          );
  }
  const work = preflight(
    d,
    shots.map((s) => s.id),
  );
  const cost = work.reduce((n, w) => n + w.cost, 0);
  if (cost > d.credits)
    add(
      "blocker",
      "Budget",
      `The plan costs ${cost} demo credits; ${d.credits} are available.`,
      "Open settings",
      `/projects/${pid}/settings`,
    );
  if (Object.values(d.jobs).some((j) => j.sceneId === sid && active(j)))
    add(
      "warning",
      "Shot plan",
      "Active jobs are excluded from this plan to prevent duplicate charges.",
      "Open queue",
      `/projects/${pid}/queue`,
    );
  return {
    issues,
    work,
    cost,
    images: work.filter((w) => w.operation === "image").length,
    videos: work.filter((w) => w.operation === "video").length,
    dependencies: shots.filter((s) => s.dependsOn).length,
    reused: shots.filter((s) => s.currentTakeId && !s.stale).length,
    ready: !issues.some((i) => i.level === "blocker"),
  };
}
export function referenceSnapshot(d: Data, id: string): ReferenceSnapshot[] {
  return effectiveCast(d, id).map((a) => ({
    characterId: a.characterId,
    identityVersionId: d.characters[a.characterId]?.canonicalVersionId,
    lookVersionId: a.lookId
      ? d.studio.looks[a.lookId]?.primaryVersionId
      : undefined,
    referenceVersionIds: (a.referenceIds?.length
      ? a.referenceIds
      : characterReferences(d, a.characterId)
          .filter((r) => referenceValid(d, r.id))
          .map((r) => r.id)
    ).flatMap((id) =>
      d.studio.references[id]?.activeVersionId
        ? [d.studio.references[id].activeVersionId!]
        : [],
    ),
  }));
}
export function ensureSetup(d: Data, sid: string): SceneSetup {
  if (d.studio.setups[sid]) return d.studio.setups[sid];
  const sc = d.scenes[sid];
  if (!sc) throw Error("Scene not found.");
  return (d.studio.setups[sid] = {
    sceneId: sid,
    cast: [...new Set(sc.shotIds.flatMap((id) => d.shots[id].characters))].map(
      (characterId) => ({ characterId }),
    ),
    locationMode: "inferred",
    targetSeconds: shotsOfScene(d, sid).reduce(
      (n, s) => n + s.targetFrames / 30,
      0,
    ),
    revision: 1,
    direction: {
      time: "",
      lighting: "",
      mood: "",
      style: "",
      camera: "",
      notes: "",
    },
  });
}
export function updateShotPlan(
  d: Data,
  id: string,
  fields: {
    targetFrames?: number;
    dependsOn?: string;
    framing?: string;
    castOverride?: import("./types").CastAssignment[];
    referenceRequirements?: import("./types").ReferenceType[];
  },
) {
  const s = d.shots[id];
  if (!s) throw Error("Shot not found.");
  if (
    fields.targetFrames !== undefined &&
    (!Number.isInteger(fields.targetFrames) ||
      fields.targetFrames < 30 ||
      fields.targetFrames > 900)
  )
    throw Error("Shot target must be 1–30 seconds.");
  if (fields.dependsOn) {
    let dep: string | undefined = fields.dependsOn;
    const seen = new Set([s.id]);
    while (dep) {
      if (seen.has(dep) || !d.shots[dep] || d.shots[dep].sceneId !== s.sceneId)
        throw Error("Invalid or circular continuation dependency.");
      seen.add(dep);
      dep = d.shots[dep].dependsOn;
    }
    if (
      d.scenes[s.sceneId].shotIds.indexOf(fields.dependsOn) >=
      d.scenes[s.sceneId].shotIds.indexOf(id)
    )
      throw Error("Choose an earlier source shot.");
  }
  if (fields.castOverride) {
    const pid = d.episodes[d.scenes[s.sceneId].episodeId].projectId;
    const seen = new Set<string>();
    for (const a of fields.castOverride) {
      if (
        d.characters[a.characterId]?.projectId !== pid ||
        seen.has(a.characterId)
      )
        throw Error("Choose unique characters from this project.");
      seen.add(a.characterId);
      if (
        a.lookId &&
        d.studio.looks[a.lookId]?.episodeId &&
        d.studio.looks[a.lookId].episodeId !== d.scenes[s.sceneId].episodeId
      )
        throw Error("Choose a look from this episode.");
      if (a.lookId && d.studio.looks[a.lookId]?.characterId !== a.characterId)
        throw Error("Choose a Look owned by this character.");
    }
  }
  if (
    ["targetFrames", "dependsOn", "framing"].some(
      (k) =>
        k in fields &&
        fields[k as keyof typeof fields] !== s[k as keyof typeof s],
    )
  )
    d.scenes[s.sceneId].planRevision =
      (d.scenes[s.sceneId].planRevision ?? 1) + 1;
  Object.assign(s, fields);
  s.revision++;
  s.stale = !!s.currentTakeId || !!s.imageTakeId;
  const ep = d.episodes[d.scenes[s.sceneId].episodeId];
  ep.timelineVersion++;
  d.projects[ep.projectId].revision++;
}
