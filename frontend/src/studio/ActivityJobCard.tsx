import { studioJobPath, studioJobTitle } from "../domain/studio-selectors";
import { episodeLookJobDestination } from "./references/paths";
import {
  ArrowUpRight,
  Check,
  Clock3,
  Film,
  LoaderCircle,
  MoreHorizontal,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../components/ui/dropdown-menu";
import { useNavigate } from "react-router-dom";
import type { Data, GenerationJob } from "../domain/types";
import { active } from "../domain/selectors";
import { cancelJob } from "../domain/commands";
import { retryWorkspaceJob } from "../domain/workspace";
import { commit } from "./generation";
import { useStudio } from "./selection";

export type ActivityFilter = "all" | "generating" | "completed";
export function matchesActivityFilter(
  filter: ActivityFilter,
  active: boolean,
  complete: boolean,
) {
  return filter === "all" || (filter === "generating" ? active : complete);
}

export function ActivityJobCard({
  job,
  data,
}: {
  job: GenerationJob;
  data: Data;
}) {
  const navigate = useNavigate();
  const shot = data.shots[job.shotId];
  const source = data.takes[shot?.imageTakeId ?? shot?.currentTakeId ?? ""];
  const version = job.outputVersionIds
    ?.map((id) => data.studio.versions[id])
    .find(Boolean);
  const asset = data.assets[version?.assetId ?? source?.assetId ?? ""];
  const lookDestination = episodeLookJobDestination(data, job);
  const title =
    lookDestination?.title ??
    shot?.title ??
    (job.target?.kind === "location"
      ? data.studio.locations[job.target.id]?.name
      : job.target
        ? data.characters[job.target.id]?.name
        : undefined) ??
    studioJobTitle(data, job);
  const generating = active(job),
    complete = job.state === "succeeded";
  const progress =
    job.progress == null ? null : Math.max(0, Math.min(100, job.progress));
  const show = () => {
    if (lookDestination) navigate(lookDestination.path);
    else if (job.target) navigate(studioJobPath(data, job));
    else
      navigate(
        `/projects/${job.projectId}/episodes/${job.episodeId}/shots/${job.shotId}?stage=${job.operation === "image" ? "frame" : "review"}`,
      );
    useStudio.getState().set({ activity: false });
  };
  const label =
    job.state === "running"
      ? `Generating${progress == null ? "" : ` ${progress}%`}`
      : job.state === "queued"
        ? "Queued"
        : job.state === "waiting"
          ? "Waiting for source"
          : complete
            ? "Ready to review"
            : job.state === "failed"
              ? "Could not generate"
              : "Canceled";
  const StatusIcon =
    job.state === "running"
      ? LoaderCircle
      : complete
        ? Check
        : job.state === "failed" || job.state === "canceled"
          ? X
          : Clock3;
  return (
    <article
      className={`activity-job ${job.state}`}
      aria-label={`${title} job`}
    >
      <div className="activity-job-thumb">
        {asset?.url && !asset.missing && asset.kind === "image" ? (
          <img src={asset.url} alt="" />
        ) : (
          <Film size={26} />
        )}
      </div>
      <div className="activity-job-content">
        <div className="activity-job-heading">
          <h3>{title}</h3>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button aria-label={`Options for ${title} job`}>
                <MoreHorizontal size={20} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={show}>
                Open{" "}
                {lookDestination
                  ? "look views"
                  : job.target
                    ? "cast & world"
                    : "shot"}
                <ArrowUpRight size={15} />
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <p className="activity-job-meta">
          {job.operation === "video"
            ? "Video"
            : job.operation === "image"
              ? "Starting frame"
              : lookDestination
                ? "Look view"
                : "World image"}{" "}
          · {job.cost} cr · Demo
        </p>
        <p className="activity-job-status" role="status">
          <StatusIcon size={21} />
          {label}
        </p>
        {job.state === "running" && (
          <progress
            aria-label={`Progress for ${title}`}
            max={100}
            {...(progress == null ? {} : { value: progress })}
          />
        )}
        {job.error && <p className="activity-job-error">{job.error}</p>}
        <div className="activity-job-actions">
          {generating && (
            <button
              onClick={() =>
                commit((data) => cancelJob(data, job.id), "Job canceled", false)
              }
            >
              Cancel
            </button>
          )}
          {["failed", "canceled"].includes(job.state) && (
            <button
              onClick={() =>
                commit(
                  (data) => retryWorkspaceJob(data, job.id),
                  "Retry submitted",
                  false,
                )
              }
            >
              Retry · {job.cost} cr
            </button>
          )}
          {complete && (
            <button onClick={show}>
              Open result <ArrowUpRight size={16} />
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
