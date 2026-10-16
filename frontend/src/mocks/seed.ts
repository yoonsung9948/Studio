import { migrateWorkflow } from "../domain/workflow";
import { type Data } from "../domain/types";
import { enhanceStudio, emptyStudio } from "./studio-seed";
export function seed(): Data {
  const d: Data = {
    projects: {},
    episodes: {},
    scenes: {},
    shots: {},
    takes: {},
    assets: {},
    jobs: {},
    threads: {},
    proposals: {},
    exports: {},
    characters: {},
    credits: 1200,
    studio: emptyStudio(),
  };
  d.projects.midnight = {
    id: "midnight",
    title: "Midnight Secrets",
    description:
      "One apartment. Two strangers. A truth that won’t stay buried.",
    cover: "/media/arrival.svg",
    episodeIds: ["ep1", "ep2", "ep3"],
    bible:
      "PREMISE\nMaya returns to an apartment she thought she had left behind. A recording draws her into Leo’s secret.\n\nRELATIONSHIPS\nMaya Chen and Leo Hart were once allies. Neither knows who to trust.\n\nWORLD RULES\nGrounded contemporary suspense. Every revelation has a physical clue.\n\nESTABLISHED FACTS\nThe necklace belonged to Maya’s sister. The apartment door sticks when it rains.",
    defaultDuration: 60,
    revision: 1,
    updatedAt: Date.now(),
  };
  d.projects.shortforms = {
    id: "shortforms",
    title: "Small Hours",
    description:
      "Small stories. Unexpected turns. A collection of short-form experiments.",
    cover: "/media/message.svg",
    episodeIds: ["ep4"],
    bible: "Standalone ideas about the moments between things.",
    defaultDuration: 30,
    revision: 1,
    updatedAt: Date.now(),
  };
  const scenes = [
    "The Arrival",
    "The Message",
    "The Discovery",
    "The Confrontation",
  ];
  const descriptions = [
    "Maya enters the apartment. Something feels different.",
    "An unexpected recording changes her plans.",
    "Behind a loose panel, she finds the hidden necklace.",
    "Leo returns before she can leave.",
  ];
  const covers = ["arrival", "message", "discovery", "confrontation"];
  for (const [ei, id] of ["ep1", "ep2", "ep3", "ep4"].entries()) {
    const pid = ei === 3 ? "shortforms" : "midnight";
    const count = ei === 0 ? 4 : ei === 1 ? 2 : 1;
    d.episodes[id] = {
      id,
      projectId: pid,
      title: [
        "The Unlocked Door",
        "Before the Rain",
        "Someone Was Here",
        "The Last Train",
      ][ei],
      synopsis: [
        "A familiar apartment. An unfamiliar secret. Maya follows the clues.",
        "The quiet moments before everything changed.",
        "A voice on the other side of the wall.",
        "One missed train leads to an unexpected encounter.",
      ][ei],
      targetSeconds: ei === 0 ? 60 : 30,
      sceneIds: [],
      script:
        "INT. APARTMENT — NIGHT\n\nMaya pushes open the door. The room is still.\n\nMAYA\nYou said no one would be here.\n\nA recorder clicks on. Somewhere, a key turns in a lock.",
      revision: 1,
      timelineVersion: 1,
    };
    for (let si = 0; si < count; si++) {
      const sid = `${id}-s${si + 1}`;
      d.episodes[id].sceneIds.push(sid);
      d.scenes[sid] = {
        id: sid,
        episodeId: id,
        title: scenes[si],
        description: descriptions[si],
        shotIds: [],
        cover: `/media/${covers[si]}.svg`,
      };
      for (let qi = 0; qi < 3; qi++) {
        const qid = `${sid}-q${qi + 1}`;
        d.scenes[sid].shotIds.push(qid);
        d.shots[qid] = {
          id: qid,
          sceneId: sid,
          title: ["Establishing", "The detail", "The reaction"][qi],
          action: [
            `Wide shot. ${descriptions[si]}`,
            "Close-up of the clue. Hold the frame.",
            "Maya pauses. Let the silence tell the story.",
          ][qi],
          dialogue: qi === 2 ? "“Something is wrong.”" : "",
          characters: ["maya", ...(si === 3 ? ["leo"] : [])],
          targetFrames: 150,
          inFrame: 0,
          outFrame: 150,
          revision: 1,
          stale: false,
          ...(si === 3 && qi === 1 ? { dependsOn: `${sid}-q1` } : {}),
        };
        const aid = `asset-${qid}`;
        d.assets[aid] = {
          id: aid,
          projectId: pid,
          title: `${scenes[si]} · ${qi + 1}`,
          kind: "image",
          url: `/media/${covers[si]}.svg`,
          provenance:
            "Original dotori studio vector storyboard placeholder. Not generated footage.",
        };
        if (ei === 0 || ei === 1) {
          const tid = `image-${qid}`;
          d.takes[tid] = {
            id: tid,
            shotId: qid,
            kind: "image",
            revision: 1,
            approved: si !== 2,
            sourceFrames: 240,
            assetId: aid,
            createdAt: 0,
          };
          d.shots[qid].imageTakeId = tid;
        }
        if ((ei === 0 && si === 0) || ei === 1) {
          const tid = `take-${qid}`;
          d.takes[tid] = {
            id: tid,
            shotId: qid,
            kind: "video",
            revision: 1,
            approved: true,
            sourceFrames: 240,
            assetId: aid,
            createdAt: 0,
          };
          d.shots[qid].currentTakeId = tid;
        }
      }
    }
  }
  const failShot = "ep1-s4-q1";
  d.jobs["seed-failure"] = {
    id: "seed-failure",
    projectId: "midnight",
    episodeId: "ep1",
    sceneId: "ep1-s4",
    shotId: failShot,
    operation: "video",
    state: "failed",
    attempt: 1,
    cost: 24,
    progress: 40,
    revision: 1,
    replacement: false,
    error: "Demo interruption: the fixture service timed out. Retry is safe.",
  };
  d.characters.maya = {
    id: "maya",
    projectId: "midnight",
    name: "Maya Chen",
    description: "Observant, guarded, and more resourceful than she lets on.",
    reference: "/media/maya.svg",
    approved: true,
  };
  d.characters.leo = {
    id: "leo",
    projectId: "midnight",
    name: "Leo Hart",
    description: "A familiar face with a carefully rehearsed explanation.",
    reference: "/media/leo.svg",
    approved: true,
  };
  d.proposals.previous = {
    id: "previous",
    scope: {
      projectId: "midnight",
      episodeId: "ep1",
      sceneId: "ep1-s1",
      revision: 1,
      fps: 30,
    },
    shotIds: ["ep1-s1-q1"],
    intent: "suspense",
    before: "Maya enters.",
    after: "Hold on the empty doorway before revealing Maya.",
    state: "applied",
    cost: 0,
  };
  d.threads.ep1 = {
    id: "ep1",
    messages: [
      {
        id: "welcome",
        role: "assistant",
        text: "The apartment is quiet. Maybe a little too quiet.\n\nYour opening scene is approved. The Message is ready for video, and The Discovery needs an image review. Where would you like to take the story?",
      },
      {
        id: "previous-message",
        role: "assistant",
        text: "Previous plan: hold on the doorway to build tension.",
        proposalId: "previous",
      },
    ],
  };
  d.takes["earlier-take"] = {
    ...d.takes["take-ep1-s1-q1"],
    id: "earlier-take",
    createdAt: -1,
  };
  d.exports.old = {
    id: "old",
    episodeId: "ep1",
    timelineVersion: 0,
    title: "The Unlocked Door — first pass",
    preset: "Instagram Reels",
    captions: true,
    description: "Early storyboard",
    draft: true,
    createdAt: 0,
    manifest: JSON.stringify({
      demo: true,
      rendered: false,
      episodeId: "ep1",
      timelineVersion: 0,
    }),
  };
  enhanceStudio(d, true);
  migrateWorkflow(d);
  return d;
}
