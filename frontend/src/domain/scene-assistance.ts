import { sceneScreenplay, screenplayBeats } from "./scene-text";
export { sceneScreenplay } from "./scene-text";
import type { Data } from "./types";
import {
  addWorkspaceShot,
  changeShot,
  changeShotCamera,
  setShotDuration,
} from "./workspace";
import { updateScenePlan } from "./workflow";

export interface ShotSuggestion {
  title: string;
  action: string;
  framing: string;
  seconds: number;
}
export interface SceneSuggestion {
  sourceRevision: number;
  sceneId: string;
  original: string;
  revision: string;
  shots: ShotSuggestion[];
}

/** Local demo assistance only. Keep the user's script verbatim and append direction. */
export function proposeSceneAssistance(
  data: Data,
  sceneId: string,
  scope = "Action and atmosphere",
  variation = 0,
): SceneSuggestion {
  const scene = data.scenes[sceneId];
  const original = sceneScreenplay(data, sceneId);
  const directions: Record<string, string[]> = {
    "Action and atmosphere": [
      "Let the existing light and atmosphere carry the mood. Show the action clearly, hold a brief reaction, and preserve the scene's continuity.",
      "Keep attention on the scene's central action. Let the atmosphere settle before the gesture, then hold the existing characters' reaction without adding dialogue or story facts.",
      "Give the existing action room to register. Keep the blocking simple, maintain consistent eyelines, and let the established setting support the emotional beat.",
    ],
    "Pacing and performance": [
      "Allow a quiet beat before each response. Hold on the listener's reaction before cutting. Preserve all dialogue and story facts.",
      "Let each existing line finish before the response begins. Use a brief pause around the key action and keep the established performance restrained.",
    ],
    "Visual clarity": [
      "Establish the geography first. Keep the action readable in a clear focal plane, with consistent eyelines and screen direction.",
      "Make the existing action the visual priority. Preserve the scene's geography, cast positions, and prop continuity while keeping the gesture easy to follow.",
    ],
  };
  const options = directions[scope] ?? directions["Action and atmosphere"];
  const direction = options[Math.abs(variation) % options.length];
  return {
    sceneId,
    sourceRevision: scene.planRevision ?? 1,
    original,
    revision: `${original}\n\nVISUAL DIRECTION\n${direction}`,
    shots: (() => {
      const beats = screenplayBeats(original);
      if (!beats.length) return [];
      // Starter coverage is derived from current script beats, never stale summary/shot text.
      return Array.from(
        { length: Math.max(3, Math.min(8, beats.length)) },
        (_, index) => ({
          title: index === 0 ? "Establishing" : `Beat ${index + 1}`,
          action: `${index === 0 ? "Establish the action" : index === 1 ? "Focus on the action" : "Hold the action and its response"}: ${beats[Math.min(index, beats.length - 1)]}`,
          framing: index === 0 ? "Wide" : "Close-up",
          seconds: index === 1 ? 5 : 4,
        }),
      );
    })(),
  };
}

export function applySceneSuggestion(
  data: Data,
  proposal: SceneSuggestion,
  kind: "enhance" | "shots",
) {
  const scene = data.scenes[proposal.sceneId];
  if (!scene || (scene.planRevision ?? 1) !== proposal.sourceRevision)
    throw Error(
      "The scene changed while this proposal was open. Regenerate the proposal before applying it.",
    );
  if (scene.shotIds.some((id) => data.shots[id].locked) && kind === "enhance")
    throw Error(
      "Unlock the scene's shots before changing their source screenplay.",
    );
  if (kind === "enhance")
    updateScenePlan(data, scene.id, { screenplay: proposal.revision });
  else {
    // Add coverage without replacing locked shots, approved takes, dialogue, or user edits.
    for (const suggestion of proposal.shots) {
      const id = addWorkspaceShot(data, scene.id);
      changeShot(data, id, {
        title: suggestion.title,
        action: suggestion.action,
      });
      changeShotCamera(data, id, { framing: suggestion.framing });
      setShotDuration(data, id, suggestion.seconds);
    }
  }
}
