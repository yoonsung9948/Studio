import {
  Component,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import {
  Activity,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  Command,
  Download,
  Film,
  FolderOpen,
  Images,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  Sun,
  Users,
  X,
} from "lucide-react";
import { useStore } from "../stores/store";
import { active } from "../domain/selectors";
import { generationService } from "../services/mock";
import { Button } from "../components/ui/button";
import { Tip } from "../components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { ActionsProvider, useActions } from "../components/Actions";
import { Episodes, NotFound, Projects, SearchBox } from "../features/Gallery";
import { EpisodePage } from "../features/Episode";
import { SceneWorkspace } from "../features/SceneWorkspace";
import { Editor } from "../features/Editor";
import { RightPanel } from "../features/RightPanel";
import { CharacterLibrary } from "../features/characters/CharacterLibrary";
import { CharacterDetail } from "../features/characters/CharacterDetail";
import { SceneSetupWorkspace } from "../features/setup/SceneSetup";
import {
  Assets,
  Bible,
  Exports,
  Queue,
  Settings,
} from "../features/Supporting";
import { ProfileMenu, ProfileSettings } from "../features/account/Profile";

function Logo() {
  return (
    <Link to="/projects" className="logo" aria-label="dotori studio projects">
      <span className="logo-mark">
        <i />
        <i />
        <i />
      </span>
      <span>
        dotori<span className="logo-period">.</span>
        <small>studio</small>
      </span>
    </Link>
  );
}
class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <div className="empty">
        <h1>Something interrupted this scene.</h1>
        <p>Your locally saved work is still on this device.</p>
        <Button onClick={() => window.location.assign("/projects")}>
          Return to projects
        </Button>
      </div>
    ) : (
      this.props.children
    );
  }
}
function Shell() {
  const location = useLocation();
  const parts = location.pathname.split("/").filter(Boolean);
  const projectId = parts[0] === "projects" ? parts[1] : undefined;
  const episodeId = parts[2] === "episodes" ? parts[3] : undefined;
  const sceneId = parts[4] === "scenes" ? parts[5] : undefined;
  const d = useStore((s) => s.data),
    ui = useStore((s) => s.ui),
    setUI = useStore((s) => s.setUI),
    notice = useStore((s) => s.notice);
  const storageFailed = useStore((s) => s.storageFailed);
  const project = projectId ? d.projects[projectId] : undefined;
  const episode = episodeId ? d.episodes[episodeId] : undefined;
  const scene = sceneId ? d.scenes[sceneId] : undefined;
  const [queue, setQueue] = useState(false);
  const [mobileAI, setMobileAI] = useState(false);
  const directorPanel = usePanelRef();
  const [nav, setNav] = useState(false);
  const [commands, setCommands] = useState(false);
  const [search, setSearch] = useState("");
  const [outline, setOutline] = useState(true);
  const [narrow, setNarrow] = useState(window.innerWidth < 1100);
  const modal = useActions();
  useEffect(() => {
    if (narrow || !projectId) return;
    if (ui.aiOpen) directorPanel.current?.expand();
    else directorPanel.current?.collapse();
  }, [ui.aiOpen, narrow, projectId, directorPanel]);

  const jobs = Object.values(d.jobs).filter(
    (j) => (!project || j.projectId === projectId) && active(j),
  );
  const running = jobs.filter((j) => j.state === "running").length;
  const waiting = jobs.filter((j) => j.state === "waiting").length;
  const completed = Object.values(d.jobs).filter(
    (j) => j.state === "succeeded",
  ).length;
  useEffect(() => generationService.start(), []);
  useEffect(() => {
    document.documentElement.dataset.theme = ui.theme;
  }, [ui.theme]);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1099px)");
    const change = () => setNarrow(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    setNav(false);
    setMobileAI(false);
  }, [location.pathname]);
  useEffect(() => {
    if (!ui.aiOpen) setMobileAI(false);
  }, [ui.aiOpen]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLElement &&
        (e.target.matches("input,textarea,select") ||
          e.target.isContentEditable)
      )
        return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommands((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) useStore.getState().redo();
        else useStore.getState().undo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  const sidebar = (
    <>
      <div className="sidebar-top">
        <Logo />
        <Tip label={ui.collapsed ? "Expand navigation" : "Collapse navigation"}>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Toggle sidebar"
            onClick={() => setUI({ collapsed: !ui.collapsed })}
          >
            {ui.collapsed ? (
              <PanelLeftOpen size={16} />
            ) : (
              <PanelLeftClose size={16} />
            )}
          </Button>
        </Tip>
      </div>
      {project ? (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger className="project-switch">
              <span className="project-mini">
                <img src={project.cover} alt="" />
              </span>
              <span className="nav-label">
                <b>{project.title}</b>
                <small>Personal workspace</small>
              </span>
              <ChevronDown className="nav-label" size={14} />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem asChild>
                <Link to="/projects">All projects</Link>
              </DropdownMenuItem>
              {Object.values(d.projects).map((p) => (
                <DropdownMenuItem key={p.id} asChild>
                  <Link to={`/projects/${p.id}/episodes`}>{p.title}</Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <nav className="navigation">
            <div className="nav-section-label">WORKSPACE</div>
            <NavLink
              to={`/projects/${project.id}/episodes`}
              className="nav-link"
            >
              <Clapperboard size={17} />
              <span className="nav-label">Episodes</span>
              <span className="nav-count nav-label">
                {project.episodeIds.length}
              </span>
            </NavLink>
            {episode && (
              <div className="episode-outline nav-label">
                <button onClick={() => setOutline(!outline)}>
                  <ChevronDown
                    size={12}
                    style={{ transform: outline ? "" : "rotate(-90deg)" }}
                  />
                  {episode.title}
                </button>
                {outline &&
                  episode.sceneIds.map((id, i) => (
                    <NavLink
                      key={id}
                      to={`/projects/${project.id}/episodes/${episode.id}/scenes/${id}`}
                    >
                      <span>{String(i + 1).padStart(2, "0")}</span>
                      {d.scenes[id]?.title}
                    </NavLink>
                  ))}
              </div>
            )}
            <div className="nav-section-label">STORY</div>
            <NavLink
              to={`/projects/${project.id}/characters`}
              className="nav-link"
            >
              <Users size={17} />
              <span className="nav-label">Characters</span>
            </NavLink>
            <NavLink to={`/projects/${project.id}/bible`} className="nav-link">
              <BookOpen size={17} />
              <span className="nav-label">Story Bible</span>
            </NavLink>
            <div className="nav-section-label">LIBRARY</div>
            <NavLink to={`/projects/${project.id}/assets`} className="nav-link">
              <Images size={17} />
              <span className="nav-label">Assets</span>
            </NavLink>
            <div className="nav-section-label">PRODUCTION</div>
            <NavLink to={`/projects/${project.id}/queue`} className="nav-link">
              <Activity size={17} />
              <span className="nav-label">Generation Queue</span>
              {jobs.length > 0 && (
                <span className="nav-count nav-label">{jobs.length}</span>
              )}
            </NavLink>
            <NavLink
              to={`/projects/${project.id}/exports`}
              className="nav-link"
            >
              <Download size={17} />
              <span className="nav-label">Exports</span>
            </NavLink>
          </nav>
        </>
      ) : (
        <nav className="navigation">
          <div className="nav-section-label">WORKSPACE</div>
          <NavLink to="/projects" className="nav-link">
            <FolderOpen size={17} />
            <span className="nav-label">All projects</span>
            <span className="nav-count nav-label">
              {Object.keys(d.projects).length}
            </span>
          </NavLink>
          <div className="sidebar-intro nav-label">
            <span className="eyebrow">MADE FOR YOUR STORIES</span>
            <p>
              A little idea.
              <br />A whole new world.
            </p>
            <span>One scene at a time.</span>
          </div>
        </nav>
      )}
      <div className="sidebar-bottom">
        {project && (
          <NavLink to={`/projects/${project.id}/settings`} className="nav-link">
            <Settings2 size={17} />
            <span className="nav-label">Project Settings</span>
          </NavLink>
        )}
        <ProfileMenu />
        <div className="sidebar-bottom-row">
          <span className="demo-label nav-label">
            <span />
            Demo mode
          </span>
          <Tip label="Toggle color theme">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Toggle color theme"
              onClick={() =>
                setUI({ theme: ui.theme === "dark" ? "light" : "dark" })
              }
            >
              {ui.theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </Button>
          </Tip>
        </div>
        <button
          className="command-trigger nav-label"
          onClick={() => setCommands(true)}
        >
          <Command size={13} />
          Quick navigation <kbd>⌘ K</kbd>
        </button>
      </div>
    </>
  );
  useEffect(() => {
    const open = () => {
      setUI({ aiOpen: true });
      setMobileAI(true);
    };
    window.addEventListener("dotori-studio-open-panel", open);
    return () => window.removeEventListener("dotori-studio-open-panel", open);
  }, [setUI]);
  const routes = (
    <ErrorBoundary key={location.pathname}>
      <Routes>
        <Route path="/" element={<Navigate to="/projects" replace />} />
        <Route path="/app" element={<Navigate to="/projects" replace />} />
        <Route path="/profile/settings" element={<ProfileSettings />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:projectId/episodes" element={<Episodes />} />
        <Route
          path="/projects/:projectId/episodes/:episodeId"
          element={<EpisodePage />}
        />
        <Route
          path="/projects/:projectId/episodes/:episodeId/scenes/:sceneId"
          element={<SceneWorkspace />}
        />
        <Route
          path="/projects/:projectId/episodes/:episodeId/scenes/:sceneId/edit"
          element={<Editor />}
        />
        <Route
          path="/projects/:projectId/characters"
          element={project ? <CharacterLibrary /> : <NotFound />}
        />
        <Route
          path="/projects/:projectId/characters/:characterId"
          element={<CharacterDetail />}
        />
        <Route
          path="/projects/:projectId/episodes/:episodeId/scenes/:sceneId/setup"
          element={<SceneSetupWorkspace />}
        />
        <Route path="/projects/:projectId/bible" element={<Bible />} />
        <Route
          path="/projects/:projectId/assets"
          element={project ? <Assets /> : <NotFound />}
        />
        <Route
          path="/projects/:projectId/queue"
          element={project ? <Queue /> : <NotFound />}
        />
        <Route
          path="/projects/:projectId/exports"
          element={project ? <Exports /> : <NotFound />}
        />
        <Route path="/projects/:projectId/settings" element={<Settings />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </ErrorBoundary>
  );
  return (
    <div className={`app-shell ${ui.collapsed ? "sidebar-collapsed" : ""}`}>
      <aside
        className="sidebar"
        style={
          {
            "--sidebar-width": `${ui.layouts.sidebar?.width ?? 226}px`,
          } as CSSProperties
        }
      >
        {sidebar}
        {!ui.collapsed && (
          <div
            role="separator"
            aria-label="Resize sidebar"
            aria-orientation="vertical"
            aria-valuemin={200}
            aria-valuemax={300}
            aria-valuenow={ui.layouts.sidebar?.width ?? 226}
            tabIndex={0}
            className="sidebar-resize"
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                e.preventDefault();
                setUI({
                  layouts: {
                    ...ui.layouts,
                    sidebar: {
                      width: Math.max(
                        200,
                        Math.min(
                          300,
                          (ui.layouts.sidebar?.width ?? 226) +
                            (e.key === "ArrowRight" ? 10 : -10),
                        ),
                      ),
                    },
                  },
                });
              }
            }}
            onPointerDown={(e) => {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId))
                setUI({
                  layouts: {
                    ...useStore.getState().ui.layouts,
                    sidebar: { width: Math.max(200, Math.min(300, e.clientX)) },
                  },
                });
            }}
            onPointerUp={(e) =>
              e.currentTarget.releasePointerCapture(e.pointerId)
            }
          />
        )}
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <Button
            className="mobile-nav"
            size="icon"
            variant="ghost"
            aria-label="Open navigation"
            onClick={() => setNav(true)}
          >
            <Menu size={18} />
          </Button>
          <div className="breadcrumbs">
            <Link to="/projects">Workspace</Link>
            {project && (
              <>
                <ChevronRight size={12} />
                <Link to={`/projects/${project.id}/episodes`}>
                  {project.title}
                </Link>
              </>
            )}
            {episode && (
              <>
                <ChevronRight size={12} />
                <Link to={`/projects/${projectId}/episodes/${episode.id}`}>
                  Episode {project?.episodeIds.indexOf(episode.id)! + 1}
                </Link>
              </>
            )}
            {scene && (
              <>
                <ChevronRight size={12} />
                <span>{scene.title}</span>
              </>
            )}
          </div>
          <div className="topbar-controls">
            <span className="local-save">
              <Check size={12} />
              {storageFailed ? "Session only" : "Saved locally"}
            </span>
            <Button
              variant="ghost"
              className="activity-button"
              onClick={() => setQueue(true)}
            >
              <Activity size={14} />
              <span>
                {jobs.length
                  ? `${running} running${waiting ? " · " + waiting + " waiting" : ""}`
                  : "Activity"}
                {jobs.length > 0 && !running && !waiting
                  ? " · " + jobs.length + " queued"
                  : ""}
              </span>
            </Button>
            <span className="credits">
              <span>✧</span>
              {d.credits.toLocaleString()}
              <small>demo cr</small>
            </span>
            {episode ? (
              <Button
                variant="default"
                aria-label="Export episode"
                onClick={() => modal({ kind: "export", episodeId: episode.id })}
              >
                <Download size={14} aria-hidden="true" />
                <span className="export-label">Export</span>
              </Button>
            ) : project ? (
              <Button asChild variant="default">
                <Link to={`/projects/${project.id}/exports`}>
                  <Download size={14} aria-hidden="true" />
                  <span className="export-label">Export</span>
                </Link>
              </Button>
            ) : null}
          </div>
        </header>
        {useStore((s) => s.paused) && (
          <div className="recovery-banner">
            Unfinished demo jobs were recovered. They are paused.{" "}
            <Button size="sm" onClick={() => generationService.resume()}>
              Resume generation
            </Button>
          </div>
        )}
        <div className="workspace-body">
          {project && !narrow ? (
            <Group
              className="director-workspace"
              orientation="horizontal"
              defaultLayout={
                ui.aiOpen ? ui.layouts.workspace : { work: 100, director: 0 }
              }
              onLayoutChanged={(layout) =>
                useStore.getState().ui.aiOpen &&
                setUI({
                  layouts: {
                    ...useStore.getState().ui.layouts,
                    workspace: layout,
                  },
                })
              }
            >
              <Panel id="work" minSize="45%" defaultSize="72%">
                <main className="working-area">{routes}</main>
              </Panel>
              <Separator
                disabled={!ui.aiOpen}
                className={`resize-handle ${ui.aiOpen ? "" : "director-divider-hidden"}`}
              />
              <Panel
                id="director"
                className="director-panel"
                panelRef={directorPanel}
                collapsible
                collapsedSize={0}
                minSize="280px"
                maxSize="520px"
                defaultSize={ui.aiOpen ? "350px" : 0}
              >
                {ui.aiOpen && (
                  <RightPanel
                    projectId={project.id}
                    episodeId={episode?.id}
                    sceneId={scene?.id}
                  />
                )}
              </Panel>
            </Group>
          ) : (
            <main className="working-area">{routes}</main>
          )}
        </div>
      </div>
      <Dialog open={queue} onOpenChange={setQueue}>
        <DialogContent className="sheet">
          <DialogTitle>Generation activity</DialogTitle>
          <DialogDescription>
            Demo jobs across your workspace.
          </DialogDescription>
          <Queue projectId={project?.id} compact />
          {project && (
            <Button asChild>
              <Link
                onClick={() => setQueue(false)}
                to={`/projects/${project.id}/queue`}
              >
                Open full queue
                <ChevronRight size={14} />
              </Link>
            </Button>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={nav} onOpenChange={setNav}>
        <DialogContent className="nav-sheet">
          <DialogTitle className="sr-only">Project navigation</DialogTitle>
          <DialogDescription className="sr-only">
            Navigate your local studio.
          </DialogDescription>
          {sidebar}
        </DialogContent>
      </Dialog>
      <Dialog open={narrow && !!project && mobileAI} onOpenChange={setMobileAI}>
        {project && (
          <DialogContent className="sheet ai-sheet">
            <DialogTitle className="sr-only">AI Director</DialogTitle>
            <DialogDescription className="sr-only">
              Demo creative assistant
            </DialogDescription>
            <RightPanel
              projectId={project.id}
              episodeId={episode?.id}
              sceneId={scene?.id}
            />
          </DialogContent>
        )}
      </Dialog>
      <Dialog open={commands} onOpenChange={setCommands}>
        <DialogContent>
          <DialogTitle>Go to a story</DialogTitle>
          <DialogDescription>
            Projects, episodes, and studio commands.
          </DialogDescription>
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Search projects and episodes"
          />
          <div className="command-results">
            {Object.values(d.projects)
              .filter((p) =>
                p.title.toLowerCase().includes(search.toLowerCase()),
              )
              .map((p) => (
                <Link
                  key={p.id}
                  to={`/projects/${p.id}/episodes`}
                  onClick={() => setCommands(false)}
                >
                  <FolderOpen size={16} />
                  {p.title}
                </Link>
              ))}
            {Object.values(d.episodes)
              .filter((e) =>
                e.title.toLowerCase().includes(search.toLowerCase()),
              )
              .map((e) => (
                <Link
                  key={e.id}
                  to={`/projects/${e.projectId}/episodes/${e.id}`}
                  onClick={() => setCommands(false)}
                >
                  <Film size={16} />
                  {e.title}
                </Link>
              ))}
            <Button
              variant="ghost"
              onClick={() => {
                setCommands(false);
                setQueue(true);
              }}
            >
              View generation queue
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                useStore.getState().undo();
                setCommands(false);
              }}
            >
              Undo last local edit
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {notice && (
        <div className="toast" role="alert">
          <span>{notice}</span>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Dismiss notification"
            onClick={() => useStore.getState().setNotice("")}
          >
            <X size={15} />
          </Button>
        </div>
      )}
      <div className="sr-only" role="status" aria-live="polite">
        {completed} demo jobs completed.{" "}
        {Object.values(d.jobs).filter((j) => j.state === "failed").length}{" "}
        failed jobs.
      </div>
    </div>
  );
}
export function App() {
  return (
    <ActionsProvider>
      <Shell />
    </ActionsProvider>
  );
}
