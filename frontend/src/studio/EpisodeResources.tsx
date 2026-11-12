import { useParams } from "react-router-dom";
import { useStore } from "../stores/store";
import { LibraryWorkspace } from "./Library";
import { EpisodeReferencesWorkspace } from "./references/EpisodeReferences";

/** Episode routes fail closed rather than falling back to the entire project library. */
export function EpisodeResources({
  section,
}: {
  section: "references" | "media";
}) {
  const { projectId = "", episodeId = "" } = useParams();
  const data = useStore((state) => state.data);
  const project = data.projects[projectId],
    episode = data.episodes[episodeId];
  if (
    !project ||
    project.archived ||
    project.unfiled ||
    !episode ||
    episode.archived ||
    episode.projectId !== projectId ||
    !project.episodeIds.includes(episodeId)
  )
    return <div className="st-empty">Episode unavailable.</div>;
  if (section === "media") return <LibraryWorkspace />;
  return <EpisodeReferencesWorkspace key={episodeId} episodeId={episodeId} />;
}

export { AssetsWorkspace } from "./assets/AssetsWorkspace";
