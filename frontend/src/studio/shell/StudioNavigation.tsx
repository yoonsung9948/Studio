import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  Clapperboard,
  Boxes,
  Home,
  Image,
  Layers,
  Settings,
  CirclePlay,
} from "lucide-react";
import type { Data } from "../../domain/types";
import { useStore } from "../../stores/store";
import { useOwnedData, useProjects } from "../../services/server-data";
import { produceStages } from "../../domain/produce-route";
import { useSelection, useStudio } from "../selection";
import { ThumbnailDropdown } from "./ThumbnailDropdown";
import "../../styles/project-navigation.css";
import "../../styles/thumbnail-dropdown.css";

type Destination = "produce" | "references" | "media";
interface ProjectOption {
  id: string;
  title: string;
  cover?: string;
}
interface NavigationContext {
  projectId: string;
  episodeId?: string;
  destination: Destination;
  settings: boolean;
  rememberedEpisodes: Record<string, string>;
  onEpisode(projectId: string, id: string): void;
}

/** Follow both sides of the Project → Episode relation; never offer foreign or archived episodes. */
function projectEpisodes(data: Data, projectId: string) {
  const project = data.projects[projectId];
  if (!project || project.archived) return [];
  return [...new Set(project.episodeIds)]
    .map((id) => data.episodes[id])
    .filter(
      (episode) =>
        episode && !episode.archived && episode.projectId === projectId,
    );
}

/** The route carries episode context through the existing reference and media destinations. */
function ProjectNavigation({
  context,
  projects,
  loadMore,
}: {
  context: NavigationContext;
  projects: ProjectOption[];
  loadMore?: () => void;
}) {
  const navigate = useNavigate(),
    location = useLocation();
  const data = useStore((state) => state.data);
  const [pickerOpen, setPickerOpen] = useState(false);
  const { projectId, episodeId, destination } = context;
  const project = data.projects[projectId];
  const options = projects.some((item) => item.id === projectId)
    ? projects
    : [
        ...projects,
        { id: projectId, title: project?.title ?? "Current project" },
      ];
  const episodes = projectEpisodes(data, projectId);
  const go = (pid: string, eid: string | undefined, section = destination) => {
    const params = new URLSearchParams();
    // Keep the isolated demo workspace selected when navigating its sidebar.
    if (new URLSearchParams(location.search).get("mode") === "demo")
      params.set("mode", "demo");
    const currentParams = new URLSearchParams(location.search);
    const stage = currentParams.get("stage");
    if (stage && produceStages.some((item) => item.id === stage)) params.set("stage", stage);
    let path: string;
    if (section === "produce") {
      path = eid
        ? `/projects/${pid}/episodes/${eid}`
        : `/projects/${pid}/episodes`;
      if (eid) {
        if (!params.has("stage")) params.set("stage", "plan");
        if (eid === episodeId) for (const key of ["scene", "shot"]) {
          const value = currentParams.get(key);
          if (value) params.set(key, value);
        }
      }
    } else {
      if (!eid) return;
      path = `/projects/${pid}/episodes/${eid}/${section === "references" ? "references" : "media"}`;
    }
    if (eid) context.onEpisode(pid, eid);
    setPickerOpen(false);
    navigate({ pathname: path, search: params.size ? `?${params}` : "" });
  };
  return (
    <nav
      className="studio-project-navigation"
      aria-label="Production navigation"
    >
      <button
        aria-label="Home"
        className="studio-all-projects"
        onClick={() => navigate("/projects")}
      >
        <Home />
        <span>Home</span>
      </button>
      <button
        className="studio-scope-toggle"
        aria-label="Choose project and episode"
        aria-expanded={pickerOpen}
        aria-controls="studio-project-context"
        onClick={() => setPickerOpen(!pickerOpen)}
      >
        <Layers />
      </button>
      <div
        id="studio-project-context"
        className={`studio-project-context ${pickerOpen ? "is-open" : ""}`}
      >
        <ThumbnailDropdown
          label="Project"
          value={projectId}
          options={options.map((item) => ({
            id: item.id,
            label: item.title,
            image: data.projects[item.id]?.cover || item.cover,
          }))}
          onSelect={(id) => {
            const available = projectEpisodes(data, id);
            const episode =
              available.find(
                (item) => item.id === context.rememberedEpisodes[id],
              ) ?? available.at(-1);
            go(id, episode?.id);
          }}
          onLoadMore={loadMore}
        />
        <ThumbnailDropdown
          label="Episode"
          value={episodeId}
          options={episodes.map((episode) => ({
            id: episode.id,
            label: `${String(project!.episodeIds.indexOf(episode.id) + 1).padStart(2, "0")} · ${episode.title}`,
            image:
              episode.sceneIds
                .map((id) => data.scenes[id])
                .find(
                  (scene) =>
                    scene?.episodeId === episode.id &&
                    !scene.archived &&
                    scene.cover,
                )?.cover || project?.cover,
          }))}
          onSelect={(id) => go(projectId, id)}
        />
      </div>
      {(
        [
          ["produce", "Produce", Clapperboard],
          ["references", "References", Image],
          ["media", "Media", CirclePlay],
        ] as const
      ).map(([id, title, Icon]) => (
        <button
          key={id}
          aria-label={title}
          aria-current={
            !context.settings && destination === id ? "page" : undefined
          }
          disabled={id !== "produce" && !episodeId}
          onClick={() => go(projectId, episodeId, id)}
        >
          <Icon />
          <span>{title}</span>
        </button>
      ))}
    </nav>
  );
}

function ConnectedProjectNavigation({
  context,
}: {
  context: NavigationContext;
}) {
  const query = useProjects();
  const projects = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <ProjectNavigation
      context={context}
      projects={projects}
      loadMore={
        query.hasNextPage && !query.isFetchingNextPage
          ? () => {
              void query.fetchNextPage();
            }
          : undefined
      }
    />
  );
}

export function StudioNavigation() {
  const navigate = useNavigate(),
    location = useLocation();
  const owned = useOwnedData();
  const selected = useSelection((state) => state.keys.at(-1));
  const data = useStore((state) => state.data);
  const [rememberedEpisodes, setRememberedEpisodes] = useState<
    Record<string, string>
  >({});
  const parts = location.pathname.split("/").filter(Boolean);
  const routeProjectId =
    parts[0] === "projects" && parts[1] !== "browse" ? parts[1] : undefined;
  const scopedProject =
    routeProjectId &&
    data.projects[routeProjectId] &&
    !data.projects[routeProjectId].archived
      ? routeProjectId
      : undefined;
  const requestedProjectId =
    routeProjectId ??
    (location.pathname === "/settings"
      ? (location.state?.projectId as string | undefined)
      : undefined);
  const projectId =
    requestedProjectId &&
    (owned ||
      (data.projects[requestedProjectId] &&
        !data.projects[requestedProjectId].archived))
      ? requestedProjectId
      : undefined;
  const params = new URLSearchParams(location.search);
  const routeEpisode =
    parts[2] === "episodes" ? parts[3] : params.get("episode");
  const episodes = projectId ? projectEpisodes(data, projectId) : [];
  const validEpisode = (id?: string | null) =>
    episodes.find((episode) => episode.id === id)?.id;
  const episodeId =
    validEpisode(routeEpisode) ??
    validEpisode(
      parts[2] === "episodes" && !parts[3] && selected?.startsWith("episode:")
        ? selected.slice(8)
        : undefined,
    ) ??
    validEpisode(projectId ? rememberedEpisodes[projectId] : undefined) ??
    episodes.at(-1)?.id;
  useEffect(() => {
    if (projectId && episodeId)
      setRememberedEpisodes((previous) =>
        previous[projectId] === episodeId
          ? previous
          : { ...previous, [projectId]: episodeId },
      );
  }, [projectId, episodeId]);
  const active =
    location.pathname === "/settings"
      ? "settings"
      : location.pathname.replace(/\/$/, "") === "/projects" ||
          location.pathname === "/work"
        ? "home"
        : "projects";
  const destination: Destination =
    parts[4] === "references" ||
    parts[2] === "world" ||
    (parts[2] === "library" && params.get("kind") === "image")
      ? "references"
      : parts[4] === "media" || parts[2] === "library"
        ? "media"
        : "produce";
  const context: NavigationContext | undefined = projectId
    ? {
        projectId,
        episodeId,
        destination,
        settings: active === "settings",
        rememberedEpisodes,
        onEpisode: (pid, id) =>
          setRememberedEpisodes((previous) => ({
            ...previous,
            ...(episodeId ? { [projectId]: episodeId } : {}),
            [pid]: id,
          })),
      }
    : undefined;
  return (
    <aside className="studio-sidebar" aria-label="Studio navigation">
      {context ? (
        owned ? (
          <ConnectedProjectNavigation context={context} />
        ) : (
          <ProjectNavigation
            context={context}
            projects={Object.values(data.projects).filter(
              (item) => !item.unfiled && !item.archived,
            )}
          />
        )
      ) : (
        <nav aria-label="Main navigation">
          <button
            aria-label="Home"
            aria-current={active === "home" ? "page" : undefined}
            onClick={() => navigate("/projects")}
          >
            <Home />
            <span>Home</span>
          </button>
          <button
            aria-label="Assets"
            aria-current={location.pathname === "/assets" ? "page" : undefined}
            onClick={() => navigate("/assets")}
          >
            <Boxes />
            <span>Assets</span>
          </button>
        </nav>
      )}
      <nav className="studio-sidebar-bottom" aria-label="Studio tools">
        <button
          aria-label="Activity"
          onClick={() => useStudio.getState().set({ activity: true })}
        >
          <Activity />
          <span>Activity</span>
        </button>
        <button
          aria-label="Settings & preferences"
          aria-current={active === "settings" ? "page" : undefined}
          onClick={() =>
            navigate("/settings", { state: { projectId: scopedProject } })
          }
        >
          <Settings />
          <span>Settings</span>
        </button>
      </nav>
    </aside>
  );
}
