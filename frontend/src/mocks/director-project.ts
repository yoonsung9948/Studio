import type { Data } from "../domain/types";
import { approveScript, approveScenePlan } from "../domain/workflow";
import { ensureSetup } from "../domain/scene-preflight";
import { demoMedia } from "./demo-media";

/** Keep older saved copies of the sample compatible with reference validation. */
function ensureSampleReferences(data: Data) {
  for (const id of ["letter-maya", "letter-jun"]) {
    const character = data.characters[id];
    const version = character?.canonicalVersionId
      ? data.studio.versions[character.canonicalVersionId]
      : undefined;
    if (!version || version.ownerKind !== "identity" || version.ownerId !== id)
      continue;
    const referenceId = `${id}-front`;
    if (data.studio.references[referenceId]) continue;
    version.sourceIdentityVersionId = version.id;
    data.studio.references[referenceId] = {
      id: referenceId,
      characterId: id,
      type: "front",
      activeVersionId: version.id,
    };
  }
}

/** A self-contained sample production, installed only in the isolated development workspace. */
export function installDirectorProject(data: Data) {
  const projectId = "last-letter";
  if (data.projects[projectId]) {
    data.projects[projectId].format ??= "Short-form drama";
    ensureSampleReferences(data);
    return;
  }
  const episodeId = "last-letter-ep3";
  data.projects[projectId] = {
    id: projectId,
    title: "The Last Letter",
    format: "Short-form drama",
    description: "Two old friends. One letter they could never throw away.",
    cover: demoMedia.reunion,
    episodeIds: [episodeId],
    bible:
      "Grounded, intimate drama. Maya wears a burgundy coat. Jun wears a navy jacket. The letter stays sealed until the handoff.",
    defaultDuration: 30,
    revision: 1,
    updatedAt: Date.now(),
  };
  data.episodes[episodeId] = {
    id: episodeId,
    projectId,
    title: "The reunion",
    synopsis: "Maya and Jun meet again at their old cafe.",
    targetSeconds: 30,
    sceneIds: [],
    script:
      "INT. CAFE — DUSK\n\nMaya and Jun sit opposite each other. Rain streaks the window.\n\nMAYA\nYou kept it?\n\nJUN\nI couldn't throw it away.\n\nMaya slides the sealed letter across the table.",
    revision: 1,
    timelineVersion: 1,
  };
  for (const [id, name, reference] of [
    ["letter-maya", "Maya", demoMedia.maya],
    ["letter-jun", "Jun", demoMedia.jun],
  ]) {
    const assetId = `${id}-identity`;
    const versionId = `${id}-v1`;
    data.characters[id] = {
      id,
      projectId,
      name,
      description:
        name === "Maya"
          ? "Quiet, observant. Burgundy wool coat, chin-length black hair."
          : "Thoughtful, guarded. Navy jacket, dark hair.",
      reference,
      approved: true,
      revision: 1,
      canonicalVersionId: versionId,
      role: "Lead",
    };
    data.assets[assetId] = {
      id: assetId,
      projectId,
      title: `${name} / approved identity`,
      kind: "image",
      url: reference,
      provenance: "Bundled AI-created demo character reference.",
    };
    data.studio.versions[versionId] = {
      id: versionId,
      projectId,
      ownerKind: "identity",
      ownerId: id,
      assetId,
      approval: "approved",
      revision: 1,
      specification: data.characters[id].description,
      createdAt: 0,
    };
  }
  data.assets["letter-cafe"] = {
    id: "letter-cafe",
    projectId,
    title: "Cafe at dusk",
    kind: "image",
    url: demoMedia.cafe,
    provenance: "Bundled AI-created demo location reference.",
  };
  data.studio.locations["letter-cafe"] = {
    id: "letter-cafe",
    projectId,
    name: "Cafe at dusk",
    description: "Warm practical light, rain on blue windows, a wooden table.",
    assetId: "letter-cafe",
    referenceAssetIds: [],
    revision: 1,
  };
  data.assets["letter-prop"] = {
    id: "letter-prop",
    projectId,
    title: "Sealed letter",
    kind: "image",
    url: demoMedia.letter,
    provenance: "Bundled AI-created prop reference.",
  };
  data.projects[projectId].worldElements = [
    {
      id: "letter-sealed-prop",
      kind: "prop",
      name: "Sealed letter",
      description: "Keep the letter sealed throughout this scene.",
      assetId: "letter-prop",
    },
  ];
  const scenes = [
    {
      id: "letter-arrival",
      title: "The arrival",
      image: demoMedia.cafe,
      description: "Maya arrives at the familiar cafe in the rain.",
      shots: [
        ["Establishing", "A wide view of the cafe at dusk.", demoMedia.cafe],
        [
          "At the window",
          "Maya looks through the rain-streaked glass.",
          demoMedia.maya,
        ],
      ],
    },
    {
      id: "letter-reunion",
      title: "The reunion",
      image: demoMedia.reunion,
      description:
        "Maya and Jun sit across from each other. A sealed letter rests between them.",
      shots: [
        [
          "Maya close-up",
          "Maya holds Jun's gaze, then slides the letter across the table.",
          demoMedia.reunion,
        ],
        [
          "Jun reaction",
          "Jun looks down at the letter, then back at Maya.",
          demoMedia.jun,
        ],
        [
          "Letter insert",
          "Hold on the sealed letter beside Maya's hand.",
          demoMedia.letter,
        ],
      ],
    },
    {
      id: "letter-departure",
      title: "The departure",
      image: demoMedia.cafe,
      description: "The conversation is over, but neither is ready to leave.",
      shots: [
        [
          "One last look",
          "Hold on Maya before cutting to the rain outside.",
          demoMedia.maya,
        ],
      ],
    },
  ];
  for (const scene of scenes) {
    data.episodes[episodeId].sceneIds.push(scene.id);
    data.scenes[scene.id] = {
      id: scene.id,
      episodeId,
      title: scene.title,
      description: scene.description,
      shotIds: [],
      cover: scene.image,
      planRevision: 1,
      ...(scene.id === "letter-reunion"
        ? {
            screenplay: data.episodes[episodeId].script,
            settingDescription: "INT. CAFE — DUSK",
          }
        : {}),
    };
    for (const [index, [title, action, image]] of scene.shots.entries()) {
      const id = `${scene.id}-q${index + 1}`;
      const assetId = `${id}-frame`;
      const takeId = `${id}-take`;
      data.scenes[scene.id].shotIds.push(id);
      data.shots[id] = {
        id,
        sceneId: scene.id,
        title,
        action,
        dialogue:
          scene.id === "letter-reunion" && index === 1
            ? "I couldn't throw it away."
            : "",
        characters: ["letter-maya", "letter-jun"],
        worldElementIds: ["letter-sealed-prop"],
        framing:
          index === 0 && scene.id === "letter-arrival" ? "Wide" : "Close-up",
        targetFrames: 150,
        inFrame: 0,
        outFrame: 150,
        revision: 1,
        stale: false,
        imageTakeId: takeId,
      };
      data.assets[assetId] = {
        id: assetId,
        projectId,
        title,
        kind: "image",
        url: image,
        provenance:
          "Bundled AI-created demo frame. Live generation is simulated.",
      };
      data.takes[takeId] = {
        id: takeId,
        shotId: id,
        kind: "image",
        revision: 1,
        approved: true,
        sourceFrames: 240,
        assetId,
        createdAt: 0,
      };
    }
    const setup = ensureSetup(data, scene.id);
    setup.cast = [
      { characterId: "letter-maya" },
      { characterId: "letter-jun" },
    ];
    setup.direction.notes = "Keep the letter sealed.";
    setup.worldElementIds = ["letter-sealed-prop"];
    setup.direction.style = "Naturalistic";
    setup.locationId = "letter-cafe";
    setup.locationMode = "selected";
    setup.generation = {
      instructions: scene.description,
      referenceInputs: [],
      model: "demo",
      aspectRatio: "16:9",
    };
  }
  ensureSampleReferences(data);
  approveScript(data, episodeId);
  for (const scene of scenes) approveScenePlan(data, scene.id);
}
