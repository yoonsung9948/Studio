import { useCredits } from "../../services/server-data";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Bell,
  ChevronRight,
  CircleUserRound,
  Coins,
} from "lucide-react";
import { BrandMark, BrandWordmark } from "../../components/Brand";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { useIdentity } from "../../features/account/identity";
import { useStore } from "../../stores/store";
import { useAccount } from "../../stores/account";
import { useOwnedData, useProject } from "../../services/server-data";
import { demoMedia } from "../../mocks/demo-media";
import { useStudio } from "../selection";

function ConnectedProjectCrumb({ id }: { id: string }) {
  const project = useProject(id);
  return (
    <Link to={`/projects/${id}/episodes`}>
      {project.data?.title ?? "Production"}
    </Link>
  );
}
function ProductionContext() {
  const location = useLocation();
  const navigate = useNavigate();
  const owned = useOwnedData();
  const data = useStore((state) => state.data);
  const parts = location.pathname.split("/").filter(Boolean);
  if (parts[0] !== "projects" || !parts[1] || parts[1] === "browse")
    return location.pathname === "/projects" ? null : (
      <button
        className="studio-back ds-icon"
        aria-label="Go back"
        onClick={() => navigate(-1)}
      >
        <ArrowLeft size={17} />
      </button>
    );
  const projectId =
    parts[0] === "projects" && parts[1] !== "browse" ? parts[1] : undefined;
  const project = projectId ? data.projects[projectId] : undefined;
  const episode = parts[2] === "episodes" ? data.episodes[parts[3]] : undefined;
  return (
    <nav className="studio-header-context" aria-label="Production breadcrumb">
      <button
        className="studio-back ds-icon"
        aria-label="Go back"
        onClick={() => navigate(-1)}
      >
        <ArrowLeft size={17} />
      </button>

      {project && !project.unfiled ? (
        <Link to={`/projects/${project.id}/episodes`}>{project.title}</Link>
      ) : owned && projectId && /^[0-9a-f-]{36}$/i.test(projectId) ? (
        <ConnectedProjectCrumb id={projectId} />
      ) : (
        <span>Production</span>
      )}
      {episode && episode.projectId === projectId && (
        <>
          <ChevronRight className="studio-context-divider" size={13} />
          <Link
            className="studio-header-episode"
            to={`/projects/${projectId}/episodes/${episode.id}`}
          >
            Episode{" "}
            {String(
              (project?.episodeIds.indexOf(episode.id) ?? 0) + 1,
            ).padStart(2, "0")}{" "}
            · {episode.title}
          </Link>
        </>
      )}
    </nav>
  );
}

/** Mounted once by StudioShell: account, activity and credit balance survive route changes. */
export function StudioHeader({
  running,
  onRecharge,
  onAccount,
}: {
  running: number;
  onRecharge(): void;
  onAccount(): void;
}) {
  const identity = useIdentity();
  const demoProfile = useAccount((state) => state.profile);
  const credits = useCredits();
  const activity = useStudio((state) => state.activity);
  const navigate = useNavigate();
  const profile = identity?.profile ?? demoProfile;
  const image =
    identity?.profile.imageUrl ??
    (identity?.development ? demoMedia.maya : undefined);
  return (
    <header
      className="st-topbar studio-header"
      aria-label="Account and credits"
    >
      <div className="studio-header-brand">
        <Link
          className="studio-app-mark"
          to="/projects"
          aria-label="Studio home"
        >
          <BrandMark decorative />
        </Link>
        <Link to="/projects" aria-label="dotori studio">
          <BrandWordmark />
        </Link>
        <span className="studio-header-label">Studio</span>
      </div>
      <ProductionContext />
      <div className="st-topbar-actions">
        <button
          className="studio-credit-balance"
          aria-label={`${credits.toLocaleString()} credits remaining`}
          onClick={onRecharge}
        >
          <Coins size={18} aria-hidden="true" />
          {credits.toLocaleString()} cr
        </button>
        <button
          className="studio-notifications"
          aria-label="Notifications"
          aria-expanded={activity}
          onClick={() => useStudio.getState().set({ activity: !activity })}
        >
          <Bell size={23} strokeWidth={1.5} />
          {running > 0 && <i />}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger className="st-icon" aria-label="Account">
            {image ? (
              <img className="st-account-avatar" src={image} alt="" />
            ) : (
              <CircleUserRound size={23} />
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <div className="st-account-summary">
              {image ? (
                <img className="st-account-avatar" src={image} alt="" />
              ) : (
                <CircleUserRound size={30} />
              )}
              <b>{profile.fullName}</b>
              <span
                aria-label={`${credits.toLocaleString()} credits remaining`}
              >
                {profile.tier} · {credits.toLocaleString()} cr
              </span>
              {identity?.development && <small>Local demo</small>}
            </div>
            <DropdownMenuItem onSelect={onRecharge}>
              Recharge credits
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onAccount}>
              Account settings
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                if (identity)
                  void identity
                    .signOut()
                    .catch((error) =>
                      useStore
                        .getState()
                        .setNotice(
                          error instanceof Error
                            ? error.message
                            : "Could not sign out. Retry.",
                        ),
                    );
                else {
                  useAccount.getState().signOut();
                  navigate("/login");
                }
              }}
            >
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
