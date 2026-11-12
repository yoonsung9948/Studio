import { episodeProgress } from "./production/production-data";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../components/ui/dropdown-menu";
import { ProductionOverview } from "./ProductionOverview";
import { LocalProjectsHome } from "./projects-home/ProjectsHome";
import {
  CreationKindPicker,
  type CreationKind,
} from "./director-desk/CreationKind";
import { HomeWelcome } from "./director-desk/HomeWelcome";
import { useOwnedData } from "../services/server-data";
import { ServerHome } from "./ServerHome";
import { ServerProjects } from "./ServerProjects";
import { readAppConfiguration } from "../config";
import { homeUsesDemo } from "../config/environment";
import { FloatingPromptForm } from "./FloatingPromptForm";
import { HomeCardRow } from "./HomeCardRow";
import { HomeInterpretationReply } from "./InterpretationHome";
import { submitHomeRequest, createDemoHomeDraft } from "../services/home";
import { interpretationWorkflow } from "../services/interpretation";
import { interpretationPending } from "../domain/interpretation";
import { SelectionSurface } from "./SelectionSurface";
import { useEffect, useMemo, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  Plus,
  ArrowRight,
  ArrowUpRight,
  MoreHorizontal,
  Folder,
  Film,
  Clapperboard,
} from "lucide-react";
import { useStore } from "../stores/store";
import { type EntityKey, useSelection, useStudio } from "./selection";
import { commit } from "./generation";
import {
  CommandButton,
  CommandMenu,
  useRegisterCommands,
  type StudioCommand,
  useCommands,
} from "./commands";
import {
  shotStatus,
  createWorkspaceProject,
  shotAsset,
  shotsOfEpisode,
  archiveWorkspaceEpisodes,
} from "../domain/workspace";
import { duplicateEpisode } from "../domain/commands";
export function HomeWorkspace() {
  return useOwnedData() ? <ServerHome /> : <LocalProjectsHome />;
}
export function WorkBrowser() {
  const d = useStore((s) => s.data),
    navigate = useNavigate();
  const [idea, setIdea] = useState("");
  const [creationKind, setCreationKind] = useState<CreationKind>("episode");
  const [workType, setWorkType] = useState<"shots" | "scenes">("shots"),
    [scope, setScope] = useState("all");
  const [params] = useSearchParams();
  const demo = homeUsesDemo(readAppConfiguration(), params.toString());
  const request = d.backend?.request;
  const busy = !demo && interpretationPending(request);
  const [replyOpen, setReplyOpen] = useState(true);
  const [validation, setValidation] = useState("");
  useEffect(() => {
    if (!demo) return interpretationWorkflow.observePage();
  }, [demo]);
  useEffect(() => {
    const show = () => setReplyOpen(true);
    window.addEventListener("dotori-home-show-reply", show);
    return () => window.removeEventListener("dotori-home-show-reply", show);
  }, []);
  const projects = Object.values(d.projects).filter(
    (p) => !p.unfiled && !p.archived,
  );
  const episodes = Object.values(d.episodes).filter(
    (e) => !e.archived && !d.projects[e.projectId].archived,
  );
  const scenes = Object.values(d.scenes).filter(
    (s) =>
      !s.archived &&
      episodes.some((e) => e.id === s.episodeId) &&
      (scope === "all" ||
        (scope === "unfiled"
          ? d.projects[d.episodes[s.episodeId].projectId]?.unfiled
          : d.episodes[s.episodeId].projectId === scope)),
  );
  const shots = scenes.flatMap((s) => s.shotIds.map((id) => d.shots[id]));
  const keys = useSelection((s) => s.keys);
  const order = (
    workType === "shots"
      ? [...shots].reverse().map((s) => `shot:${s.id}`)
      : [...scenes].reverse().map((s) => `scene:${s.id}`)
  ) as EntityKey[];
  const selectWork = (
    key: EntityKey,
    e: React.MouseEvent,
    open: () => void,
  ) => {
    useSelection.getState().choose(key, order, e);
    if (
      window.matchMedia("(pointer: coarse)").matches &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.shiftKey
    )
      open();
  };
  const openShot = (id: string) => {
    const shot = d.shots[id],
      ep = d.episodes[d.scenes[shot.sceneId].episodeId];
    useStudio.getState().set({ inspector: true });
    navigate(
      `/projects/${ep.projectId}/episodes/${ep.id}/shots/${id}?stage=${shot.currentTakeId ? "review" : "frame"}`,
    );
  };
  const create = () => {
    if (!idea.trim()) {
      document.getElementById("story-idea")?.focus();
      return;
    }
    if (busy) return;
    setValidation("");
    if (!demo) {
      setReplyOpen(true);
      void submitHomeRequest({ prompt: idea, creationKind }).catch((error) =>
        setValidation(
          error instanceof Error
            ? error.message
            : "Check your prompt and try again.",
        ),
      );
      return;
    }
    const result = createDemoHomeDraft({ prompt: idea, creationKind });
    if (result) {
      useStudio.getState().set({ inspector: false });
      navigate(
        creationKind !== "episode" && result.shotId
          ? `/projects/${result.projectId}/episodes/${result.episodeId}/shots/${result.shotId}?stage=scene`
          : `/projects/${result.projectId}/episodes/${result.episodeId}`,
      );
    }
  };
  const workCards =
    workType === "shots"
      ? [...shots].reverse().map((shot) => {
          const ep = d.episodes[d.scenes[shot.sceneId].episodeId],
            p = d.projects[ep.projectId],
            asset = shotAsset(d, shot);
          return (
            <CommandMenu
              key={shot.id}
              ids={[]}
              onSelect={() => {
                if (!keys.includes(`shot:${shot.id}`))
                  useSelection.getState().replace([`shot:${shot.id}`]);
              }}
            >
              <article
                className={`st-home-work-card ${keys.includes(`shot:${shot.id}`) ? "is-selected" : ""}`}
                data-selection-key={`shot:${shot.id}`}
                key={shot.id}
                tabIndex={0}
                onClick={(e) =>
                  selectWork(`shot:${shot.id}`, e, () => openShot(shot.id))
                }
                onDoubleClick={() => openShot(shot.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") openShot(shot.id);
                  if (e.key === " ") {
                    e.preventDefault();
                    useSelection.getState().choose(`shot:${shot.id}`, order, e);
                  }
                }}
                aria-label={`Shot ${shot.title}`}
              >
                <div>
                  {asset ? <img src={asset.url} alt="" /> : <Film size={26} />}
                  <span>
                    {shot.targetFrames / 30}s · {shotStatus(d, shot)}
                  </span>
                </div>
                <b>{shot.title}</b>
                <small>
                  {p.unfiled ? "Unfiled" : p.title} ·{" "}
                  {d.scenes[shot.sceneId].title}
                </small>
                <button
                  className="st-text-button st-home-card-open"
                  aria-label={`Open shot ${shot.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    openShot(shot.id);
                  }}
                >
                  Open <ArrowUpRight size={12} />
                </button>
              </article>
            </CommandMenu>
          );
        })
      : [...scenes].reverse().map((scene) => {
          const ep = d.episodes[scene.episodeId],
            p = d.projects[ep.projectId],
            shot = d.shots[scene.shotIds[0]],
            asset = shot && shotAsset(d, shot);
          return (
            <CommandMenu
              key={scene.id}
              ids={[]}
              onSelect={() => {
                if (!keys.includes(`scene:${scene.id}`))
                  useSelection.getState().replace([`scene:${scene.id}`]);
              }}
            >
              <article
                className={`st-home-work-card ${keys.includes(`scene:${scene.id}`) ? "is-selected" : ""}`}
                data-selection-key={`scene:${scene.id}`}
                key={scene.id}
                tabIndex={0}
                aria-label={`Scene ${scene.title}`}
                onClick={(e) =>
                  selectWork(`scene:${scene.id}`, e, () =>
                    navigate(
                      `/projects/${p.id}/episodes/${ep.id}?scene=${scene.id}`,
                    ),
                  )
                }
                onDoubleClick={() =>
                  navigate(
                    `/projects/${p.id}/episodes/${ep.id}?scene=${scene.id}`,
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter")
                    navigate(
                      `/projects/${p.id}/episodes/${ep.id}?scene=${scene.id}`,
                    );
                  if (e.key === " ") {
                    e.preventDefault();
                    useSelection
                      .getState()
                      .choose(`scene:${scene.id}`, order, e);
                  }
                }}
              >
                <div>
                  {asset ? (
                    <img src={asset.url} alt="" />
                  ) : (
                    <Clapperboard size={26} />
                  )}
                  <span>{scene.shotIds.length} shots</span>
                </div>
                <b>{scene.title}</b>
                <small>
                  {p.unfiled ? "Unfiled" : p.title} · {ep.title}
                </small>
                <Link
                  className="st-text-button st-home-card-open"
                  aria-label={`Open scene ${scene.title}`}
                  onClick={(e) => e.stopPropagation()}
                  to={`/projects/${p.id}/episodes/${ep.id}?scene=${scene.id}`}
                >
                  Open <ArrowUpRight size={12} />
                </Link>
              </article>
            </CommandMenu>
          );
        });
  const recentProjects = [...projects]
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, 20);
  return (
    <div className="st-home-workspace">
      <header className="st-home-toolbar">
        <h1>Home</h1>
        <div className="st-home-filters">
          <select
            aria-label="Home project filter"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="all">All projects</option>
            <option value="unfiled">Unfiled</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
          <select
            aria-label="Work type"
            value={workType}
            onChange={(e) => setWorkType(e.target.value as "shots" | "scenes")}
          >
            <option value="shots">Shots</option>
            <option value="scenes">Scenes</option>
          </select>
        </div>
      </header>
      <SelectionSurface
        className="st-home-canvas st-panel-scroll"
        aria-label="Home content"
      >
        <HomeWelcome
          production={
            recentProjects[0] &&
            recentProjects[0].episodeIds.find((id) => !d.episodes[id]?.archived)
              ? {
                  title: recentProjects[0].title,
                  subtitle:
                    d.episodes[
                      recentProjects[0].episodeIds.find(
                        (id) => !d.episodes[id]?.archived,
                      )!
                    ]?.title ?? "Your next episode",
                  cover: recentProjects[0].cover,
                  href: `/projects/${recentProjects[0].id}/episodes/${recentProjects[0].episodeIds.find((id) => !d.episodes[id]?.archived)}`,
                }
              : undefined
          }
        >
          <div className="st-composer-dock">
            <CreationKindPicker
              value={creationKind}
              onChange={setCreationKind}
            />
            {!demo && request && replyOpen && (
              <HomeInterpretationReply
                request={request}
                onClose={() => setReplyOpen(false)}
              />
            )}
            {!idea && (
              <div className="st-composer-examples" aria-label="Starting ideas">
                {[
                  {
                    title: "Dialogue",
                    idea: "INT. CAFE — DAY\nTwo old friends meet. One has a secret they can no longer hide.",
                  },
                  {
                    title: "Suspense",
                    idea: "INT. APARTMENT — NIGHT\nA stranger leaves a recording. The voice on it is your own.",
                  },
                  {
                    title: "Product",
                    idea: "INT. STUDIO — DAY\nReveal a new object through texture, movement, and close-up details.",
                  },
                ].map((t) => (
                  <button
                    key={t.title}
                    onClick={() => {
                      setIdea(t.idea);
                      document.getElementById("story-idea")?.focus();
                    }}
                  >
                    {t.title}
                    <ArrowUpRight size={11} />
                  </button>
                ))}
              </div>
            )}
            <FloatingPromptForm
              id="story-idea"
              label="Story idea"
              formLabel="Create a draft"
              value={idea}
              onChange={setIdea}
              onSubmit={create}
              busy={busy}
            />
            {validation && (
              <p className="st-home-chat-error" role="alert">
                {validation}
              </p>
            )}
            {!demo && request && !replyOpen && (
              <button
                className="st-text-button st-home-reopen"
                onClick={() => setReplyOpen(true)}
              >
                View reply
              </button>
            )}
            <small className="st-composer-note">
              Drafting is free. Credits are spent when you generate media.
            </small>
          </div>
        </HomeWelcome>
        <HomeCardRow
          label="Recent work"
          count={Math.min(workCards.length, 20)}
          empty={`No recent ${workType}`}
        >
          {workCards.slice(0, 20)}
        </HomeCardRow>
        <HomeCardRow
          label="Projects"
          count={recentProjects.length}
          empty="No projects yet"
        >
          {recentProjects.map((p) => (
            <ProjectCard
              key={p.id}
              id={p.id}
              order={recentProjects.map((p) => `project:${p.id}` as EntityKey)}
            />
          ))}
        </HomeCardRow>
        <div role="group" aria-label="All work">
          <section>
            <div className="st-section-heading">
              <h1>All work</h1>
              <span>
                {workType === "shots" ? shots.length : scenes.length} {workType}
              </span>
            </div>
            <div className="st-home-work-grid">{workCards}</div>
            {!(workType === "shots" ? shots.length : scenes.length) && (
              <div className="st-home-empty">
                <Film size={26} />
                <p>No {workType} yet</p>
                <span>
                  Describe your first {workType === "shots" ? "shot" : "scene"}{" "}
                  below.
                </span>
              </div>
            )}
          </section>
        </div>
      </SelectionSurface>
    </div>
  );
}
export function ProjectsWorkspace() {
  return useOwnedData() ? <ServerProjects /> : <LocalProjectsWorkspace />;
}
function LocalProjectsWorkspace() {
  const d = useStore((s) => s.data),
    navigate = useNavigate();
  const [query, setQuery] = useState("");
  const projects = Object.values(d.projects).filter(
    (p) =>
      !p.unfiled &&
      !p.archived &&
      p.title.toLowerCase().includes(query.toLowerCase()),
  );
  const commands = useMemo<StudioCommand[]>(
    () => [
      {
        id: "project.create",
        label: "New project",
        run: () => {
          let id = "";
          if (
            commit((data) => {
              id = createWorkspaceProject(data, "Untitled project");
            }, "Project created")
          )
            navigate(`/projects/${id}/episodes`);
        },
      },
    ],
    [navigate],
  );
  useRegisterCommands("project-browser", commands);
  return (
    <SelectionSurface
      className="st-project-browser st-panel-scroll"
      aria-label="Project cards"
    >
      <header className="st-section-heading">
        <h1>Projects</h1>
        <input
          aria-label="Search projects"
          placeholder="Search projects"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <CommandButton id="project.create">
          <Plus size={13} />
          New project
        </CommandButton>
      </header>
      <div className="st-home-project-grid">
        {projects.map((p) => (
          <ProjectCard
            key={p.id}
            id={p.id}
            order={projects.map((p) => `project:${p.id}` as EntityKey)}
          />
        ))}
      </div>
      {!projects.length && (
        <div className="st-home-empty">
          <Folder size={25} />
          <p>{query ? "No matching projects" : "No projects yet"}</p>
          <CommandButton id="project.create" />
        </div>
      )}
    </SelectionSurface>
  );
}
function ProjectCard({ id, order }: { id: string; order: EntityKey[] }) {
  const d = useStore((s) => s.data),
    p = d.projects[id],
    selected = useSelection((s) => s.keys.includes(`project:${id}`)),
    navigate = useNavigate();
  const { execute } = useCommands();
  const commands = useMemo<StudioCommand[]>(
    () => [
      {
        id: `project.open:${id}`,
        label: `Open ${p.title}`,
        run: () => navigate(`/projects/${id}/episodes`),
      },
    ],
    [id, p.title, navigate],
  );
  useRegisterCommands(`project-card:${id}`, commands);
  const ep = p.episodeIds
      .map((id) => d.episodes[id])
      .find((e) => e && !e.archived),
    first = ep && shotsOfEpisode(d, ep.id)[0];
  return (
    <CommandMenu
      ids={[`project.open:${id}`]}
      onSelect={() => {
        if (!selected) useSelection.getState().replace([`project:${id}`]);
      }}
    >
      <article
        className={`st-home-project ${selected ? "is-selected" : ""}`}
        data-selection-key={`project:${id}`}
        aria-label={`Project ${p.title}`}
        tabIndex={0}
        onClick={(e) => {
          useSelection.getState().choose(`project:${id}`, order, e);
          if (
            window.matchMedia("(pointer: coarse)").matches &&
            !e.metaKey &&
            !e.ctrlKey &&
            !e.shiftKey
          )
            execute(`project.open:${id}`);
        }}
        onDoubleClick={() => execute(`project.open:${id}`)}
        onKeyDown={(e) => {
          if (e.key === "Enter") execute(`project.open:${id}`);
          if (e.key === " ") {
            e.preventDefault();
            useSelection.getState().choose(`project:${id}`, order, e);
          }
        }}
      >
        <div>
          <img src={(first && shotAsset(d, first)?.url) || p.cover} alt="" />
          <Folder size={18} />
        </div>
        <footer>
          <span>
            <b>{p.title}</b>
            <small>
              {p.episodeIds.filter((id) => !d.episodes[id]?.archived).length}{" "}
              episodes
            </small>
          </span>
          <button
            className="st-text-button"
            aria-label={`Open ${p.title}`}
            onClick={(e) => {
              e.stopPropagation();
              execute(`project.open:${id}`);
            }}
          >
            Open <ArrowUpRight size={13} />
          </button>
        </footer>
      </article>
    </CommandMenu>
  );
}
export function EpisodeTile({ id }: { id: string }) {
  const d = useStore((s) => s.data),
    ep = d.episodes[id],
    navigate = useNavigate(),
    selected = useSelection((s) => s.keys.includes(`episode:${id}`));
  const tileCommands = useMemo<StudioCommand[]>(
    () =>
      !ep
        ? []
        : [
            {
              id: `episode.open:${id}`,
              label: "Open episode",
              run: () => navigate(`/projects/${ep.projectId}/episodes/${id}`),
            },
            {
              id: `episode.duplicate:${id}`,
              label: "Duplicate episode",
              run: () =>
                commit((data) => {
                  duplicateEpisode(data, id);
                }, "Episode duplicated"),
            },
            {
              id: `episode.archive:${id}`,
              label: "Archive episode",
              run: () =>
                commit(
                  (data) => archiveWorkspaceEpisodes(data, [id], true),
                  "Episode archived",
                ),
            },
          ],
    [ep, id, navigate],
  );
  useRegisterCommands(`tile:${id}`, tileCommands);
  if (!ep) return null;
  const { shots, ready, total, status } = episodeProgress(d, id);
  const asset = shots[0] ? shotAsset(d, shots[0]) : undefined;
  const coverScene = ep.sceneIds
    .map((id) => d.scenes[id])
    .filter((scene) => scene && !scene.archived)
    .find((scene) => scene.title === ep.title);
  const project = d.projects[ep.projectId];
  const number = String(project.episodeIds.indexOf(id) + 1).padStart(2, "0");
  const order = project.episodeIds
    .filter((id) => !d.episodes[id]?.archived)
    .map((id) => `episode:${id}` as EntityKey);
  return (
    <CommandMenu
      ids={[
        `episode.open:${id}`,
        `episode.duplicate:${id}`,
        `episode.archive:${id}`,
      ]}
      onSelect={() => {
        if (!selected) useSelection.getState().replace([`episode:${id}`]);
      }}
    >
      <article
        className={`production-episode-card ${selected ? "is-selected" : ""}`}
        data-selection-key={`episode:${id}`}
        aria-label={`Episode ${ep.title}`}
        tabIndex={0}
        onClick={(event) =>
          useSelection.getState().choose(`episode:${id}`, order, event)
        }
        onDoubleClick={() =>
          navigate(`/projects/${ep.projectId}/episodes/${id}`)
        }
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter")
            navigate(`/projects/${ep.projectId}/episodes/${id}`);
          if (event.key === " ") {
            event.preventDefault();
            useSelection.getState().choose(`episode:${id}`, order, event);
          }
        }}
      >
        <div className="production-episode-cover">
          <img src={coverScene?.cover || asset?.url || project.cover} alt="" />
          <span>{number}</span>
        </div>
        <div className="production-episode-copy">
          <h3>
            <span>{number}</span>
            {ep.title}
          </h3>
          <p>{ep.synopsis || "Your next chapter is waiting to be written."}</p>
          {ready > 0 && ready < total ? (
            <div className="production-episode-progress">
              <span>
                {ready} of {total} shots ready
              </span>
              <progress
                aria-label={`Ready shots for ${ep.title}`}
                value={ready}
                max={total}
              />
            </div>
          ) : (
            <span
              className={`production-episode-status ${status === "In progress" ? "in-progress" : status === "Ready to review" ? "is-ready" : ""}`}
            >
              {status !== "Draft" && <i />}
              {status}
            </span>
          )}
          <footer>
            <Link
              to={`/projects/${ep.projectId}/episodes/${id}`}
              onClick={(event) => event.stopPropagation()}
            >
              <ArrowRight size={20} />
              Open episode
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label={`Options for ${ep.title}`}
                  onClick={(event) => event.stopPropagation()}
                >
                  <MoreHorizontal size={21} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                onClick={(event) => event.stopPropagation()}
              >
                {tileCommands.map((command) => (
                  <DropdownMenuItem key={command.id} onSelect={command.run}>
                    {command.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </footer>
        </div>
      </article>
    </CommandMenu>
  );
}
export function ProjectWorkspace() {
  return <LocalProjectWorkspace />;
}
function LocalProjectWorkspace() {
  const { projectId = "" } = useParams(),
    d = useStore((s) => s.data),
    p = d.projects[projectId],
    navigate = useNavigate();
  const commands = useMemo<StudioCommand[]>(
    () =>
      !p
        ? []
        : p.episodeIds
            .map((id) => [
              {
                id: `episode.open:${id}`,
                label: "Open episode",
                run: () => navigate(`/projects/${projectId}/episodes/${id}`),
              },
              {
                id: `episode.duplicate:${id}`,
                label: "Duplicate episode",
                run: () =>
                  commit((data) => {
                    duplicateEpisode(data, id);
                  }, "Episode duplicated"),
              },
              {
                id: `episode.archive:${id}`,
                label: "Archive episode",
                run: () =>
                  commit((data) => {
                    archiveWorkspaceEpisodes(data, [id], true);
                  }, "Episode archived"),
              },
            ])
            .flat(),
    [p, navigate, projectId],
  );
  useRegisterCommands("project", commands);
  if (!p) return <div className="st-empty">Project unavailable</div>;
  return (
    <ProductionOverview projectId={projectId}>
      {p.episodeIds
        .filter((id) => !d.episodes[id]?.archived)
        .map((id) => (
          <EpisodeTile key={id} id={id} />
        ))}
    </ProductionOverview>
  );
}
