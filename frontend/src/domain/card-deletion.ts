import type { Data } from "./types";
import { deleteCharacter, deleteLook } from "./studio-commands";

/** Reversible editorial deletion. Keep records/media needed by history and Undo. */
export function deleteCardSelection(d: Data, selection: string[]) {
  const keys = [...new Set(selection)];
  if (keys.some((key) => key.startsWith("note:bible-")))
    throw Error(
      "Project notes are built in. Clear their text from the note sheet instead.",
    );
  const affectedShots = new Set<string>();
  let count = 0;
  for (const key of keys) {
    const split = key.indexOf(":"),
      kind = key.slice(0, split),
      id = key.slice(split + 1);
    if (kind === "project" && d.projects[id] && !d.projects[id].archived) {
      d.projects[id].archived = true;
      for (const shot of Object.values(d.shots))
        if (d.episodes[d.scenes[shot.sceneId].episodeId].projectId === id)
          affectedShots.add(shot.id);
    } else if (
      kind === "episode" &&
      d.episodes[id] &&
      !d.episodes[id].archived
    ) {
      d.episodes[id].archived = true;
      for (const shot of Object.values(d.shots))
        if (d.scenes[shot.sceneId].episodeId === id) affectedShots.add(shot.id);
    } else if (kind === "scene" && d.scenes[id] && !d.scenes[id].archived) {
      const scene = d.scenes[id];
      scene.archived = true;
      const episode = d.episodes[scene.episodeId];
      episode.sceneIds = episode.sceneIds.filter((sid) => sid !== id);
      episode.timelineVersion++;
      for (const shot of Object.values(d.shots))
        if (shot.sceneId === id) affectedShots.add(shot.id);
      if (episode.cut) {
        episode.cut.clips = episode.cut.clips.filter(
          (clip) => d.shots[clip.shotId]?.sceneId !== id,
        );
        episode.cut.revision++;
      }
    } else if (kind === "shot" && d.shots[id] && !d.shots[id].archived) {
      const shot = d.shots[id],
        scene = d.scenes[shot.sceneId];
      if (shot.locked) throw Error("Unlock the shot before deleting it.");
      shot.archived = true;
      scene.shotIds = scene.shotIds.filter((sid) => sid !== id);
      const episode = d.episodes[scene.episodeId];
      episode.timelineVersion++;
      scene.planRevision = (scene.planRevision ?? 1) + 1;
      const setup = d.studio.setups[scene.id];
      if (setup)
        setup.targetSeconds = scene.shotIds
          .filter((shotId) => !d.shots[shotId]?.archived)
          .reduce((sum, shotId) => sum + d.shots[shotId].targetFrames / 30, 0);
      if (episode.cut) {
        episode.cut.clips = episode.cut.clips.filter(
          (clip) => clip.shotId !== id,
        );
        episode.cut.revision++;
      }
      for (const dependent of Object.values(d.shots))
        if (dependent.dependsOn === id) {
          dependent.dependsOn = undefined;
          dependent.revision++;
          dependent.stale =
            !!dependent.currentTakeId || !!dependent.imageTakeId;
          affectedShots.add(dependent.id);
        }
      affectedShots.add(id);
    } else if (kind === "character" && d.characters[id]) {
      deleteCharacter(d, id);
    } else if (kind === "look" && d.studio.looks[id]) {
      deleteLook(d, id);
    } else if (kind === "place" && d.studio.locations[id]) {
      for (const setup of Object.values(d.studio.setups))
        if (setup.locationId === id) {
          setup.locationId = undefined;
          setup.locationMode = "inferred";
          for (const shot of Object.values(d.shots))
            if (shot.sceneId === setup.sceneId) shot.stale = true;
        }
      for (const shot of Object.values(d.shots))
        if (shot.generationOverride?.locationId === id) {
          shot.generationOverride.locationId = undefined;
          shot.generationOverride.locationMode = "inferred";
          shot.stale = true;
        }
      for (const job of Object.values(d.jobs))
        if (
          job.target?.kind === "location" &&
          job.target.id === id &&
          ["queued", "waiting", "running"].includes(job.state)
        )
          job.state = "canceled";
      for (const episode of Object.values(d.episodes))
        episode.locationIds = episode.locationIds?.filter(
          (item) => item !== id,
        );
      delete d.studio.locations[id];
    } else if (kind === "prop" || kind === "note") {
      const project = Object.values(d.projects).find((p) =>
        p.worldElements?.some((item) => item.id === id && item.kind === kind),
      );
      if (!project) continue;
      for (const episode of Object.values(d.episodes))
        episode.propIds = episode.propIds?.filter((item) => item !== id);
      for (const job of Object.values(d.jobs))
        if (
          job.target?.kind === "prop" &&
          job.target.id === id &&
          ["queued", "waiting", "running"].includes(job.state)
        )
          job.state = "canceled";
      project.worldElements = project.worldElements?.filter(
        (item) => item.id !== id,
      );
      for (const shot of Object.values(d.shots))
        if (shot.worldElementIds?.includes(id)) {
          shot.worldElementIds = shot.worldElementIds.filter(
            (item) => item !== id,
          );
          shot.stale = true;
        }
    } else if (kind === "asset" && d.assets[id] && !d.assets[id].archived) {
      d.assets[id].archived = true;
    } else continue;
    count++;
  }
  for (const job of Object.values(d.jobs))
    if (
      (affectedShots.has(job.shotId) ||
        d.projects[job.projectId]?.archived ||
        d.episodes[job.episodeId]?.archived) &&
      ["queued", "waiting", "running"].includes(job.state)
    )
      job.state = "canceled";
  return count;
}
