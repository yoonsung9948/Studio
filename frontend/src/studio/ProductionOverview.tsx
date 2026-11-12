import { productionSync } from "../services/production-sync";
import { useOwnedData } from "../services/server-data";
import { useNavigate } from "react-router-dom";
import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { FileText } from "lucide-react";
import { useStore } from "../stores/store";
import type { Project } from "../domain/types";
import { renameWorkspaceProject } from "../domain/workspace";
import { commit } from "./generation";
import { SelectionSurface } from "./SelectionSurface";
import { useSelection } from "./selection";
import { useCommands } from "./commands";
import { AddEpisodeCard } from "./production/AddEpisodeCard";
import { DraftField, EditableHeading } from "./design/Primitives";
import { SaveStatus } from "./design/SavingState";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../components/ui/dialog";
import { ProductionFrame } from "./production/ProductionFrame";
import { ProductionContinuity } from "./production/ProductionContinuity";
import { ProductionActivity } from "./production/ProductionActivity";
import {
  productionEpisodes,
  productionEvents,
  productionFacts,
} from "./production/production-data";

const tabs = [
  { id: "episodes", label: "Episodes" },
  { id: "bible", label: "Story bible" },
  { id: "settings", label: "Production settings" },
] as const;
export function ProductionOverview({
  projectId,
  children,
}: {
  projectId: string;
  children: ReactNode;
}) {
  const owned = useOwnedData();
  const navigate = useNavigate();
  const data = useStore((state) => state.data),
    project = data.projects[projectId];
  const [params, setParams] = useSearchParams();
  const { execute } = useCommands();
  const tab =
    tabs.find((tab) => tab.id === params.get("tab"))?.id ?? "episodes";
  const [notes, setNotes] = useState(false),
    [allActivity, setAllActivity] = useState(false);
  const episodes = productionEpisodes(data, projectId);
  const events = productionEvents(data, projectId);
  const keys = useSelection((state) => state.keys);
  const selectedEpisode =
    [...keys]
      .reverse()
      .map((key) => episodes.find((episode) => key === `episode:${episode.id}`))
      .find((episode) => !!episode) ?? episodes.at(-1);
  useEffect(() => {
    if (selectedEpisode && !keys.includes(`episode:${selectedEpisode.id}`))
      useSelection.getState().replace([`episode:${selectedEpisode.id}`]);
    else if (!selectedEpisode && keys.some((key) => key.startsWith("episode:")))
      useSelection.getState().replace([]);
  }, [projectId, selectedEpisode?.id, keys]);
  const saveNotes = (bible: string) =>
    commit((d) => {
      d.projects[projectId].bible = bible;
      d.projects[projectId].revision++;
      d.projects[projectId].updatedAt = Date.now();
    }, "Production notes saved");
  const changeTab = (tab: string) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set("tab", tab);
      return next;
    });
  return (
    <ProductionFrame
      title={
        <div className="production-editable-title">
          <span className="production-title-measure" aria-hidden="true">
            {project.title}
          </span>
          <EditableHeading
            value={project.title}
            label="Project name"
            onSave={(title) =>
              commit(
                (d) => renameWorkspaceProject(d, projectId, title),
                "Project renamed",
              )
            }
          />
        </div>
      }
      saved={
        <span className="production-save">
          <i aria-hidden="true" />
          <SaveStatus compact />
        </span>
      }
      description={
        project.description || "Every story starts with a first scene."
      }
      actions={
        <>
          <button className="production-button" onClick={() => setNotes(true)}>
            <FileText size={20} />
            Production notes
          </button>
          {owned && (
            <button
              className="production-button"
              onClick={() => {
                if (
                  window.confirm(
                    "Archive this production? Its takes and history will be retained.",
                  )
                )
                  void productionSync()
                    ?.archive(projectId)
                    .then(() => navigate("/projects"))
                    .catch((e) => useStore.getState().setNotice(e.message));
              }}
            >
              Archive production
            </button>
          )}
        </>
      }
      cover={
        project.cover ? (
          <img src={project.cover} alt="Production cover" />
        ) : undefined
      }
      facts={productionFacts(data, projectId)}
    >
      <nav className="production-tabs" aria-label="Production sections">
        {tabs.map((item) => (
          <button
            key={item.id}
            aria-current={tab === item.id ? "page" : undefined}
            onClick={() => changeTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="production-content">
        <div className="production-workspace">
          {tab === "episodes" ? (
            <>
              <section aria-label="Episodes">
                <header className="production-section-heading">
                  <h2>Episodes</h2>
                  <span className="production-episode-hint">
                    Select an episode to preview its continuity.
                  </span>
                </header>
                <SelectionSurface
                  className="production-episode-grid"
                  aria-label="Episode cards"
                >
                  {children}
                  <AddEpisodeCard onAdd={() => execute("new.episode")} />
                </SelectionSurface>
              </section>
              <ProductionContinuity
                data={data}
                episodeId={selectedEpisode?.id}
              />
            </>
          ) : tab === "bible" ? (
            <section className="production-editor">
              <h2>Story bible</h2>
              <p>
                Shared story, character, and continuity notes for every episode.
              </p>
              <DraftField
                label="Story bible"
                value={project.bible}
                onSave={saveNotes}
                multiline
                rows={15}
                placeholder="Describe the world, its characters, and what stays consistent…"
              />
            </section>
          ) : (
            <ProductionSettings
              project={project}
              episodeCount={episodes.length}
            />
          )}
        </div>
        <aside
          className="production-recent"
          aria-label="Recent production activity"
        >
          <header className="production-section-heading">
            <h2>Recent activity</h2>
            <button onClick={() => setAllActivity(true)}>View all</button>
          </header>
          <ProductionActivity events={events.slice(0, 5)} />
        </aside>
      </div>
      <Dialog open={notes} onOpenChange={setNotes}>
        <DialogContent className="st-dialog production-dialog">
          <DialogTitle>Production notes</DialogTitle>
          <DialogDescription>
            Shared direction and continuity, also available in your story bible.
            Changes save automatically.
          </DialogDescription>
          <DraftField
            label="Production notes"
            value={project.bible}
            onSave={saveNotes}
            multiline
            rows={12}
            placeholder="Add notes for this production…"
          />
        </DialogContent>
      </Dialog>
      <Dialog open={allActivity} onOpenChange={setAllActivity}>
        <DialogContent className="st-dialog production-dialog">
          <DialogTitle>Production activity</DialogTitle>
          <DialogDescription>
            Recorded script approvals and media from this production.
          </DialogDescription>
          <ProductionActivity events={events} />
        </DialogContent>
      </Dialog>
    </ProductionFrame>
  );
}
function ProductionSettings({
  project,
  episodeCount,
}: {
  project: Project;
  episodeCount: number;
}) {
  const save = (
    fields: Partial<
      Pick<
        Project,
        "description" | "format" | "defaultDuration" | "strictApprovals"
      >
    >,
  ) =>
    commit((data) => {
      const current = data.projects[project.id];
      Object.assign(current, fields);
      current.revision++;
      current.updatedAt = Date.now();
    }, "Production settings saved");
  return (
    <section className="production-editor production-settings">
      <h2>Production settings</h2>
      <p>Set the shared details and defaults for this production.</p>
      <label>
        Production description
        <DraftField
          label="Production description"
          value={project.description}
          onSave={(description) => save({ description })}
          multiline
          rows={3}
          maxLength={2000}
        />
      </label>
      <label>
        Format
        <DraftField
          label="Production format"
          value={project.format ?? (episodeCount > 1 ? "Series" : "Short film")}
          onSave={(format) => save({ format: format.trim() || "Short film" })}
          maxLength={100}
        />
      </label>
      <label>
        Default episode duration <span>Applies to new episodes.</span>
        <DraftField
          label="Default episode duration"
          value={String(project.defaultDuration)}
          maxLength={3}
          onSave={(value) => {
            const duration = Number(value);
            if (!Number.isInteger(duration) || duration < 3 || duration > 90) {
              useStore
                .getState()
                .setNotice("Choose a duration from 3 to 90 seconds.");
              return false;
            }
            return save({ defaultDuration: duration });
          }}
        />
      </label>
      <label className="production-policy">
        <input
          type="checkbox"
          role="switch"
          aria-label="Require script and scene plan approvals"
          checked={!!project.strictApprovals}
          onChange={(event) => save({ strictApprovals: event.target.checked })}
        />
        <div>
          <b>Require script and scene plan approvals</b>
          <span>Review scripts and shot plans before generation.</span>
        </div>
      </label>
    </section>
  );
}
