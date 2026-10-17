import { SelectionSurface } from "./SelectionSurface";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Plus,
  ArrowUpRight,
  ArrowUp,
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
  createHomeDraft,
  shotStatus,
  createWorkspaceProject,
  shotAsset,
  shotsOfEpisode,
  archiveWorkspaceEpisodes,
  renameWorkspaceProject,
} from "../domain/workspace";
import { duplicateEpisode } from "../domain/commands";
export function HomeWorkspace() {
  const d = useStore((s) => s.data),
    navigate = useNavigate();
  const [idea, setIdea] = useState(""),
    [pid, setPid] = useState(""),
    [seconds, setSeconds] = useState(30);
  const [kind, setKind] = useState<"episode" | "scene" | "shot">("episode");
  const [workType, setWorkType] = useState<"shots" | "scenes">("shots"),
    [scope, setScope] = useState("all");
  const projects = Object.values(d.projects).filter((p) => !p.unfiled);
  const episodes = Object.values(d.episodes).filter((e) => !e.archived);
  const scenes = Object.values(d.scenes).filter(
    (s) =>
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
    navigate(`/projects/${ep.projectId}/episodes/${ep.id}?shot=${id}`);
  };
  const create = () => {
    if (!idea.trim()) {
      document.getElementById("story-idea")?.focus();
      return;
    }
    let result: ReturnType<typeof createHomeDraft> | undefined;
    if (
      commit(
        (data) => {
          result = createHomeDraft(data, idea, kind, pid || undefined, seconds);
        },
        `${kind[0].toUpperCase() + kind.slice(1)} draft created · 0 credits spent`,
      ) &&
      result
    ) {
      useStudio.getState().set({ inspector: kind !== "episode" });
      navigate(
        `/projects/${result.projectId}/episodes/${result.episodeId}${kind === "shot" ? `?shot=${result.shotId}` : kind === "scene" ? `?scene=${result.sceneId}` : ""}`,
      );
    }
  };
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
        aria-label="All work"
      >
        <section>
          <div className="st-section-heading">
            <h1>{scope === "unfiled" ? "Unfiled work" : "Recent work"}</h1>
            <span>
              {workType === "shots" ? shots.length : scenes.length} {workType}
            </span>
          </div>
          <div className="st-home-work-grid">
            {workType === "shots"
              ? [...shots].reverse().map((shot) => {
                  const ep = d.episodes[d.scenes[shot.sceneId].episodeId],
                    p = d.projects[ep.projectId],
                    asset = shotAsset(d, shot);
                  return (
                    <article
                      className={`st-home-work-card ${keys.includes(`shot:${shot.id}`) ? "is-selected" : ""}`}
                      data-selection-key={`shot:${shot.id}`}
                      key={shot.id}
                      tabIndex={0}
                      onClick={(e) =>
                        selectWork(`shot:${shot.id}`, e, () =>
                          openShot(shot.id),
                        )
                      }
                      onDoubleClick={() => openShot(shot.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") openShot(shot.id);
                        if (e.key === " ") {
                          e.preventDefault();
                          useSelection
                            .getState()
                            .choose(`shot:${shot.id}`, order, e);
                        }
                      }}
                      aria-label={`Shot ${shot.title}`}
                    >
                      <div>
                        {asset ? (
                          <img src={asset.url} alt="" />
                        ) : (
                          <Film size={26} />
                        )}
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
                  );
                })
              : [...scenes].reverse().map((scene) => {
                  const ep = d.episodes[scene.episodeId],
                    p = d.projects[ep.projectId],
                    shot = d.shots[scene.shotIds[0]],
                    asset = shot && shotAsset(d, shot);
                  return (
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
                  );
                })}
          </div>
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
      </SelectionSurface>
      <div className="st-composer-dock">
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
        <form
          className={`st-home-composer ${idea ? "has-content" : ""}`}
          aria-label="Create a draft"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <textarea
            id="story-idea"
            aria-label="Story idea"
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            placeholder="Describe a story, scene or shot…"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                create();
              }
            }}
          />
          <div className="st-composer-controls">
            <label>
              Create
              <select
                aria-label="Creation type"
                value={kind}
                onChange={(e) => {
                  const value = e.target.value as typeof kind;
                  setKind(value);
                  setSeconds(
                    value === "shot" ? 5 : value === "scene" ? 15 : 30,
                  );
                }}
              >
                <option value="episode">Episode</option>
                <option value="scene">Scene</option>
                <option value="shot">Shot</option>
              </select>
            </label>
            <label>
              Project
              <select
                aria-label="Story project"
                value={pid}
                onChange={(e) => setPid(e.target.value)}
              >
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Duration
              <select
                aria-label="Story duration"
                value={seconds}
                onChange={(e) => setSeconds(Number(e.target.value))}
              >
                {(kind === "shot"
                  ? [3, 5, 8, 10, 15, 20, 30]
                  : kind === "scene"
                    ? [5, 10, 15, 30]
                    : [15, 30, 60, 90]
                ).map((n) => (
                  <option key={n} value={n}>
                    {n}s
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="st-button st-primary"
              title="Create draft (⌘+Enter)"
            >
              Create {kind === "episode" ? "board" : kind} · 0 cr
              <ArrowUp size={15} />
            </button>
          </div>
        </form>
        <small className="st-composer-note">
          Drafting is free. Credits are spent when you generate media.
        </small>
      </div>
    </div>
  );
}
export function ProjectsWorkspace() {
  const d = useStore((s) => s.data),
    navigate = useNavigate();
  const [query, setQuery] = useState("");
  const projects = Object.values(d.projects).filter(
    (p) => !p.unfiled && p.title.toLowerCase().includes(query.toLowerCase()),
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
  const shots = shotsOfEpisode(d, id),
    asset = shots[0] ? shotAsset(d, shots[0]) : undefined;
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
        className={`st-episode-tile ${selected ? "is-selected" : ""}`}
        data-selection-key={`episode:${id}`}
        aria-label={`Episode ${ep.title}`}
        onClick={(e) =>
          useSelection.getState().choose(
            `episode:${id}`,
            Object.keys(d.episodes).map((id) => `episode:${id}` as EntityKey),
            e,
          )
        }
        onDoubleClick={() =>
          navigate(`/projects/${ep.projectId}/episodes/${id}`)
        }
      >
        <div className="st-episode-cover">
          <img src={asset?.url ?? d.projects[ep.projectId].cover} alt="" />
          <span>
            {ep.creationKind === "shot"
              ? "Shot"
              : ep.creationKind === "scene"
                ? "Scene"
                : `${shots.length} shots`}
          </span>
        </div>
        <div className="st-episode-tile-copy">
          <b>{ep.title}</b>
          <p>
            {ep.sceneIds.length} scenes · {ep.targetSeconds}s
          </p>
          <div>
            <span>
              {shots.filter((s) => s.currentTakeId).length} Video ·{" "}
              {shots.filter((s) => s.imageTakeId && !s.currentTakeId).length}{" "}
              Still
            </span>
            <Link
              className="st-text-button"
              to={`/projects/${ep.projectId}/episodes/${id}`}
            >
              Open ↗
            </Link>
          </div>
        </div>
      </article>
    </CommandMenu>
  );
}
export function ProjectWorkspace() {
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
    <div className="st-project-page">
      <SelectionSurface
        className="st-panel-scroll st-project-content"
        aria-label="Episode cards"
      >
        <div className="st-section-heading">
          <div className="st-project-heading">
            <span>Episodes</span>
            <h1>
              <input
                aria-label="Project name"
                defaultValue={p.title}
                key={p.id}
                onBlur={(e) => {
                  if (e.target.value !== p.title)
                    commit((data) => {
                      renameWorkspaceProject(data, projectId, e.target.value);
                    }, "Project renamed");
                }}
              />
            </h1>
          </div>
          <CommandButton id="new.episode">
            <Plus size={13} />
            New episode
          </CommandButton>
        </div>
        <div className="st-episode-grid">
          {p.episodeIds
            .filter((id) => !d.episodes[id].archived)
            .map((id) => (
              <EpisodeTile key={id} id={id} />
            ))}
        </div>
        {p.episodeIds.every((id) => d.episodes[id].archived) && (
          <div className="st-empty">
            <p>No episodes</p>
            <CommandButton id="new.episode" />
          </div>
        )}
      </SelectionSurface>
    </div>
  );
}
