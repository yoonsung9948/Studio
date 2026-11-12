import { Link } from "react-router-dom";
import { Link2 } from "lucide-react";
import type { Data } from "../../domain/types";
import type { AssetSubject } from "../../domain/asset-library";
import { assetUsage } from "../../domain/asset-usage";
import { useAssetPath } from "./asset-navigation";
export function AssetUsage({
  data,
  subject,
  episodeId,
}: {
  data: Data;
  subject: AssetSubject;
  episodeId?: string;
}) {
  const path = useAssetPath();
  const usage = assetUsage(data, subject, episodeId);
  return (
    <details className="av-usage ac-panel" open id="asset-usage">
      <summary>
        <Link2 size={19} /> Used in{" "}
        <span>
          {usage.reduce((count, entry) => count + 1 + entry.scenes.length, 0)}
        </span>
      </summary>
      {!usage.length && (
        <p className="ac-muted">
          No episode references yet. Add this asset from an episode’s References
          page when you need it.
        </p>
      )}
      {usage.map(({ episode, project, scenes, referencePath }) => (
        <div key={episode.id}>
          <Link className="av-usage-row" to={path(referencePath)}>
            {project.cover && <img src={project.cover} alt="" />}
            <span>
              <small>References</small>
              <strong>
                {project.title} · Episode{" "}
                {String(project.episodeIds.indexOf(episode.id) + 1).padStart(
                  2,
                  "0",
                )}{" "}
                · {episode.title}
              </strong>
            </span>
            <em>Open references ↗</em>
          </Link>
          {scenes.map(({ scene, path: scenePath }) => (
            <Link key={scene.id} className="av-usage-row" to={path(scenePath)}>
              {scene.cover && <img src={scene.cover} alt="" />}
              <span>
                <small>
                  Scene{" "}
                  {String(episode.sceneIds.indexOf(scene.id) + 1).padStart(
                    2,
                    "0",
                  )}
                </small>
                <strong>{scene.title}</strong>
              </span>
              <em>Open scene ↗</em>
            </Link>
          ))}
        </div>
      ))}
    </details>
  );
}
