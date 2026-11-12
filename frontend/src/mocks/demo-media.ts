import type { Data } from "../domain/types";

export const demoMedia = {
  reunion: "/media/director-desk/reunion.png",
  cafe: "/media/director-desk/cafe.png",
  maya: "/media/director-desk/maya.png",
  jun: "/media/director-desk/jun.png",
  letter: "/media/director-desk/letter.png",
} as const;

const replacements: Record<string, string> = {
  "/media/arrival.svg": demoMedia.cafe,
  "/media/message.svg": demoMedia.letter,
  "/media/discovery.svg": demoMedia.letter,
  "/media/confrontation.svg": demoMedia.reunion,
  "/media/maya.svg": demoMedia.maya,
  "/media/leo.svg": demoMedia.jun,
};

/** Upgrade only bundled demo artwork. Uploaded and account-owned URLs stay untouched. */
export function upgradeDemoMedia(data: Data) {
  for (const project of Object.values(data.projects)) {
    project.cover = replacements[project.cover] ?? project.cover;
  }
  for (const scene of Object.values(data.scenes)) {
    scene.cover = replacements[scene.cover] ?? scene.cover;
  }
  for (const character of Object.values(data.characters)) {
    character.reference =
      replacements[character.reference] ?? character.reference;
  }
  for (const asset of Object.values(data.assets)) {
    const next = replacements[asset.url];
    if (next) {
      asset.url = next;
      asset.provenance =
        "Bundled AI-created dotori studio demo photograph; illustrative production reference.";
    }
    if (asset.url === "/media/studio-look-default.svg") {
      asset.url = asset.id.includes("leo") ? demoMedia.jun : demoMedia.maya;
      asset.provenance =
        "Bundled AI-created demo identity reference; not a generated wardrobe variation.";
    }
  }
  // Give the continuing production its cinematic two-person cover.
  if (data.projects.midnight?.cover === demoMedia.cafe)
    data.projects.midnight.cover = demoMedia.reunion;
}
