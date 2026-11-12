import { useParams, useSearchParams } from "react-router-dom";
import { useStore } from "../../stores/store";
import { episodeAssetSubjects } from "../../domain/asset-usage";
import { AssetDetail } from "../assets/AssetDetail";
import { episodeReferencesPath } from "./paths";

export function ReferenceViewsWorkspace() {
  const {
      projectId = "",
      episodeId = "",
      category = "",
      assetId = "",
    } = useParams(),
    [params, setParams] = useSearchParams();
  const data = useStore((s) => s.data);
  let subject;
  try {
    if (
      data.episodes[episodeId]?.projectId === projectId &&
      ["characters", "places", "props"].includes(category)
    )
      subject = episodeAssetSubjects(data, episodeId, category).find(
        (item) => item.id === assetId,
      );
  } catch {
    /* Scoped links fail closed. */
  }
  if (!subject) return <div className="st-empty">Reference unavailable.</div>;
  const update = (values: Record<string, string>) => {
    const next = new URLSearchParams(params);
    Object.entries(values).forEach(([key, value]) => next.set(key, value));
    setParams(next);
  };
  return (
    <AssetDetail
      subject={subject}
      episodeId={episodeId}
      tab={params.get("tab") === "details" ? "details" : "views"}
      type={params.get("view") ?? "front"}
      onTab={(tab) => update({ tab })}
      onView={(view) => update({ view })}
      back={`${episodeReferencesPath(projectId, episodeId)}?kind=${category}`}
      backLabel="Back to References"
    />
  );
}
