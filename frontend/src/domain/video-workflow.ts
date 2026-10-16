import type { Data } from "./types";
import {
  approveScript,
  approveEpisodePlans,
  planScenes,
  scriptApproved,
} from "./workflow";
import { ensureSetup } from "./scene-preflight";
import { generationInputs } from "./generation-inputs";

/** Prepare an automatic breakdown without charging or submitting generation. */
export function prepareVideoGeneration(
  d: Data,
  episodeId: string,
  sceneId?: string,
  fromScript = false,
) {
  const ep = d.episodes[episodeId];
  if (!ep?.script.trim())
    throw Error("Write a script before generating video.");
  if (sceneId && d.scenes[sceneId]?.episodeId !== episodeId)
    throw Error("Choose a scene from this episode.");
  if (!ep.sceneIds.length) {
    approveScript(d, episodeId);
    planScenes(
      d,
      episodeId,
      Math.max(1, Math.min(3, Math.floor(ep.targetSeconds / 3))),
    );
    approveEpisodePlans(d, episodeId);
  }
  if (fromScript && !sceneId) {
    if (
      !scriptApproved(ep) ||
      ep.sceneIds.some(
        (id) => d.scenes[id].sourceScriptRevision !== (ep.scriptRevision ?? 1),
      )
    ) {
      approveScript(d, episodeId);
      planScenes(d, episodeId, ep.sceneIds.length);
    }
    approveEpisodePlans(d, episodeId);
  }
  for (const sid of sceneId ? [sceneId] : ep.sceneIds) {
    const setup = ensureSetup(d, sid);
    setup.generation = { ...generationInputs(d, sid), videoMode: "direct" };
    for (const id of d.scenes[sid].shotIds) {
      const shot = d.shots[id];
      if (shot.generationOverride) shot.generationOverride.videoMode = "direct";
    }
  }
}
