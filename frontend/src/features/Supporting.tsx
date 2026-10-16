import { studioJobPath, studioJobTitle } from "../domain/studio-selectors";
import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Check,
  Download,
  Film,
  Image,
  Music,
  RotateCcw,
  Upload,
  X,
  Sparkles,
} from "lucide-react";
import { useStore } from "../stores/store";
import { active } from "../domain/selectors";
import { cancelJob, retryJob } from "../domain/commands";
import { CONFIG, uid, type Asset } from "../domain/types";
import { Button } from "../components/ui/button";
import { useActions } from "../components/Actions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../components/ui/dialog";
import { SearchBox, NotFound } from "./Gallery";
import { downloadManifest } from "../services/mock";
export function Queue({
  projectId: propId,
  compact = false,
}: {
  projectId?: string;
  compact?: boolean;
}) {
  const params = useParams();
  const projectId = propId ?? params.projectId;
  const d = useStore((s) => s.data),
    mutate = useStore((s) => s.mutate),
    paused = useStore((s) => s.paused),
    resume = useStore((s) => s.resume);
  const modal = useActions();
  const [filter, setFilter] = useState("all");
  const [all, setAll] = useState(false);
  const jobs = Object.values(d.jobs).filter(
    (j) =>
      (all || !projectId || j.projectId === projectId) &&
      (filter === "all" ||
        (filter === "active" && active(j)) ||
        (filter === "attention" && ["failed", "waiting"].includes(j.state)) ||
        (filter === "completed" &&
          ["succeeded", "canceled"].includes(j.state))),
  );
  return (
    <div className={compact ? "queue-compact" : "page"}>
      {!compact && (
        <>
          <div className="eyebrow">PRODUCTION</div>
          <header className="page-heading">
            <div>
              <h1>Generation queue</h1>
              <p>Independent scenes, moving forward together.</p>
            </div>
            <Button
              variant="default"
              onClick={() =>
                modal({
                  kind: "generate",
                  ids: Object.values(d.shots)
                    .filter(
                      (s) =>
                        !projectId ||
                        d.episodes[d.scenes[s.sceneId].episodeId].projectId ===
                          projectId,
                    )
                    .map((s) => s.id),
                })
              }
            >
              <Sparkles size={15} />
              Run demo generation
            </Button>
          </header>
        </>
      )}
      <p className="notice-inline">
        Simulated progress · {CONFIG.concurrency} concurrent jobs · jobs pause
        when the browser closes.
      </p>
      {paused && (
        <div className="notice-inline amber">
          Unfinished work recovered.{" "}
          <Button onClick={resume}>Resume demo jobs</Button>
        </div>
      )}
      <div className="filter-bar">
        <select
          aria-label="Queue filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">All jobs</option>
          <option value="active">Active</option>
          <option value="attention">Needs attention</option>
          <option value="completed">Completed</option>
        </select>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={all}
            onChange={(e) => setAll(e.target.checked)}
          />
          All projects
        </label>
        <Button
          variant="ghost"
          onClick={() =>
            mutate((d) => {
              for (const j of Object.values(d.jobs))
                if (
                  (all || !projectId || j.projectId === projectId) &&
                  ["succeeded", "canceled"].includes(j.state)
                )
                  delete d.jobs[j.id];
            })
          }
        >
          Clear completed
        </Button>
      </div>
      <div className="queue-list">
        {jobs.map((j) => (
          <article className="job-row" key={j.id}>
            <div
              className={`job-icon ${j.state === "failed" ? "amber-text" : ""}`}
            >
              {j.operation !== "video" ? (
                <Image size={18} />
              ) : (
                <Film size={18} />
              )}
            </div>
            <div className="job-copy">
              <Link to={studioJobPath(d, j)}>
                <h3>{studioJobTitle(d, j)}</h3>
              </Link>
              <p>
                {d.projects[j.projectId]?.title} ·{" "}
                {d.episodes[j.episodeId]?.title}
              </p>
              <small>
                {j.operation} · attempt {j.attempt} · {j.cost} demo credits{" "}
                {j.dependencyShotId
                  ? "· depends on " + d.shots[j.dependencyShotId]?.title
                  : ""}
              </small>
              {j.error && <p className="amber-text">{j.error}</p>}
              {j.state === "running" && (
                <progress
                  aria-label="Simulated job progress"
                  value={j.progress ?? undefined}
                  max={100}
                />
              )}
            </div>
            <div className="job-status">
              <span
                className={`status ${j.state === "succeeded" ? "green" : j.state === "failed" || j.state === "waiting" ? "amber" : ""}`}
              >
                {j.state === "waiting"
                  ? "Waiting for approved source"
                  : j.state}
              </span>
              {active(j) ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => mutate((d) => cancelJob(d, j.id))}
                >
                  <X size={13} />
                  Cancel
                </Button>
              ) : ["failed", "canceled"].includes(j.state) ? (
                <Button
                  size="sm"
                  onClick={() =>
                    modal({
                      kind: "confirm",
                      title: "Retry generation?",
                      description: `Create a new attempt for ${j.cost} demo credits. The previous attempt stays in history.`,
                      action: (d) => retryJob(d, j.id),
                    })
                  }
                >
                  <RotateCcw size={13} />
                  Retry
                </Button>
              ) : j.target ? (
                <Button size="sm" asChild>
                  <Link to={studioJobPath(d, j)}>Review</Link>
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => modal({ kind: "review", ids: [j.shotId] })}
                >
                  Review
                </Button>
              )}
            </div>
          </article>
        ))}
      </div>
      {!jobs.length && (
        <div className="empty">
          <Check size={24} />
          <h3>Nothing in this queue.</h3>
          <p>Ready scenes can be generated from the scene board.</p>
        </div>
      )}
    </div>
  );
}
export function Bible() {
  const { projectId = "" } = useParams();
  const d = useStore((s) => s.data),
    mutate = useStore((s) => s.mutate);
  const p = d.projects[projectId];
  const [saved, setSaved] = useState(false);
  if (!p) return <NotFound />;
  return (
    <div className="page document-page">
      <div className="eyebrow">STORY</div>
      <header className="page-heading">
        <div>
          <h1>Story Bible</h1>
          <p>A shared source of truth for {p.title}.</p>
        </div>
        <span className="muted">
          {saved ? "Saved locally" : "Saves when you leave the field"}
        </span>
      </header>
      <textarea
        aria-label="Story Bible"
        className="bible-editor"
        defaultValue={p.bible}
        key={p.id}
        onChange={() => setSaved(false)}
        onBlur={(e) => {
          mutate((d) => {
            d.projects[p.id].bible = e.target.value;
            d.projects[p.id].revision++;
          }, true);
          setSaved(true);
        }}
      />
    </div>
  );
}
export function Assets() {
  const { projectId = "" } = useParams();
  const d = useStore((s) => s.data),
    mutate = useStore((s) => s.mutate),
    notice = useStore((s) => s.setNotice);
  const modal = useActions();
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Asset | null>(null);
  const upload = useRef<HTMLInputElement>(null);
  const [reattach, setReattach] = useState<string>();
  const assets = Object.values(d.assets).filter(
    (a) =>
      a.projectId === projectId &&
      (filter === "all" || a.kind === filter) &&
      a.title.toLowerCase().includes(search.toLowerCase()),
  );
  function files(list: FileList | null) {
    if (!list) return;
    for (const file of Array.from(list)) {
      const kind = file.type.startsWith("image/")
        ? "image"
        : file.type.startsWith("video/")
          ? "video"
          : file.type.startsWith("audio/")
            ? "audio"
            : undefined;
      if (
        !kind ||
        !/^image\/(png|jpeg|webp|gif)$|^video\/(mp4|webm)$|^audio\/(mpeg|wav|ogg|mp4|x-wav)$/.test(
          file.type,
        )
      ) {
        notice(
          "Supported files: PNG, JPEG, WebP, GIF, MP4, WebM, MP3, WAV, OGG.",
        );
        continue;
      }
      if (file.size > CONFIG.maxUploadBytes) {
        notice("Choose a file smaller than 20 MB.");
        continue;
      }
      const id = reattach ?? uid("upload");
      const url = URL.createObjectURL(file);
      mutate((d) => {
        d.assets[id] = {
          id,
          projectId,
          title: file.name,
          kind,
          url,
          sessionOnly: true,
          missing: false,
          provenance: "User upload · session-only; reattach after reload",
        };
      });
    }
    setReattach(undefined);
    if (upload.current) upload.current.value = "";
  }
  return (
    <div className="page">
      <div className="eyebrow">LIBRARY</div>
      <header className="page-heading">
        <div>
          <h1>Assets</h1>
          <p>References, takes, and the details that make your world.</p>
        </div>
        <Button variant="default" onClick={() => upload.current?.click()}>
          <Upload size={15} />
          Upload asset
        </Button>
      </header>
      <input
        ref={upload}
        type="file"
        hidden
        multiple
        accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,audio/mpeg,audio/wav,audio/ogg"
        onChange={(e) => files(e.target.files)}
      />
      <div className="filter-bar">
        <div className="segmented">
          {["all", "image", "video", "audio"].map((f) => (
            <button
              key={f}
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
            >
              {f === "all"
                ? "All assets"
                : f === "image"
                  ? "Images"
                  : f === "video"
                    ? "Videos"
                    : "Audio"}
            </button>
          ))}
        </div>
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="Search assets"
        />
      </div>
      <p className="notice-inline">
        Uploads are session-only (20 MB maximum). Reattach them after reloading.
        Bundled storyboard references remain available.
      </p>
      <div className="asset-grid">
        {assets.map((a) => (
          <article className="asset-card" key={a.id}>
            <button className="asset-preview" onClick={() => setSelected(a)}>
              {a.missing ? (
                <span>Reattachment needed</span>
              ) : a.kind === "image" ? (
                <img src={a.url} alt={a.title} />
              ) : a.kind === "video" ? (
                <Film size={30} />
              ) : (
                <Music size={30} />
              )}
            </button>
            <h3>{a.title}</h3>
            <div className="row-actions">
              <small>
                {a.kind} ·{" "}
                {a.sessionOnly ? "session upload" : "bundled fixture"}
              </small>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  modal({
                    kind: "form",
                    title: "Rename asset",
                    fields: [{ key: "title", label: "Title", value: a.title }],
                    submit: (v, d) => {
                      if (!v.title.trim()) throw Error("A title is required.");
                      d.assets[a.id].title = v.title;
                    },
                  })
                }
              >
                Rename
              </Button>
            </div>
            {a.missing && (
              <Button
                onClick={() => {
                  setReattach(a.id);
                  upload.current?.click();
                }}
              >
                Reattach
              </Button>
            )}
          </article>
        ))}
      </div>
      {!assets.length && (
        <div className="empty">
          No matching assets. Upload a file to add it to this library.
        </div>
      )}
      <Dialog
        open={!!selected}
        onOpenChange={(v) => {
          if (!v) setSelected(null);
        }}
      >
        {selected && (
          <DialogContent>
            <DialogTitle>{selected.title}</DialogTitle>
            <DialogDescription>{selected.provenance}</DialogDescription>
            {selected.missing ? (
              <p>Reattach this media to preview it.</p>
            ) : selected.kind === "image" ? (
              <img
                className="asset-dialog-image"
                src={selected.url}
                alt={selected.title}
              />
            ) : selected.kind === "video" ? (
              <video
                className="asset-dialog-image"
                src={selected.url}
                controls
              />
            ) : (
              <audio src={selected.url} controls />
            )}
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
export function Exports() {
  const { projectId = "" } = useParams();
  const d = useStore((s) => s.data);
  const modal = useActions();
  const records = Object.values(d.exports).filter(
    (r) => d.episodes[r.episodeId]?.projectId === projectId,
  );
  return (
    <div className="page">
      <div className="eyebrow">PRODUCTION</div>
      <header className="page-heading">
        <div>
          <h1>Exports</h1>
          <p>Every version, with its place in the story.</p>
        </div>
        <Button
          variant="default"
          disabled={!d.projects[projectId]?.episodeIds.length}
          onClick={() =>
            modal({
              kind: "export",
              episodeId: d.projects[projectId].episodeIds[0],
            })
          }
        >
          <Download size={15} />
          Export episode
        </Button>
      </header>
      <p className="notice-inline">
        Demo export — no video rendered. Files are downloadable JSON timeline
        manifests.
      </p>
      {records.map((r) => (
        <article className="export-row" key={r.id}>
          <Film size={22} />
          <div>
            <h3>{r.title}</h3>
            <p>
              {r.preset} · Timeline v{r.timelineVersion} ·{" "}
              {r.draft ? "Draft preview" : "Approved animatic"} · 9:16
            </p>
            <small>Demo export — no video rendered</small>
          </div>
          <span
            className={`status ${d.episodes[r.episodeId].timelineVersion !== r.timelineVersion ? "amber" : "green"}`}
          >
            {d.episodes[r.episodeId].timelineVersion !== r.timelineVersion
              ? "Outdated"
              : "Current timeline"}
          </span>
          <Button onClick={() => downloadManifest(r)}>
            <Download size={14} />
            JSON
          </Button>
        </article>
      ))}
      {!records.length && (
        <div className="empty">
          No exports yet. Open an episode to create a demo manifest.
        </div>
      )}
    </div>
  );
}
export function Settings() {
  const { projectId = "" } = useParams();
  const d = useStore((s) => s.data),
    ui = useStore((s) => s.ui),
    setUI = useStore((s) => s.setUI),
    mutate = useStore((s) => s.mutate);
  const p = d.projects[projectId];
  const modal = useActions();
  const [saved, setSaved] = useState(false);
  if (!p) return <NotFound />;
  return (
    <div className="page settings-page">
      <div className="eyebrow">WORKSPACE</div>
      <header className="page-heading">
        <div>
          <h1>Project settings</h1>
          <p>Set the defaults for your next story.</p>
        </div>
      </header>
      <form
        className="form-fields"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          const seconds = Number(form.get("duration"));
          if (seconds < 3 || seconds > 90) return;
          mutate((d) => {
            d.projects[projectId].title = String(form.get("title")).trim();
            d.projects[projectId].description = String(form.get("description"));
            d.projects[projectId].defaultDuration = seconds;
          });
          setSaved(true);
        }}
      >
        <label>
          Project name
          <input name="title" required defaultValue={p.title} />
        </label>
        <label>
          Description
          <textarea name="description" defaultValue={p.description} />
        </label>
        <label>
          Default episode target (3–90 seconds)
          <input
            type="number"
            name="duration"
            min={3}
            max={90}
            required
            defaultValue={p.defaultDuration}
          />
        </label>
        <label>
          Appearance
          <select
            value={ui.theme}
            onChange={(e) =>
              setUI({ theme: e.target.value as "light" | "dark" })
            }
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </label>
        <div>
          <Button variant="default">Save changes</Button>
          {saved && <span className="saved-feedback">Saved locally</span>}
        </div>
      </form>
      <section className="settings-reset">
        <h2>Demo workspace</h2>
        <p>
          Generation, credits, conversations, and exports are simulated. Nothing
          is sent to a model or social platform.
        </p>
        <Button
          variant="destructive"
          onClick={() =>
            modal({
              kind: "confirm",
              title: "Reset the demo?",
              description:
                "This replaces all local projects, messages, and edits with the original seeded demo.",
              danger: true,
              action: () => {
                setTimeout(() => useStore.getState().reset(), 0);
              },
            })
          }
        >
          Reset demo
        </Button>
      </section>
    </div>
  );
}
