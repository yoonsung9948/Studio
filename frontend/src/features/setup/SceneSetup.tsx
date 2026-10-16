import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useStore } from "../../stores/store";
import { useActions } from "../../components/Actions";
import { NotFound } from "../Gallery";
/** Preserve existing setup deep links by opening the scene generation brief. */
export function SceneSetupWorkspace() {
  const { projectId = "", episodeId = "", sceneId = "" } = useParams();
  const sc = useStore((s) => s.data.scenes[sceneId]);
  const ep = useStore((s) => s.data.episodes[episodeId]);
  const open = useActions(),
    navigate = useNavigate();
  const valid =
    !!sc && sc.episodeId === episodeId && ep?.projectId === projectId;
  useEffect(() => {
    if (valid) {
      navigate(
        `/projects/${projectId}/episodes/${episodeId}/scenes/${sceneId}`,
        { replace: true },
      );
      open({ kind: "generate", ids: sc.shotIds });
    }
  }, [sceneId, valid]);
  return valid ? (
    <p className="empty" role="status">
      Opening scene inputs…
    </p>
  ) : (
    <NotFound />
  );
}
