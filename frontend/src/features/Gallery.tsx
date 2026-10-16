import { useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  ArrowUpRight,
  Film,
  MoreHorizontal,
  Plus,
  Search,
  LayoutGrid,
  List,
} from "lucide-react";
import { useStore } from "../stores/store";
import { Button } from "../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../components/ui/dropdown-menu";
import { useActions } from "../components/Actions";
import { uid } from "../domain/types";
import { deleteEpisode, duplicateEpisode } from "../domain/commands";
import {
  displaySeconds,
  duration,
  shotsOfEpisode,
  summary,
  exportWarnings,
} from "../domain/selectors";
import { episodeForm } from "../domain/schemas";
export function SearchBox({
  value,
  onChange,
  placeholder = "Search…",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="search">
      <Search size={15} />
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
export function NotFound() {
  return (
    <div className="empty page">
      <Film size={32} />
      <h1>This page isn’t in the script.</h1>
      <p>The project, episode, or scene may have been removed.</p>
      <Button asChild>
        <Link to="/projects">Back to projects</Link>
      </Button>
    </div>
  );
}
export function Projects() {
  const d = useStore((s) => s.data);
  const modal = useActions();
  const [search, setSearch] = useState("");
  const projects = Object.values(d.projects).filter((p) =>
    p.title.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="page projects-page">
      <div className="eyebrow">YOUR WORKSPACE</div>
      <header className="page-heading">
        <div>
          <h1>Your projects</h1>
          <p>A place for every story you want to tell.</p>
        </div>
        <Button
          variant="default"
          onClick={() =>
            modal({
              kind: "form",
              title: "New project",
              fields: [
                { key: "title", label: "Project name", value: "" },
                { key: "description", label: "Premise", value: "" },
              ],
              submit: (v, d) => {
                if (!v.title.trim()) throw Error("Add a project name.");
                const id = uid("project");
                d.projects[id] = {
                  id,
                  title: v.title.trim(),
                  description: v.description,
                  cover: "/media/discovery.svg",
                  episodeIds: [],
                  bible: "",
                  defaultDuration: 30,
                  revision: 1,
                };
              },
            })
          }
        >
          <Plus size={16} /> New project
        </Button>
      </header>
      <div className="filter-bar">
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="Search projects"
        />
        <span className="muted">
          {projects.length} projects · saved on this device
        </span>
      </div>
      <div className="project-grid">
        {projects.map((p, i) => (
          <article className="project-card" key={p.id}>
            <Link to={`/projects/${p.id}/episodes`} className="project-cover">
              <img src={p.cover} alt="Original storyboard illustration" />
              <div className="cover-type">
                {i === 0 ? "SUSPENSE / DRAMA" : "SHORT-FORM / ANTHOLOGY"}
              </div>
              <div className="cover-title">
                {p.title.split(" ").map((word, j) => (
                  <span key={j}>{word}</span>
                ))}
              </div>
              <div className="cover-foot">
                A dotori studio ORIGINAL CONCEPT <ArrowUpRight size={20} />
              </div>
            </Link>
            <div className="card-description">
              <div>
                <Link to={`/projects/${p.id}/episodes`}>
                  <h2>{p.title}</h2>
                </Link>
                <p>{p.description}</p>
                <small>
                  {p.episodeIds.length} episodes <span>·</span>{" "}
                  {p.updatedAt
                    ? `Edited ${new Date(p.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
                    : "Saved locally"}{" "}
                  · revision {p.revision}
                </small>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Actions for ${p.title}`}
                  >
                    <MoreHorizontal size={18} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    onSelect={() =>
                      modal({
                        kind: "form",
                        title: "Rename project",
                        fields: [
                          { key: "title", label: "Name", value: p.title },
                        ],
                        submit: (v, d) => {
                          if (!v.title.trim()) throw Error("Name is required.");
                          d.projects[p.id].title = v.title;
                        },
                      })
                    }
                  >
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      modal({
                        kind: "confirm",
                        title: "Delete project?",
                        description: `Delete ${p.title} and its episodes from this device?`,
                        danger: true,
                        action: (d) => {
                          for (const id of [...p.episodeIds])
                            deleteEpisode(d, id);
                          for (const a of Object.values(d.assets))
                            if (a.projectId === p.id) delete d.assets[a.id];
                          for (const c of Object.values(d.characters))
                            if (c.projectId === p.id) delete d.characters[c.id];
                          delete d.projects[p.id];
                        },
                      })
                    }
                  >
                    Delete project
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </article>
        ))}
      </div>
      {!projects.length && (
        <div className="empty">No matching projects. Start a new story.</div>
      )}
      <div className="gallery-note">
        <Film size={18} />
        <div>
          <strong>From the first idea to the final cut.</strong>
          <p>
            Develop a story, build your scenes, and find the right take. This is
            a local demo studio.
          </p>
        </div>
        <span className="badge">DEMO WORKSPACE</span>
      </div>
    </div>
  );
}
export function Episodes() {
  const navigate = useNavigate();
  const { projectId = "" } = useParams();
  const d = useStore((s) => s.data),
    mutate = useStore((s) => s.mutate);
  const p = d.projects[projectId];
  const modal = useActions();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [list, setList] = useState(false);
  if (!p) return <NotFound />;
  const eps = p.episodeIds
    .map((id) => d.episodes[id])
    .filter(
      (e) =>
        e.title.toLowerCase().includes(search.toLowerCase()) &&
        (filter === "all" ||
          (filter === "complete"
            ? !exportWarnings(d, e.id).length
            : !!exportWarnings(d, e.id).length)),
    );
  return (
    <div className="page">
      <div className="eyebrow">PROJECT / EPISODES</div>
      <header className="page-heading">
        <div>
          <h1>{p.title}</h1>
          <p>{p.description}</p>
        </div>
        <Button
          variant="default"
          onClick={() =>
            modal({
              kind: "form",
              title: "New episode",
              fields: [
                { key: "title", label: "Episode title", value: "" },
                { key: "synopsis", label: "Premise (optional)", value: "" },
                {
                  key: "targetSeconds",
                  label: "Target seconds · 9:16",
                  value: String(p.defaultDuration),
                  type: "number",
                  min: 3,
                  max: 90,
                },
              ],
              submit: (v, d) => {
                const data = episodeForm.parse(v);
                const id = uid("episode");
                d.episodes[id] = {
                  ...data,
                  id,
                  projectId,
                  sceneIds: [],
                  script: "",
                  scriptRevision: 1,
                  scriptHistory: [],
                  revision: 1,
                  timelineVersion: 1,
                };
                d.projects[projectId].episodeIds.push(id);
                navigate(`/projects/${projectId}/episodes/${id}?tab=script`);
              },
            })
          }
        >
          <Plus size={16} />
          New episode
        </Button>
      </header>
      <div className="filter-bar">
        <div className="row-actions">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Search episodes"
          />
          <select
            aria-label="Episode status"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="progress">In production</option>
            <option value="complete">Approved</option>
          </select>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={list ? "Grid view" : "List view"}
          onClick={() => setList(!list)}
        >
          {list ? <LayoutGrid size={17} /> : <List size={17} />}
        </Button>
      </div>
      <div className={`episode-grid ${list ? "list-view" : ""}`}>
        {eps.map((ep) => {
          const shots = shotsOfEpisode(d, ep.id);
          const cover = d.scenes[ep.sceneIds[0]]?.cover ?? p.cover;
          return (
            <article key={ep.id} className="episode-card">
              <Link
                className="episode-cover"
                to={`/projects/${projectId}/episodes/${ep.id}`}
              >
                <img src={cover} alt="Episode storyboard cover" />
                <span className="badge">
                  {exportWarnings(d, ep.id).length
                    ? "In production"
                    : "Approved animatic"}
                </span>
                <span className="episode-cover-number">
                  {String(p.episodeIds.indexOf(ep.id) + 1).padStart(2, "0")}
                </span>
              </Link>
              <div className="episode-info">
                <div className="episode-title-line">
                  <span className="eyebrow">
                    EPISODE{" "}
                    {String(p.episodeIds.indexOf(ep.id) + 1).padStart(2, "0")}
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Actions for ${ep.title}`}
                      >
                        <MoreHorizontal size={16} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem
                        onSelect={() =>
                          modal({
                            kind: "form",
                            title: "Rename episode",
                            fields: [
                              { key: "title", label: "Title", value: ep.title },
                            ],
                            submit: (v, d) => {
                              if (!v.title.trim())
                                throw Error("Title is required.");
                              d.episodes[ep.id].title = v.title;
                            },
                          })
                        }
                      >
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() =>
                          mutate((d) => {
                            duplicateEpisode(d, ep.id);
                          })
                        }
                      >
                        Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() =>
                          modal({
                            kind: "confirm",
                            title: "Delete episode?",
                            description:
                              "This removes its scenes, takes, and generation jobs.",
                            danger: true,
                            action: (d) => deleteEpisode(d, ep.id),
                          })
                        }
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <Link to={`/projects/${projectId}/episodes/${ep.id}`}>
                  <h2>{ep.title}</h2>
                </Link>
                <p>{ep.synopsis}</p>
                <div className="episode-stats">
                  <span>{ep.sceneIds.length} scenes</span>
                  <span>{ep.targetSeconds}s target</span>
                  <span>{displaySeconds(duration(shots))}s timeline</span>
                </div>
                <small className="production-summary">
                  {summary(d, shots) || "Start with your script"}
                </small>
              </div>
            </article>
          );
        })}
      </div>
      {!eps.length && (
        <div className="empty">
          No episodes here yet. Create one to start your story.
        </div>
      )}
    </div>
  );
}
