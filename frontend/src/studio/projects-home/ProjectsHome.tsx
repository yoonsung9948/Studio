import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { episodeContinuity } from "../../domain/episode-resources";
import { demoMedia } from "../../mocks/demo-media";
import { useStore } from "../../stores/store";
import { useOwnedData, useProjects } from "../../services/server-data";
import { readAppConfiguration } from "../../config";
import { homeUsesDemo } from "../../config/environment";
import { createProject } from "../../api/projects";
import {
  createWorkspaceEpisode,
  createWorkspaceProject,
} from "../../domain/workspace";
import { interpretationPending } from "../../domain/interpretation";
import { submitHomeRequest } from "../../services/home";
import { interpretationWorkflow } from "../../services/interpretation";
import { HomeInterpretationReply } from "../InterpretationHome";
import { commit } from "../generation";
import { FilmComposer, type FilmStart } from "./FilmComposer";
import { ProjectsHomeView, type Production } from "./ProjectsHomeView";

/** The same creation panel drives either the local workspace or authenticated requests. */
function CreationPanel({ demo }: { demo: boolean }) {
  const navigate = useNavigate();
  const owned = useOwnedData();
  const request = useStore((state) => state.data.backend?.request);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [replyOpen, setReplyOpen] = useState(true);
  const busy = submitting || (!demo && interpretationPending(request));
  useEffect(() => {
    if (!demo) return interpretationWorkflow.observePage();
  }, [demo]);
  useEffect(() => {
    const show = () => setReplyOpen(true);
    window.addEventListener("dotori-home-show-reply", show);
    return () => window.removeEventListener("dotori-home-show-reply", show);
  }, []);
  const start = async (mode: FilmStart, prompt: string) => {
    if (busy) return;
    setError("");
    setSubmitting(true);
    try {
      if (demo) {
        let projectId = "",
          episodeId = "";
        const created = commit((data) => {
          const title =
            mode === "blank"
              ? prompt || "Untitled film"
              : prompt.split(/[.\n]/)[0].slice(0, 65);
          projectId = createWorkspaceProject(data, title);
          data.projects[projectId].updatedAt = Date.now();
          if (mode !== "blank")
            episodeId = createWorkspaceEpisode(data, projectId, prompt);
        }, "Film created · 0 credits spent");
        if (created)
          navigate(
            `/projects/${projectId}/episodes${episodeId ? `/${episodeId}` : ""}`,
          );
      } else if (mode === "blank") {
        const project = await createProject({
          title: prompt || "Untitled film",
        });
        if (owned)
          await owned.client.invalidateQueries({
            queryKey: [owned.accountId, "projects"],
          });
        navigate(`/projects/${project.id}/episodes`);
      } else {
        setReplyOpen(true);
        await submitHomeRequest({ prompt, creationKind: "episode" });
      }
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not start your film. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <>
      <FilmComposer
        busy={busy}
        onStart={(mode, prompt) => void start(mode, prompt)}
      />
      {error && (
        <p role="alert" className="ph-creation-error">
          {error}
        </p>
      )}
      {!demo && request && replyOpen && (
        <div className="ph-reply">
          <HomeInterpretationReply
            request={request}
            onClose={() => setReplyOpen(false)}
          />
        </div>
      )}
      {!demo && request && !replyOpen && (
        <button className="st-text-button" onClick={() => setReplyOpen(true)}>
          View reply
        </button>
      )}
    </>
  );
}
export function LocalProjectsHome() {
  const data = useStore((state) => state.data);
  const [params] = useSearchParams();
  const demo = homeUsesDemo(readAppConfiguration(), params.toString());
  const productions: Production[] = Object.values(data.projects)
    .filter((project) => !project.archived && !project.unfiled)
    .map((project) => {
      const episodes = project.episodeIds
        .map((id) => data.episodes[id])
        .filter((episode) => episode && !episode.archived);
      const episode = episodes.at(-1);
      const linkedCast = new Set(
        episodes.flatMap((episode) =>
          episodeContinuity(data, episode.id).cast.map((entry) => entry.id),
        ),
      );
      const cast = Object.values(data.characters)
        .filter(
          (character) =>
            character.projectId === project.id && linkedCast.has(character.id),
        )
        .map((character) => ({
          name: character.name,
          image: character.reference,
        }));
      const href = `/projects/${project.id}/episodes`;
      return {
        id: project.id,
        title: project.title,
        cover:
          project.id === "last-letter" && project.cover === demoMedia.reunion
            ? "/media/director-desk/projects-hero.png"
            : project.cover,
        subtitle: episode
          ? `Episode ${String(episodes.length).padStart(2, "0")} · ${episode.title}`
          : "Your next story starts here",
        episodeCount: episodes.length,
        cast,
        updatedAt: project.updatedAt ?? 0,
        href,
        editHref: episode ? `${href}/${episode.id}` : href,
        worldHref: `/projects/${project.id}/world`,
        libraryHref: `/projects/${project.id}/library`,
      };
    });
  return (
    <ProjectsHomeView productions={productions}>
      <CreationPanel demo={demo} />
    </ProjectsHomeView>
  );
}
export function ConnectedProjectsHome() {
  const projects = useProjects();
  const productions: Production[] = (
    projects.data?.pages.flatMap((page) => page.items) ?? []
  ).map((project) => ({
    id: project.id,
    title: project.title,
    subtitle: "Continue your production",
    cast: [],
    updatedAt: Date.parse(project.createdAt),
    href: `/projects/${project.id}/episodes`,
    editHref: `/projects/${project.id}/episodes`,
    libraryHref: `/projects/${project.id}/library`,
  }));
  const status = projects.isPending ? (
    <p role="status">Loading your productions…</p>
  ) : projects.error ? (
    <div role="alert">
      <p>{projects.error.message}</p>
      <button className="st-button" onClick={() => void projects.refetch()}>
        Retry
      </button>
    </div>
  ) : undefined;
  return (
    <ProjectsHomeView
      productions={productions}
      status={status}
      loadMore={
        projects.hasNextPage && (
          <button
            className="ph-secondary ph-load-more"
            disabled={projects.isFetchingNextPage}
            onClick={() => void projects.fetchNextPage()}
          >
            {projects.isFetchingNextPage ? "Loading…" : "More productions"}
          </button>
        )
      }
    >
      <CreationPanel demo={false} />
    </ProjectsHomeView>
  );
}
