export const produceStages = [
  { id: "plan", label: "Scene plan" },
  { id: "shots", label: "Shots" },
  { id: "takes", label: "Takes" },
  { id: "final", label: "Final video" },
] as const;
export type ProduceStage = (typeof produceStages)[number]["id"];

/** Translate old links at the boundary; the workspace itself has only four stages. */
export function produceStage(
  params: URLSearchParams,
  shotRoute = false,
): ProduceStage {
  const stage = params.get("stage");
  if (produceStages.some((item) => item.id === stage))
    return stage as ProduceStage;
  if (stage === "scene") return "plan";
  if (stage === "frame") return "shots";
  if (stage === "motion" || (stage === "review" && shotRoute)) return "takes";
  const view = params.get("view") ?? params.get("tab");
  if (view === "timeline" || view === "edit" || view === "review")
    return "final";
  if (view === "board") return "shots";
  return shotRoute ? "shots" : "plan";
}

export function produceUrl(
  projectId: string,
  episodeId: string,
  stage: ProduceStage,
  sceneId?: string,
  shotId?: string,
) {
  const params = new URLSearchParams({ stage });
  if (sceneId) params.set("scene", sceneId);
  if (shotId) params.set("shot", shotId);
  return `/projects/${projectId}/episodes/${episodeId}?${params}`;
}
