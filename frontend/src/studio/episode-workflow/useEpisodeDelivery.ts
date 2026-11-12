import { useStore } from "../../stores/store";
import { useActions } from "../../components/Actions";
import {
  activeEpisodeShots,
  approveEpisodeCut,
  cutSignature,
} from "../../domain/episode-review";
import { readyMedia } from "../episode-board/scene-presentation";
import { commit } from "../generation";

/** Both review export controls approve and export the same validated cut. */
export function useEpisodeDelivery(episodeId: string) {
  const data = useStore((state) => state.data);
  const modal = useActions();
  const episode = data.episodes[episodeId];
  const shots = activeEpisodeShots(data, episodeId);
  const open = (episode.cutReview?.notes ?? []).filter(
    (note) => !note.resolved,
  ).length;
  const remaining = shots.filter(
    (shot) => !readyMedia(data, shot, "video"),
  ).length;
  const canExport = shots.length > 0 && !remaining && !open;
  const approved =
    episode.cutReview?.approvedSignature === cutSignature(data, episodeId);
  return {
    open,
    remaining,
    canExport,
    approved,
    exportEpisode() {
      if (
        canExport &&
        commit(
          (next) => approveEpisodeCut(next, episodeId),
          "Episode cut approved",
        )
      )
        modal({ kind: "export", episodeId });
    },
  };
}
