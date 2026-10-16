import { useLocation } from "react-router-dom";
import { Director } from "./Director";
export function RightPanel({
  projectId,
  episodeId,
  sceneId,
}: {
  projectId: string;
  episodeId?: string;
  sceneId?: string;
}) {
  const location = useLocation(),
    params = new URLSearchParams(location.search),
    parts = location.pathname.split("/");
  return (
    <Director
      projectId={projectId}
      episodeId={episodeId}
      sceneId={sceneId}
      characterId={parts[3] === "characters" ? parts[4] : undefined}
      lookId={params.get("look") ?? undefined}
      characterTab={
        (params.get("tab") ?? "identity") as "identity" | "looks" | "references"
      }
      setup={!!sceneId && !location.pathname.endsWith("/edit")}
    />
  );
}
