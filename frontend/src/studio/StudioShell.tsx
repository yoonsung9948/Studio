import { StudioNotice } from "./shell/StudioNotice";
import { useJobNotifications } from "./shell/useJobNotifications";
import { StudioNavigation } from "./shell/StudioNavigation";
import { StudioHeader } from "./shell/StudioHeader";
import { deleteCardSelection } from "../domain/card-deletion";
import { useOwnedData } from "../services/server-data";
import {
  ActivityJobCard,
  matchesActivityFilter,
  type ActivityFilter,
} from "./ActivityJobCard";
import { ServerActivity } from "./ServerActivity";
import { readAppConfiguration } from "../config";
import { useIdentity } from "../features/account/identity";
import { backendActivity } from "../services/backend-activity";
import {
  BackendActivityRow,
  PendingBackendActivityRow,
  backendActive,
} from "./BackendActivityRows";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Info, X } from "lucide-react";
import { useStore } from "../stores/store";
import { useAccount } from "../stores/account";
import { generationService } from "../services/mock";
import { restoreStoredMedia } from "../services/produce-render";
import { active } from "../domain/selectors";
import { createWorkspaceEpisode } from "../domain/workspace";
import { useRegisterCommands, type StudioCommand } from "./commands";
import { commit } from "./generation";
import { useSelection, useStudio } from "./selection";
import { produceStages, produceUrl } from "../domain/produce-route";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../components/ui/dialog";
import { useCredits } from "../services/server-data";
import { RechargeDialog } from "../features/account/Profile";
export function StudioShell({ children }: { children: ReactNode }) {
  useJobNotifications();
  const identity = useIdentity();
  const owned = useOwnedData();
  const d = useStore((s) => s.data),
    ui = useStore((s) => s.ui),
    paused = useStore((s) => s.paused),
    navigate = useNavigate(),
    location = useLocation(),
    activity = useStudio((s) => s.activity),
    settings = useStudio((s) => s.settings),
    demoProfile = useAccount((s) => s.profile);
  const profile = identity?.profile ?? demoProfile;
  const storedMedia = Object.values(d.assets)
    .filter((asset) => asset.storedBlob && (asset.missing || !asset.url))
    .map((asset) => asset.id)
    .sort()
    .join(",");
  useEffect(() => {
    void restoreStoredMedia();
  }, [storedMedia]);
  const availableCredits = useCredits();
  const [recharge, setRecharge] = useState(false);
  const account = useStudio((s) => s.account);
  const setAccount = (account: boolean) =>
    useStudio.getState().set({ account });
  const parts = location.pathname.split("/").filter(Boolean),
    pid = parts[0] === "projects" ? parts[1] : undefined,
    eid = parts[2] === "episodes" ? parts[3] : undefined,
    project = pid ? d.projects[pid] : undefined;
  const target =
    project && !project.unfiled && !project.archived ? project.id : undefined;
  const libraryPage = /(?:^|\/)(library|media)\/?$/.test(location.pathname);
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");
  const projectsHome = /^\/projects\/?$/.test(location.pathname);
  const commands = useMemo<StudioCommand[]>(
    () => [
      {
        id: "back",
        label: "Go back",
        run: () => navigate(-1),
      },
      {
        id: "home",
        label: "Home",
        shortcut: "Mod+1",
        run: () => navigate("/projects"),
      },
      {
        id: "work",
        label: "Browse all shots and scenes",
        run: () => navigate("/work"),
      },
      {
        id: "assets",
        label: "Assets",
        shortcut: "Mod+2",
        run: () => navigate("/assets"),
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
        id: "selection.delete",
        label: "Delete",
        run: () => {
          const keys = [...useSelection.getState().keys];
          if (!keys.length) return;
          let count = 0;
          if (
            commit((data) => {
              count = deleteCardSelection(data, keys);
              if (!count)
                throw Error(
                  "These items are already removed or cannot be deleted.",
                );
            }, "Selection deleted")
          ) {
            useSelection.getState().replace([]);
            useStore
              .getState()
              .setNotice(`${count} ${count === 1 ? "item" : "items"} deleted`);
            const data = useStore.getState().data;
            if (
              (target && data.projects[target]?.archived) ||
              (eid && data.episodes[eid]?.archived)
            )
              navigate("/projects");
          }
        },
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
      ...(target && eid
        ? produceStages.map((stage, index) => ({
            id: `produce.${stage.id}`,
            label: stage.label,
            shortcut: String(index + 1),
            run: () => {
              const params = new URLSearchParams(location.search);
              const url = produceUrl(
                target,
                eid,
                stage.id,
                params.get("scene") ?? undefined,
                params.get("shot") ?? undefined,
              );
              navigate(
                params.get("mode") === "demo" ? `${url}&mode=demo` : url,
              );
            },
          }))
        : []),
    ],
    [target, eid, navigate, location.search],
  );
  useRegisterCommands("shell", commands);
  useEffect(() => {
    const closeActivity = (event: KeyboardEvent) => {
      if (event.key === "Escape") useStudio.getState().set({ activity: false });
    };
    window.addEventListener("keydown", closeActivity);
    return () => window.removeEventListener("keydown", closeActivity);
  }, []);
  useEffect(() => generationService.start(), []);
  useEffect(() => {
    if (!readAppConfiguration().authBypass) return backendActivity.start();
  }, []);
  useEffect(() => {
    if (settings) {
      useStudio.getState().set({ settings: false });
      navigate("/settings", { state: { projectId: target } });
    }
  }, [settings, navigate]);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      document.documentElement.dataset.theme =
        ui.theme === "system"
          ? preference.matches
            ? "light"
            : "dark"
          : ui.theme;
    };
    apply();
    preference.addEventListener?.("change", apply);
    return () => preference.removeEventListener?.("change", apply);
  }, [ui.theme]);
  useEffect(() => {
    document.documentElement.dataset.reducedMotion = String(!!ui.reducedMotion);
    return () => {
      delete document.documentElement.dataset.reducedMotion;
    };
  }, [ui.reducedMotion]);
  useEffect(() => {
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
  const jobs = (owned ? [] : Object.values(d.jobs)).filter(
    (j) => !project || j.projectId === project.id,
  );
  const linkedProjectId = project
    ? d.backend?.projectLinks?.[project.id]
    : undefined;
  const backendJobs = Object.values(d.backend?.jobs ?? {}).filter(
    (j) =>
      !project ||
      j.projectId === linkedProjectId ||
      j.request?.sourceProjectId === project.id,
  );
  const pending =
    d.backend?.request &&
    !d.backend.request.jobId &&
    (!project ||
      d.backend.request.sourceProjectId === project.id ||
      d.backend.request.projectId === linkedProjectId)
      ? d.backend.request
      : undefined;
  const running =
    jobs.filter(active).length +
    backendJobs.filter(backendActive).length +
    (pending && ["creating", "submitting"].includes(pending.phase) ? 1 : 0);
  return (
    <div
      className={`studio-shell studio-layout density-${ui.density ?? "comfortable"} ${projectsHome ? "is-projects-home" : ""} ${libraryPage ? "is-library" : ""} ${activity ? "has-activity" : ""}`}
    >
      <StudioNavigation />
      <div className="st-app-body">
        <StudioHeader
          running={running}
          onRecharge={() => setRecharge(true)}
          onAccount={() => setAccount(true)}
        />
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
        <a className="ds-skip" href="#studio-content">
          Skip to workspace
        </a>
        <main id="studio-content" className="st-app-content" tabIndex={-1}>
          {children}
        </main>
        <section
          className={`st-activity ${activity ? "is-open" : ""}`}
          aria-label="Activity tray"
        >
          <header className="activity-heading">
            <h2>Activity</h2>
            <button
              aria-label="Close activity"
              onClick={() => useStudio.getState().set({ activity: false })}
            >
              <X size={23} />
            </button>
          </header>
          {activity && (
            <>
              <nav className="activity-filters" aria-label="Activity filters">
                {(["all", "generating", "completed"] as const).map((filter) => (
                  <button
                    key={filter}
                    aria-pressed={activityFilter === filter}
                    onClick={() => setActivityFilter(filter)}
                  >
                    {filter[0].toUpperCase() + filter.slice(1)}
                  </button>
                ))}
              </nav>
              <div className="st-activity-jobs">
                {owned && (
                  <ServerActivity
                    filter={activityFilter}
                    projectId={
                      pid && /^[0-9a-f-]{36}$/i.test(pid) ? pid : undefined
                    }
                  />
                )}
                {!owned &&
                  !jobs.length &&
                  !backendJobs.length &&
                  !pending &&
                  activityFilter === "all" && (
                    <div className="activity-empty">
                      <h3>No jobs yet</h3>
                      <p>Your image and video generations will appear here.</p>
                    </div>
                  )}
                {pending &&
                  matchesActivityFilter(
                    activityFilter,
                    ["creating", "submitting"].includes(pending.phase),
                    false,
                  ) && <PendingBackendActivityRow request={pending} />}
                {!owned &&
                  [...backendJobs]
                    .filter((record) =>
                      matchesActivityFilter(
                        activityFilter,
                        backendActive(record),
                        record.job?.status === "succeeded",
                      ),
                    )
                    .reverse()
                    .map((record) => (
                      <BackendActivityRow key={record.id} record={record} />
                    ))}
                {[...jobs]
                  .reverse()
                  .filter((job) =>
                    matchesActivityFilter(
                      activityFilter,
                      active(job),
                      job.state === "succeeded",
                    ),
                  )
                  .map((job) => (
                    <ActivityJobCard key={job.id} job={job} data={d} />
                  ))}
                {!owned &&
                  activityFilter !== "all" &&
                  !jobs.some((job) =>
                    matchesActivityFilter(
                      activityFilter,
                      active(job),
                      job.state === "succeeded",
                    ),
                  ) &&
                  !backendJobs.some((record) =>
                    matchesActivityFilter(
                      activityFilter,
                      backendActive(record),
                      record.job?.status === "succeeded",
                    ),
                  ) &&
                  !(
                    pending &&
                    activityFilter === "generating" &&
                    ["creating", "submitting"].includes(pending.phase)
                  ) && (
                    <p className="activity-empty">
                      {activityFilter === "generating"
                        ? "No jobs generating"
                        : "No completed jobs yet"}
                    </p>
                  )}
              </div>
              <footer className="activity-footer">
                <Info size={20} />
                <span>Jobs continue when you change pages.</span>
              </footer>
            </>
          )}
        </section>
      </div>
      <Dialog open={account} onOpenChange={setAccount}>
        <DialogContent className="st-dialog">
          <DialogTitle>Account</DialogTitle>
          <DialogDescription>
            {profile.tier} · {availableCredits.toLocaleString()} credits
          </DialogDescription>
          {identity ? (
            <button
              className="st-button"
              onClick={() => {
                setAccount(false);
                identity.manageAccount();
              }}
            >
              {identity.development
                ? "Development access"
                : "Manage profile and security"}
            </button>
          ) : (
            <>
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
            </>
          )}
          <button className="st-button" onClick={() => setRecharge(true)}>
            Recharge
          </button>
        </DialogContent>
      </Dialog>
      <RechargeDialog open={recharge} onOpenChange={setRecharge} />
      <StudioNotice />
    </div>
  );
}
