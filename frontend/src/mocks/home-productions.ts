import type { Data } from "../domain/types";
import { createWorkspaceEpisode } from "../domain/workspace";

/** Additional editable productions for the isolated development workspace only. */
export function installHomeProductions(data: Data) {
  const now = Date.now();
  const letter = data.projects["last-letter"];
  if (letter && letter.episodeIds.length === 1) {
    const opening = createWorkspaceEpisode(
      data,
      letter.id,
      "The unopened letter",
      15,
    );
    const returnEpisode = createWorkspaceEpisode(
      data,
      letter.id,
      "Back to the cafe",
      15,
    );
    letter.episodeIds = [
      opening,
      returnEpisode,
      ...letter.episodeIds.filter(
        (id) => id !== opening && id !== returnEpisode,
      ),
    ];
  }
  for (const [id, title, cover, idea, age] of [
    [
      "night-shift",
      "Night Shift",
      "/media/director-desk/night-shift.png",
      "INT. DINER — NIGHT\nA waitress is closing up when an unexpected visitor arrives. Neon light flickers across the rain-streaked windows.",
      10800000,
    ],
    [
      "paper-planets",
      "Paper Planets",
      "/media/director-desk/paper-planets.png",
      "EXT. PAPER VILLAGE — NIGHT\nA small traveler in a yellow coat crosses a bridge, following the moon toward a village made of folded paper.",
      18000000,
    ],
  ] as const) {
    const episodeTitle =
      id === "night-shift" ? "The late arrival" : "Following the moon";
    if (data.projects[id]) {
      // Upgrade only the original automatic sample title; keep user renames.
      for (const episodeId of data.projects[id].episodeIds) {
        if (data.episodes[episodeId]?.title === "INT")
          data.episodes[episodeId].title = episodeTitle;
      }
      continue;
    }
    data.projects[id] = {
      id,
      title,
      cover,
      description: idea,
      episodeIds: [],
      bible: "",
      defaultDuration: 30,
      revision: 1,
      updatedAt: now - age,
    };
    const episodeId = createWorkspaceEpisode(data, id, idea, 30);
    data.episodes[episodeId].title = episodeTitle;
    for (const scene of Object.values(data.scenes)) {
      if (data.episodes[scene.episodeId].projectId === id) scene.cover = cover;
    }
  }
}
