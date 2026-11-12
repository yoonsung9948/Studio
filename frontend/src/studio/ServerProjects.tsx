import { AddEpisodeCard } from "./production/AddEpisodeCard";
import { ProductionFrame } from "./production/ProductionFrame";
import { ServerActivity } from "./ServerActivity";
import { useStudio } from "./selection";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../components/ui/dialog";
import { ProjectCreationPanel } from "./director-desk/ProjectCreationPanel";
import { AssetThumbnail, ServerLibrary } from "./ServerLibrary";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Folder, Plus } from "lucide-react";
import { useIdentity } from "../features/account/identity";
import { ApiError } from "../api/client";
import { createProject } from "../api/projects";
import {
  useOwnedData,
  useProjects,
  useProject,
  useAssets,
} from "../services/server-data";

export function ServerError({
  error,
  retry,
}: {
  error: Error;
  retry: () => unknown;
}) {
  const identity = useIdentity();
  return (
    <div role="alert" className="st-empty">
      <p>{error.message}</p>
      <button className="st-button" onClick={() => void retry()}>
        Retry
      </button>
      {error instanceof ApiError && error.sessionExpired && identity && (
        <button className="st-button" onClick={() => void identity.signOut()}>
          Sign in again
        </button>
      )}
    </div>
  );
}
export function ServerProjects({ compact = false }: { compact?: boolean }) {
  const context = useOwnedData()!;
  const [search, setSearch] = useState(""),
    [title, setTitle] = useState("");
  const query = useProjects(search.trim());
  const create = useMutation({
    mutationFn: () => createProject({ title: title.trim() }),
    onSuccess: (project) => {
      context.client.setQueryData(
        [context.accountId, "projects", "detail", project.id],
        project,
      );
      void context.client.invalidateQueries({
        queryKey: [context.accountId, "projects"],
      });
      setTitle("");
    },
  });
  const projects = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <section
      className={
        compact ? "st-owned-section" : "st-project-page st-panel-scroll"
      }
      aria-label={compact ? "Recent projects" : "Projects browser"}
    >
      <header className="st-home-toolbar">
        <h1>{compact ? "Projects" : "Your projects"}</h1>
        <Link className="st-button" to="/library">
          Library
        </Link>
        <button
          className="st-button"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          Refresh projects
        </button>
      </header>
      {!compact && (
        <>
          <input
            aria-label="Search projects"
            placeholder="Search projects"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <form
            className="st-owned-create"
            onSubmit={(event) => {
              event.preventDefault();
              if (title.trim() && !create.isPending) create.mutate();
            }}
          >
            <input
              aria-label="New project name"
              maxLength={200}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Project name"
            />
            <button
              className="st-button st-primary"
              disabled={!title.trim() || create.isPending}
            >
              <Plus size={14} />
              {create.isPending ? "Creating…" : "Create project"}
            </button>
          </form>
          {create.error && <p role="alert">{create.error.message}</p>}
        </>
      )}
      {query.isPending && <p role="status">Loading projects…</p>}
      {query.error && <ServerError error={query.error} retry={query.refetch} />}
      <div className="st-home-project-grid">
        {projects.map((project) => (
          <article
            className="st-home-project"
            key={project.id}
            aria-label={`Project ${project.title}`}
          >
            <div>
              <Folder size={28} />
            </div>
            <footer>
              <b>{project.title}</b>
              <Link
                className="st-text-button"
                to={`/projects/${project.id}/episodes`}
              >
                Open {project.title}
              </Link>
            </footer>
          </article>
        ))}
      </div>
      {!query.isPending && !query.error && !projects.length && (
        <p className="st-empty">
          {search ? "No matching projects" : "No projects yet"}
        </p>
      )}
      {query.hasNextPage && (
        <button
          className="st-button"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? "Loading…" : "Load more projects"}
        </button>
      )}
      {compact && (
        <Link className="st-text-button" to="/projects/browse">
          Browse projects
        </Link>
      )}
    </section>
  );
}
export function ServerProject() {
  const { projectId = "" } = useParams();
  const query = useProject(projectId);
  if (query.isPending) return <p role="status">Loading project…</p>;
  if (query.error)
    return <ServerError error={query.error} retry={query.refetch} />;
  return (
    <ConnectedProduction
      projectId={projectId}
      title={query.data.title}
      createdAt={query.data.createdAt}
    />
  );
}

function ConnectedProduction({
  projectId,
  title,
  createdAt,
}: {
  projectId: string;
  title: string;
  createdAt: string;
}) {
  const [creating, setCreating] = useState(false);
  const assets = useAssets(projectId);
  const items = assets.data?.pages.flatMap((page) => page.items) ?? [];
  const cover = items.find(
    (asset) => asset.kind === "image" || asset.kind === "video",
  );
  return (
    <ProductionFrame
      className="production-connected"
      title={<h1>{title}</h1>}
      description="Your scenes, generated media, and production activity in one place."
      actions={
        <>
          <Link
            className="production-button"
            to={`/projects/${projectId}/library`}
          >
            Open project library
          </Link>
        </>
      }
      cover={
        cover ? <AssetThumbnail id={cover.id} kind={cover.kind} /> : undefined
      }
      facts={[
        { label: "Created", value: new Date(createdAt).toLocaleDateString() },
        ...(["image", "video", "audio"] as const).map((kind) => ({
          label:
            kind === "image" ? "Images" : kind === "video" ? "Video" : "Audio",
          value: assets.isPending
            ? "Loading…"
            : assets.error
              ? "Unavailable"
              : `${items.filter((asset) => asset.kind === kind).length} loaded`,
        })),
      ]}
    >
      <nav className="production-tabs" aria-label="Production sections">
        <button aria-current="page">Production media</button>
      </nav>
      <div className="production-content">
        <section className="production-workspace production-connected-main">
          <section aria-label="Episodes">
            <h2>Episodes</h2>
            <div className="production-episode-grid">
              <AddEpisodeCard onAdd={() => setCreating(true)} />
            </div>
          </section>
          <ServerLibrary compact />
        </section>
        <aside
          className="production-recent"
          aria-label="Recent production activity"
        >
          <header className="production-section-heading">
            <h2>Recent activity</h2>
            <button
              onClick={() => useStudio.getState().set({ activity: true })}
            >
              View all
            </button>
          </header>
          <ServerActivity projectId={projectId} />
        </aside>
      </div>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="st-dialog production-dialog">
          <DialogTitle>New episode</DialogTitle>
          <DialogDescription>
            Develop the next chapter inside {title}.
          </DialogDescription>
          <ProjectCreationPanel
            projectId={projectId}
            title={title}
            initialKind="episode"
          />
        </DialogContent>
      </Dialog>
    </ProductionFrame>
  );
}
