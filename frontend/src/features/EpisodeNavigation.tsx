import { Link } from "react-router-dom";
import { useStore } from "../stores/store";
import { shotsOfEpisode } from "../domain/selectors";
export function EpisodeNavigation({
  projectId,
  episodeId,
  active,
}: {
  projectId: string;
  episodeId: string;
  active: "script" | "scenes" | "edit";
}) {
  const data = useStore((s) => s.data);
  const hasPlans = !!data.episodes[episodeId]?.sceneIds.length;
  const hasFootage = shotsOfEpisode(data, episodeId).some((shot) => {
    const take = shot.currentTakeId
      ? data.takes[shot.currentTakeId]
      : undefined;
    return take?.kind === "video" && take.approved;
  });
  return (
    <nav className="episode-workflow-nav" aria-label="Episode workflow">
      {(["script", "scenes", "edit"] as const).map((tab, i) =>
        (tab === "scenes" && !hasPlans) || (tab === "edit" && !hasFootage) ? (
          <button
            key={tab}
            disabled
            title={
              tab === "scenes"
                ? "Create scene plans first"
                : "Approve a generated video for Edit first"
            }
          >
            <span>{String(i + 1).padStart(2, "0")}</span>
            {tab[0].toUpperCase() + tab.slice(1)}
          </button>
        ) : (
          <Link
            key={tab}
            to={`/projects/${projectId}/episodes/${episodeId}?tab=${tab}`}
            aria-current={tab === active ? "page" : undefined}
          >
            <span>{String(i + 1).padStart(2, "0")}</span>
            {tab[0].toUpperCase() + tab.slice(1)}
          </Link>
        ),
      )}
    </nav>
  );
}
