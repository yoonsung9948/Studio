import { useCredits } from "../services/server-data";
import { useState } from "react";
import { useLocation } from "react-router-dom";
import {
  AlignJustify,
  Check,
  CircleAlert,
  Command,
  Contrast,
  ExternalLink,
  List,
  Menu,
  Monitor,
  UsersRound,
} from "lucide-react";
import { setStrictApprovals } from "../domain/workspace";
import { useIdentity } from "../features/account/identity";
import { demoMedia } from "../mocks/demo-media";
import { useAccount } from "../stores/account";
import { useStore } from "../stores/store";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../components/ui/dialog";
import { DraftField } from "./design/Primitives";
import { SaveStatus } from "./design/SavingState";
import { commit } from "./generation";
import { useStudio } from "./selection";
import { SettingsChoices, SettingsToggle } from "./settings/SettingsControls";
import { NotificationPreferences } from "./settings/NotificationPreferences";

const appearance = [
  { id: "dark", name: "Dark", detail: "Cinematic and focused", icon: Monitor },
  { id: "light", name: "Light", detail: "Clean and bright", icon: Monitor },
  { id: "system", name: "System", detail: "Match your device", icon: Contrast },
] as const;
const densities = [
  {
    id: "comfortable",
    name: "Comfortable",
    detail: "Balanced for most users",
    icon: AlignJustify,
  },
  { id: "compact", name: "Compact", detail: "See more on screen", icon: List },
  {
    id: "spacious",
    name: "Spacious",
    detail: "Larger and roomier",
    icon: Menu,
  },
] as const;

function Shortcuts() {
  return (
    <div className="settings-shortcuts">
      {[
        ["K", "Commands", "Open the command palette."],
        ["Z", "Undo", "Undo your last action."],
      ].map(([key, label, detail]) => (
        <div key={key}>
          <kbd>
            <Command size={16} />
          </kbd>
          <kbd>{key}</kbd>
          <span>
            {label}
            <small>{detail}</small>
          </span>
        </div>
      ))}
    </div>
  );
}

function ProductionPolicy({ initialProject }: { initialProject: string }) {
  const projects = useStore((state) => state.data.projects);
  const [projectId, setProjectId] = useState(initialProject);
  return (
    <details className="settings-policy">
      <summary>Production approval policy</summary>
      <p>Choose a production to manage its approval requirements.</p>
      <select
        aria-label="Policy production"
        value={projectId}
        onChange={(event) => setProjectId(event.target.value)}
      >
        <option value="">Choose a production</option>
        {Object.values(projects)
          .filter((project) => !project.archived && !project.unfiled)
          .map((project) => (
            <option key={project.id} value={project.id}>
              {project.title}
            </option>
          ))}
      </select>
      {projects[projectId] && (
        <SettingsToggle
          label="Strict script and plan approvals"
          detail="Require approved source material before generation."
          checked={!!projects[projectId].strictApprovals}
          onChange={(checked) =>
            commit(
              (data) => setStrictApprovals(data, projectId, checked),
              "Approval policy saved",
            )
          }
        />
      )}
    </details>
  );
}

export function SettingsWorkspace() {
  const location = useLocation();
  const [tab, setTab] = useState("workspace"),
    [help, setHelp] = useState(false);
  const identity = useIdentity(),
    profile = useAccount((state) => state.profile);
  const current = identity?.profile ?? profile;
  const ui = useStore((state) => state.ui),
    credits = useCredits(),
    failed = useStore((state) => state.storageFailed);
  const local = !identity || identity.development;
  const avatar =
    identity?.profile.imageUrl || (local ? demoMedia.jun : undefined);
  const setUI = useStore((state) => state.setUI);
  const manageAccount = () =>
    identity ? identity.manageAccount() : setTab("account");
  const profileCard = (
    <div className="settings-profile">
      {avatar ? (
        <img src={avatar} alt="" />
      ) : (
        <span className="settings-profile-initial">{current.fullName[0]}</span>
      )}
      <div>
        <h3>{current.fullName}</h3>
        <p>
          {current.email ||
            (identity?.development
              ? "Local development workspace"
              : "Your creative workspace")}
        </p>
      </div>
    </div>
  );
  return (
    <div className="ds-settings ds-page settings-page">
      <h1>Settings</h1>
      <nav className="settings-tabs" aria-label="Settings sections">
        {["workspace", "account", "notifications", "team"].map((name) => (
          <button
            key={name}
            aria-pressed={tab === name}
            onClick={() => setTab(name)}
          >
            {name[0].toUpperCase() + name.slice(1)}
          </button>
        ))}
      </nav>
      <div className="settings-grid">
        <div className="settings-primary-column">
          <section
            className={`settings-panel settings-main settings-main-${tab}`}
            aria-label={`${tab[0].toUpperCase() + tab.slice(1)} settings`}
          >
            {tab === "workspace" ? (
              <>
                <section className="settings-section">
                  <header>
                    <h2>Appearance</h2>
                    <p>Choose how dotori studio looks on your device.</p>
                  </header>
                  <SettingsChoices
                    label="Appearance"
                    value={ui.theme}
                    options={appearance}
                    onChange={(theme) => setUI({ theme })}
                  />
                </section>
                <section className="settings-section">
                  <header>
                    <h2>Interface density</h2>
                    <p>Adjust the spacing and size of interface elements.</p>
                  </header>
                  <SettingsChoices
                    label="Interface density"
                    value={ui.density ?? "comfortable"}
                    options={densities}
                    onChange={(density) => setUI({ density })}
                  />
                </section>
                <section className="settings-section settings-behavior">
                  <SettingsToggle
                    label="Reduce motion"
                    detail="Minimize animations across the interface."
                    checked={!!ui.reducedMotion}
                    onChange={(reducedMotion) => setUI({ reducedMotion })}
                  />
                  <SettingsToggle
                    label="Autosave"
                    detail="Save text changes automatically as you type."
                    checked={ui.autosave !== false}
                    onChange={(autosave) => setUI({ autosave })}
                  />
                  <p className="settings-autosave-note">
                    {failed
                      ? "Storage is unavailable. Changes are kept in this session only."
                      : ui.autosave === false
                        ? "Text changes are saved when you finish editing a field."
                        : "Changes are saved automatically as you work."}
                  </p>
                </section>
                <section className="settings-section settings-keyboard">
                  <header>
                    <h2>Keyboard shortcuts</h2>
                    <p>Quick actions to speed up your workflow.</p>
                  </header>
                  <Shortcuts />
                </section>
              </>
            ) : tab === "account" ? (
              <>
                <header>
                  <h2>Your account</h2>
                  <p>Profile and sign-in preferences.</p>
                </header>
                {profileCard}
                {identity ? (
                  <button className="ds-button" onClick={manageAccount}>
                    Manage profile and security
                    <ExternalLink size={16} />
                  </button>
                ) : (
                  <div className="settings-account-fields">
                    <label>
                      Full name
                      <DraftField
                        label="Full name"
                        value={profile.fullName}
                        onSave={(fullName) =>
                          useAccount
                            .getState()
                            .updateProfile({ ...profile, fullName })
                        }
                      />
                    </label>
                    <label>
                      Email
                      <DraftField
                        label="Email"
                        value={profile.email}
                        onSave={(email) =>
                          useAccount
                            .getState()
                            .updateProfile({ ...profile, email })
                        }
                      />
                    </label>
                  </div>
                )}
                <p className="settings-muted">
                  Your account and workspace data stay separate from other
                  signed-in users.
                </p>
              </>
            ) : tab === "notifications" ? (
              <>
                <header>
                  <h2>In-app notifications</h2>
                  <p>Choose what you'd like to be notified about.</p>
                </header>
                <NotificationPreferences />
                <p className="settings-muted">
                  All jobs remain available in Activity, regardless of these
                  preferences.
                </p>
                <button
                  className="ds-button"
                  onClick={() => useStudio.getState().set({ activity: true })}
                >
                  Open Activity
                  <ExternalLink size={16} />
                </button>
              </>
            ) : (
              <>
                <header>
                  <h2>Your team</h2>
                  <p>People and access for this workspace.</p>
                </header>
                <div className="settings-team-member">
                  {profileCard}
                  <span>Current member</span>
                </div>
                <div className="settings-team-info">
                  <UsersRound size={30} />
                  <div>
                    <h3>A space for your production</h3>
                    <p>
                      Shared team invitations and roles are not available in
                      this workspace yet. Your production references and
                      approval policies are ready to use.
                    </p>
                  </div>
                </div>
                <button
                  className="ds-button"
                  onClick={() => setTab("workspace")}
                >
                  Workspace preferences
                </button>
              </>
            )}
          </section>
          {tab === "workspace" && (
            <ProductionPolicy
              initialProject={location.state?.projectId || ""}
            />
          )}
        </div>
        <aside
          className="settings-aside"
          aria-label="Account and preferences summary"
        >
          <section className="settings-panel settings-account-summary">
            <h2>Account summary</h2>
            {profileCard}
            <div className="settings-account-fact">
              <div>
                <b>Plan</b>
                <strong>{local ? "Studio preview" : current.tier}</strong>
              </div>
              <p>
                {local
                  ? "Full creative tools in the local preview."
                  : "Your current workspace plan."}
              </p>
            </div>
            {local && (
              <div className="settings-account-fact">
                <div>
                  <b>Workspace credits</b>
                  <span>{credits.toLocaleString()} credits</span>
                </div>
                <p>Demo balance for testing and exploration.</p>
              </div>
            )}
            <button className="ds-button" onClick={manageAccount}>
              Manage account
              <ExternalLink size={16} />
            </button>
          </section>
          {tab !== "notifications" && (
            <section className="settings-panel settings-notifications">
              <header>
                <h2>Notifications</h2>
                <p>Choose what you'd like to be notified about.</p>
              </header>
              <NotificationPreferences />
            </section>
          )}
          <div className={`settings-save-state ${failed ? "has-error" : ""}`}>
            <span>
              {failed ? <CircleAlert size={23} /> : <Check size={23} />}
              <SaveStatus />
            </span>
            <button className="ds-text" onClick={() => setHelp(true)}>
              Help & shortcuts
              <ExternalLink size={12} />
            </button>
          </div>
        </aside>
      </div>
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent className="st-dialog settings-help">
          <DialogTitle>Help & shortcuts</DialogTitle>
          <DialogDescription>
            Use the command palette to find actions throughout the studio.
          </DialogDescription>
          <Shortcuts />
          <p>
            In the editor, Space plays or pauses the preview. Press Escape to
            close a dialog.
          </p>
          <button
            className="ds-button ds-primary"
            onClick={() => {
              setHelp(false);
              useStudio.getState().set({ palette: true });
            }}
          >
            Open commands
            <Command size={16} />
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
