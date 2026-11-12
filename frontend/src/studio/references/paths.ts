import type { Data, GenerationJob } from "../../domain/types";
export const episodeReferencesPath = (projectId: string, episodeId: string) =>
  `/projects/${projectId}/episodes/${episodeId}/references`;
export const episodeLookPath = (
  projectId: string,
  episodeId: string,
  characterId: string,
  lookId: string,
) =>
  `${episodeReferencesPath(projectId, episodeId)}/characters/${characterId}/looks/${lookId}`;

/** Keep generated look results in their owning episode instead of the legacy project studio. */
export function episodeLookJobDestination(data: Data, job: GenerationJob) {
  const ref =
    job.target?.kind === "reference"
      ? data.studio.references[job.target.id]
      : undefined;
  const look =
    data.studio.looks[
      job.target?.kind === "look" ? job.target.id : (ref?.lookId ?? "")
    ];
  if (
    !look?.episodeId ||
    data.episodes[look.episodeId]?.projectId !== job.projectId
  )
    return undefined;
  const type =
    ref && ["profile", "full_body", "back"].includes(ref.type)
      ? ref.type
      : "front";
  return {
    title: `${data.characters[look.characterId]?.name ?? "Character"} / ${look.name}`,
    path: `${episodeLookPath(job.projectId, look.episodeId, look.characterId, look.id)}?tab=views&view=${type}`,
  };
}
