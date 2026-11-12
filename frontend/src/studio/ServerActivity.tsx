import { matchesActivityFilter, type ActivityFilter } from "./ActivityJobCard";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getJob, type JobSummary } from "../api/jobs";
import { recordObservedJob } from "../domain/backend-jobs";
import { useJobs, useJob, useOwnedData } from "../services/server-data";
import { useStore } from "../stores/store";
import { backendActivity } from "../services/backend-activity";
import { ServerError } from "./ServerProjects";

const operationName = (name: string) =>
  name === "interpret_request"
    ? "Interpretation"
    : name === "generate_video"
      ? "Video generation"
      : name.replaceAll("_", " ");
export function ServerActivity({
  projectId,
  filter = "all",
}: {
  projectId?: string;
  filter?: ActivityFilter;
}) {
  const query = useJobs({ projectId });
  const observed = useStore((state) => state.data.backend?.jobs);
  const jobs = new Map(
    (query.data?.pages.flatMap((page) => page.items) ?? []).map((job) => [
      job.id,
      job,
    ]),
  );
  for (const record of Object.values(observed ?? {}))
    if (record.job && (!projectId || record.projectId === projectId)) {
      const remote = jobs.get(record.id);
      if (
        !remote ||
        new Date(record.job.updatedAt) >= new Date(remote.updatedAt)
      )
        jobs.set(record.id, record.job);
    }
  const visibleJobs = [...jobs.values()].filter((job) =>
    matchesActivityFilter(
      filter,
      job.status === "running" || job.status === "queued",
      job.status === "succeeded",
    ),
  );
  return (
    <section aria-label="Saved activity">
      <header className="st-owned-toolbar">
        <button
          className="st-button"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          Refresh activity
        </button>
      </header>
      {query.isPending && <p role="status">Loading activity…</p>}
      {query.error && <ServerError error={query.error} retry={query.refetch} />}
      {visibleJobs
        .sort(
          (a, b) =>
            b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
        )
        .map((job) => (
          <ServerJobRow key={job.id} summary={job} />
        ))}
      {!query.isPending && !query.error && !visibleJobs.length && (
        <p className="activity-empty">
          {filter === "generating"
            ? "No jobs generating"
            : filter === "completed"
              ? "No completed jobs yet"
              : "No jobs yet"}
        </p>
      )}
      {query.hasNextPage && (
        <button
          className="st-button"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          Load more jobs
        </button>
      )}
    </section>
  );
}
function ServerJobRow({ summary }: { summary: JobSummary }) {
  const context = useOwnedData()!,
    navigate = useNavigate();
  const [open, setOpen] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const show = async () => {
    setLoading(true);
    setError("");
    try {
      const job = await context.client.fetchQuery({
        queryKey: [context.accountId, "jobs", "detail", summary.id],
        queryFn: ({ signal }) => getJob(summary.id, signal),
        staleTime: 0,
      });
      if (useStore.getState().data.backend?.ownerId !== context.accountId)
        return;
      useStore
        .getState()
        .mutate((data) => recordObservedJob(data, job, { job }));
      if (
        job.operation === "interpret_request" &&
        backendActivity.show(job.id)
      ) {
        navigate(`/projects?job=${job.id}`);
        window.dispatchEvent(new Event("dotori-home-show-reply"));
      } else setOpen((value) => !value);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not open this job.",
      );
    } finally {
      setLoading(false);
    }
  };
  return (
    <article className="st-owned-job">
      <div>
        <span className={`st-job-dot ${summary.status}`} />
        <b>{operationName(summary.operation)}</b>
        <span>
          {summary.status === "succeeded" ? "Complete" : summary.status}
        </span>
        <button
          className="st-text-button"
          onClick={() => void show()}
          disabled={loading}
        >
          {loading ? "Opening…" : "Show result"}
        </button>
      </div>
      {summary.error && <p role="alert">{summary.error.message}</p>}
      {error && <p role="alert">{error}</p>}
      {open && <ServerJobDetails id={summary.id} />}
    </article>
  );
}
function ServerJobDetails({ id }: { id: string }) {
  const query = useJob(id);
  if (query.isPending) return <p role="status">Loading result…</p>;
  if (query.error)
    return <ServerError error={query.error} retry={query.refetch} />;
  const results = query.data.results ?? [];
  return (
    <div>
      {results
        .filter((result) => result.assetId)
        .map((result) => (
          <Link
            className="st-button"
            key={result.id}
            to={`/library?asset=${result.assetId}`}
          >
            Open generated {result.kind}
          </Link>
        ))}
      {!results.some((result) => result.assetId) && (
        <p>
          {query.data.status === "succeeded"
            ? "This job has no media output."
            : "No result is available yet."}
        </p>
      )}
    </div>
  );
}
