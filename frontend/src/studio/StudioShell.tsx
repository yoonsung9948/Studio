import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Home,
  Clapperboard,
  Globe2,
  Images,
  Activity,
  Command,
  CircleUserRound,
  Settings2,
  PanelLeftOpen,
  PanelLeftClose,
  Folder,
  ChevronDown,
  ChevronRight,
  X,
} from "lucide-react";
import { BrandMark, BrandWordmark } from "../components/Brand";
import { useStore } from "../stores/store";
import { useAccount } from "../stores/account";
import { generationService } from "../services/mock";
import { cancelJob } from "../domain/commands";
import { active } from "../domain/selectors";
import {
  createWorkspaceEpisode,
  setStrictApprovals,
  retryWorkspaceJob,
} from "../domain/workspace";
import {
  CommandButton,
  useRegisterCommands,
  type StudioCommand,
  useCommands,
} from "./commands";
import { commit } from "./generation";
import { useSelection, useStudio, type WorkspaceView } from "./selection";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../components/ui/dropdown-menu";
import { RechargeDialog } from "../features/account/Profile";
export function StudioShell({ children }: { children: ReactNode }) {
  const d = useStore((s) => s.data),
    ui = useStore((s) => s.ui),
    notice = useStore((s) => s.notice),
    paused = useStore((s) => s.paused),
    navigate = useNavigate(),
    location = useLocation(),
    navigation = useStudio((s) => s.navigation),
    activity = useStudio((s) => s.activity),
    settings = useStudio((s) => s.settings),
    profile = useAccount((s) => s.profile);
  const [recharge, setRecharge] = useState(false);
  const navigationRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!navigation) return;
    const collapseOutside = (event: MouseEvent) => {
      if (
        event.target instanceof Node &&
        !navigationRef.current?.contains(event.target)
      )
        useStudio.getState().set({ navigation: false });
    };
    document.addEventListener("click", collapseOutside, true);
    return () => document.removeEventListener("click", collapseOutside, true);
  }, [navigation]);
  const account = useStudio((s) => s.account);
  const setAccount = (account: boolean) =>
    useStudio.getState().set({ account });
  const parts = location.pathname.split("/").filter(Boolean),
    pid = parts[0] === "projects" ? parts[1] : undefined,
    eid = parts[2] === "episodes" ? parts[3] : undefined,
    project = pid ? d.projects[pid] : undefined;
  const target = project && !project.unfiled ? project.id : undefined;
  const [expandedProjects, setExpandedProjects] = useState<string[]>([]);
  const { execute } = useCommands();
  const projectPage = !!target || location.pathname === "/projects/browse";
  const currentSection = parts[2] ?? "episodes";
  useEffect(() => {
    if (target) {
      setExpandedProjects((ids) =>
        ids.includes(target) ? ids : [...ids, target],
      );
    }
  }, [target]);
  const openProject = (id: string) => {
    setExpandedProjects((ids) => (ids.includes(id) ? ids : [...ids, id]));
    navigate(`/projects/${id}/episodes`);
  };
  const commands = useMemo<StudioCommand[]>(
    () => [
      {
        id: "navigation",
        label: navigation ? "Collapse navigation" : "Expand navigation",
        shortcut: "Mod+\\",
        run: () =>
          useStudio
            .getState()
            .set({ navigation: !useStudio.getState().navigation }),
      },
      {
        id: "home",
        label: "Home",
        shortcut: "Mod+1",
        run: () => navigate("/projects"),
      },
      {
        id: "projects",
        label: "Projects",
        shortcut: "Mod+2",
        run: () => navigate("/projects/browse"),
      },
      ...(target
        ? [
            {
              id: "project.episodes",
              label: "Episodes",
              shortcut: "Mod+3",
              run: () => navigate(`/projects/${target}/episodes`),
            },
            {
              id: "project.world",
              label: "World",
              shortcut: "Mod+4",
              run: () => navigate(`/projects/${target}/world`),
            },
            {
              id: "project.library",
              label: "Library",
              shortcut: "Mod+5",
              run: () => navigate(`/projects/${target}/library`),
            },
          ]
        : []),
      {
        id: "activity",
        label: "Activity",
        shortcut: "j",
        run: () =>
          useStudio
            .getState()
            .set({ activity: !useStudio.getState().activity }),
      },
      {
        id: "palette",
        label: "Commands",
        shortcut: "Mod+k",
        run: () => useStudio.getState().set({ palette: true }),
      },
      {
        id: "preferences",
        label: "Settings & preferences",
        shortcut: "Mod+,",
        run: () => useStudio.getState().set({ settings: true }),
      },
      {
        id: "undo",
        label: "Undo",
        shortcut: "Mod+z",
        run: () => useStore.getState().undo(),
      },
      {
        id: "redo",
        label: "Redo",
        shortcut: "Mod+Shift+z",
        run: () => useStore.getState().redo(),
      },
      {
        id: "inspector",
        label: "Toggle inspector",
        shortcut: "i",
        run: () =>
          useStudio
            .getState()
            .set({ inspector: !useStudio.getState().inspector }),
      },
      ...(target
        ? [
            {
              id: "new.episode",
              label: "New episode",
              run: () => {
                let id = "";
                if (
                  target &&
                  commit((data) => {
                    id = createWorkspaceEpisode(data, target, "");
                  }, "Episode created")
                )
                  navigate(`/projects/${target}/episodes/${id}`);
              },
            },
          ]
        : []),
      ...(["board", "script", "timeline", "review"] as WorkspaceView[]).map(
        (name, i) => ({
          id: `view.${name}`,
          label: `${name[0].toUpperCase() + name.slice(1)} view`,
          shortcut: String(i + 1),
          run: () => useStudio.getState().set({ view: name }),
        }),
      ),
    ],
    [target, navigate, navigation],
  );
  useRegisterCommands("shell", commands);
  useEffect(() => generationService.start(), []);
  useEffect(() => {
    document.documentElement.dataset.theme = ui.theme;
    document.body.classList.add("studio-active");
    // Cover portalled dialogs and menus too, without stopping app menu handlers.
    const suppressBrowserMenu = (event: MouseEvent) => event.preventDefault();
    document.addEventListener("contextmenu", suppressBrowserMenu);
    return () => {
      document.body.classList.remove("studio-active");
      document.removeEventListener("contextmenu", suppressBrowserMenu);
    };
  }, [ui.theme]);
  useEffect(() => {
    const open = () =>
      useStudio.getState().set({ inspector: true, inspectorTab: "director" });
    window.addEventListener("dotori-studio-open-panel", open);
    return () => window.removeEventListener("dotori-studio-open-panel", open);
  }, []);
  const jobs = Object.values(d.jobs).filter((j) => !pid || j.projectId === pid),
    running = jobs.filter(active).length;
  return (
    <div
      className={`studio-shell density-${ui.density ?? "comfortable"} ${navigation ? "navigation-expanded" : ""}`}
    >
      <aside
        ref={navigationRef}
        className="st-rail"
        aria-label="Studio navigation"
      >
        <div className="st-rail-header">
          <span className="st-brand" title="dotori studio">
            {navigation ? <BrandWordmark /> : <BrandMark />}
          </span>
          <CommandButton id="navigation" icon>
            {navigation ? (
              <PanelLeftClose size={17} />
            ) : (
              <PanelLeftOpen size={17} />
            )}
          </CommandButton>
        </div>
        <CommandButton id="home" icon current={!projectPage}>
          <Home size={18} />
          <span className="st-rail-label">Home</span>
        </CommandButton>
        <CommandButton
          id="projects"
          icon
          current={location.pathname === "/projects/browse"}
        >
          <Folder size={18} />
          <span className="st-rail-label">Projects</span>
        </CommandButton>
        {navigation && projectPage ? (
          <nav className="st-project-tree" aria-label="Project hierarchy">
            {Object.values(d.projects)
              .filter((p) => !p.unfiled)
              .map((p) => (
                <div key={p.id} className="st-project-tree-item">
                  <div className="st-project-tree-heading">
                    <button
                      className="st-icon"
                      aria-label={`${expandedProjects.includes(p.id) ? "Collapse" : "Expand"} ${p.title}`}
                      aria-expanded={expandedProjects.includes(p.id)}
                      onClick={() =>
                        setExpandedProjects((ids) =>
                          ids.includes(p.id)
                            ? ids.filter((id) => id !== p.id)
                            : [...ids, p.id],
                        )
                      }
                    >
                      {expandedProjects.includes(p.id) ? (
                        <ChevronDown size={12} />
                      ) : (
                        <ChevronRight size={12} />
                      )}
                    </button>
                    <button
                      aria-label={`Open project ${p.title}`}
                      aria-current={
                        target === p.id && !expandedProjects.includes(p.id)
                          ? "page"
                          : undefined
                      }
                      onClick={() => openProject(p.id)}
                    >
                      <span>{p.title}</span>
                    </button>
                  </div>
                  {expandedProjects.includes(p.id) && (
                    <nav aria-label={`${p.title} navigation`}>
                      {[
                        {
                          id: "episodes",
                          label: "Episodes",
                          icon: Clapperboard,
                        },
                        { id: "world", label: "World", icon: Globe2 },
                        { id: "library", label: "Library", icon: Images },
                      ].map((item) => (
                        <button
                          key={item.id}
                          aria-current={
                            target === p.id && currentSection === item.id
                              ? "page"
                              : undefined
                          }
                          onClick={() => {
                            if (target === p.id) execute(`project.${item.id}`);
                            else navigate(`/projects/${p.id}/${item.id}`);
                          }}
                        >
                          <item.icon size={14} />
                          {item.label}
                        </button>
                      ))}
                    </nav>
                  )}
                </div>
              ))}
            {!Object.values(d.projects).some((p) => !p.unfiled) && (
              <p>No projects yet</p>
            )}
          </nav>
        ) : !navigation && target ? (
          <nav
            className="st-project-rail"
            aria-label={`${project?.title} navigation`}
          >
            <CommandButton
              id="project.episodes"
              icon
              current={currentSection === "episodes"}
            >
              <Clapperboard size={16} />
            </CommandButton>
            <CommandButton
              id="project.world"
              icon
              current={currentSection === "world"}
            >
              <Globe2 size={16} />
            </CommandButton>
            <CommandButton
              id="project.library"
              icon
              current={currentSection === "library"}
            >
              <Images size={16} />
            </CommandButton>
          </nav>
        ) : null}
        <div className="st-rail-spacer" />
        <CommandButton id="activity" icon>
          <Activity size={18} />
          <span className="st-rail-label">Activity</span>
          {running > 0 && <span className="st-rail-dot" />}
        </CommandButton>
        <CommandButton id="palette" icon>
          <Command size={17} />
          <span className="st-rail-label">Commands</span>
        </CommandButton>
        <CommandButton id="preferences" icon>
          <Settings2 size={17} />
          <span className="st-rail-label">Settings</span>
        </CommandButton>
      </aside>
      <div className="st-app-body">
        <header className="st-topbar" aria-label="Account and credits">
          <div className="st-topbar-actions">
            <span
              className="st-credits"
              aria-label={`${d.credits.toLocaleString()} credits remaining`}
            >
              ✧ {d.credits.toLocaleString()}
              <small>cr</small>
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger className="st-icon" aria-label="Account">
                <CircleUserRound size={21} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <div className="st-account-summary">
                  <CircleUserRound size={30} />
                  <b>{profile.fullName}</b>
                  <span>
                    {profile.tier} · {d.credits.toLocaleString()} cr
                  </span>
                </div>
                <DropdownMenuItem onSelect={() => setRecharge(true)}>
                  Recharge credits
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setAccount(true)}>
                  Account settings
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    useAccount.getState().signOut();
                    navigate("/login");
                  }}
                >
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        {paused && (
          <div className="st-recovery">
            Recovered jobs are paused.
            <button
              className="st-text-button"
              onClick={() => generationService.resume()}
            >
              Resume
            </button>
          </div>
        )}
        <main className="st-app-content">{children}</main>
        <section
          className={`st-activity ${activity ? "is-open" : ""}`}
          aria-label="Activity tray"
        >
          <button
            className="st-activity-toggle"
            aria-expanded={activity}
            onClick={() => useStudio.getState().set({ activity: !activity })}
          >
            <Activity size={13} />
            <span>Activity</span>
            <span>{running} generating</span>
            <span>
              {jobs.filter((j) => j.state === "failed").length} failed
            </span>
            <small>{activity ? "⌄" : "⌃"}</small>
          </button>
          {activity && (
            <div className="st-activity-jobs">
              {!jobs.length && <p>No jobs</p>}
              {[...jobs].reverse().map((j) => (
                <div key={j.id}>
                  <span className={`st-job-dot ${j.state}`} />
                  <span>{d.shots[j.shotId]?.title ?? "World image"}</span>
                  <span>{j.operation === "image" ? "Still" : "Video"}</span>
                  <span>
                    {active(j)
                      ? `Generating · ${j.progress ?? 0}%`
                      : j.state === "failed"
                        ? "Failed"
                        : j.state === "succeeded"
                          ? j.operation === "image"
                            ? "Still"
                            : "Video"
                          : "Draft"}
                  </span>
                  {j.error && <span className="st-job-error">{j.error}</span>}
                  <small>{j.cost} cr</small>
                  {active(j) ? (
                    <button
                      className="st-text-button"
                      onClick={() =>
                        commit(
                          (data) => cancelJob(data, j.id),
                          "Job canceled",
                          false,
                        )
                      }
                    >
                      Cancel
                    </button>
                  ) : ["failed", "canceled"].includes(j.state) ? (
                    <button
                      className="st-text-button"
                      onClick={() =>
                        commit(
                          (data) => retryWorkspaceJob(data, j.id),
                          "Retry submitted",
                          false,
                        )
                      }
                    >
                      Retry · {j.cost} cr
                    </button>
                  ) : null}
                  <button
                    className="st-text-button"
                    onClick={() => {
                      if (j.target) {
                        const worldId =
                          j.target.kind === "look"
                            ? d.studio.looks[j.target.id]?.characterId
                            : j.target.kind === "reference"
                              ? d.studio.references[j.target.id]?.characterId
                              : j.target.id;
                        navigate(
                          `/projects/${j.projectId}/world?kind=${j.target.kind === "location" ? "place" : "character"}&id=${worldId ?? j.target.id}`,
                        );
                        return;
                      }
                      if (eid !== j.episodeId)
                        navigate(
                          `/projects/${j.projectId}/episodes/${j.episodeId}`,
                        );
                      useSelection.getState().replace([`shot:${j.shotId}`]);
                      useStudio
                        .getState()
                        .set({ inspector: true, view: "board" });
                    }}
                  >
                    Show
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      <Dialog
        open={settings}
        onOpenChange={(settings) => useStudio.getState().set({ settings })}
      >
        <DialogContent className="st-dialog">
          <DialogTitle>Settings & preferences</DialogTitle>
          <DialogDescription>
            Workspace preferences and project generation policy.
          </DialogDescription>
          <label className="st-field">
            Density
            <select
              aria-label="Density"
              value={ui.density ?? "comfortable"}
              onChange={(e) =>
                useStore.getState().setUI({
                  density: e.target.value as "comfortable" | "compact",
                })
              }
            >
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </label>
          <label className="st-field">
            Appearance
            <select
              aria-label="Appearance"
              value={ui.theme}
              onChange={(e) =>
                useStore
                  .getState()
                  .setUI({ theme: e.target.value as "light" | "dark" })
              }
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>
          {project && (
            <label className="st-check">
              <input
                type="checkbox"
                checked={!!project.strictApprovals}
                onChange={(e) =>
                  commit(
                    (data) =>
                      setStrictApprovals(data, project.id, e.target.checked),
                    "Approval policy updated",
                  )
                }
              />
              Strict script and plan approvals
            </label>
          )}
          <p className="st-muted">
            Approvals are off by default. Local storyboard generation; no
            external AI or payment service is connected.
          </p>
        </DialogContent>
      </Dialog>
      <Dialog open={account} onOpenChange={setAccount}>
        <DialogContent className="st-dialog">
          <DialogTitle>Account</DialogTitle>
          <DialogDescription>
            {profile.tier} · {d.credits.toLocaleString()} credits
          </DialogDescription>
          <label className="st-field">
            Full name
            <input
              aria-label="Full name"
              defaultValue={profile.fullName}
              onBlur={(e) =>
                useAccount
                  .getState()
                  .updateProfile({ ...profile, fullName: e.target.value })
              }
            />
          </label>
          <label className="st-field">
            Email
            <input
              aria-label="Email"
              defaultValue={profile.email}
              onBlur={(e) =>
                useAccount
                  .getState()
                  .updateProfile({ ...profile, email: e.target.value })
              }
            />
          </label>
          <button className="st-button" onClick={() => setRecharge(true)}>
            Recharge
          </button>
        </DialogContent>
      </Dialog>
      <RechargeDialog open={recharge} onOpenChange={setRecharge} />
      {notice && (
        <div className="st-toast" role="status">
          <span>{notice}</span>
          {useStore.getState().past.length > 0 && (
            <CommandButton id="undo">Undo</CommandButton>
          )}
          <button
            className="st-icon"
            aria-label="Dismiss notification"
            onClick={() => useStore.getState().setNotice("")}
          >
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
