import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../../components/ui/dialog";
import {
  ArrowRight,
  Check,
  NotepadText,
  Lightbulb,
  Sparkles,
  Upload,
} from "lucide-react";

export type FilmStart = "idea" | "script" | "blank";
const options = [
  {
    id: "idea",
    label: "An idea",
    description: "Describe your story in a few words.",
    icon: Lightbulb,
  },
  {
    id: "script",
    label: "A script",
    description: "Upload or paste your screenplay.",
    icon: NotepadText,
  },
  {
    id: "blank",
    label: "A blank project",
    description: "Start with a clean canvas.",
    icon: Sparkles,
  },
] as const;

export function FilmComposer({
  busy,
  onStart,
}: {
  busy: boolean;
  onStart(mode: FilmStart, prompt: string): void;
}) {
  const [review, setReview] = useState<{
    mode: FilmStart;
    prompt: string;
  } | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [mode, setMode] = useState<FilmStart>("idea");
  const [drafts, setDrafts] = useState({ idea: "", script: "", blank: "" });
  const input = useRef<HTMLTextAreaElement>(null);
  const prompt = drafts[mode];
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (!location.state?.composeFilm) return;
    setMode("idea");
    input.current?.focus();
    input.current?.scrollIntoView({ block: "nearest" });
    navigate(location.pathname + location.search, {
      replace: true,
      state: { ...location.state, composeFilm: false },
    });
  }, [location.state, location.pathname, location.search, navigate]);
  useEffect(() => {
    const focus = () => {
      setMode("idea");
      input.current?.focus();
      input.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    };
    window.addEventListener("dotori-home-new-film", focus);
    return () => window.removeEventListener("dotori-home-new-film", focus);
  }, []);
  return (
    <>
      <form
        className="ph-composer"
        aria-label="Start a film"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          if (mode !== "blank" && !prompt.trim()) {
            input.current?.focus();
            return;
          }
          if (mode === "blank") onStart(mode, prompt.trim());
          else setReview({ mode, prompt: prompt.trim() });
        }}
      >
        <h2>What are we making?</h2>
        <p className="sr-only" id="film-start-description">
          {mode === "blank"
            ? "A fresh canvas for your next production."
            : "Describe a scene or paste a script..."}
        </p>
        <div className="ph-prompt">
          <label className="sr-only" htmlFor="film-prompt">
            {mode === "blank"
              ? "Film title"
              : mode === "script"
                ? "Film script"
                : "Story idea"}
          </label>
          <textarea
            ref={input}
            id="film-prompt"
            aria-describedby="film-start-description"
            maxLength={2000}
            value={prompt}
            disabled={busy}
            placeholder={
              mode === "blank"
                ? "Untitled film"
                : mode === "script"
                  ? "INT. CAFÉ — EVENING\nPaste your script here..."
                  : "A rainy evening. Two people meet at a cafe. A letter changes everything..."
            }
            onChange={(event) =>
              setDrafts((drafts) => ({ ...drafts, [mode]: event.target.value }))
            }
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter")
                event.currentTarget.form?.requestSubmit();
            }}
          />
          <span aria-live="polite">{prompt.length}/2000</span>
          <div className="ph-script-tools">
            {mode === "script" && (
              <label className="ph-script-upload">
                <Upload size={15} aria-hidden="true" />
                Upload screenplay (.txt or .fountain)
                <input
                  type="file"
                  accept=".txt,.fountain,text/plain"
                  className="sr-only"
                  aria-label="Upload screenplay"
                  disabled={busy}
                  onChange={async (event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (!file) return;
                    setUploadError("");
                    if (!/\.(txt|fountain)$/i.test(file.name)) {
                      setUploadError("Choose a .txt or .fountain screenplay.");
                      return;
                    }
                    if (file.size > 20000) {
                      setUploadError(
                        "Use a script excerpt of up to 2,000 characters.",
                      );
                      return;
                    }
                    try {
                      const script = await file.text();
                      if (script.length > 2000) {
                        setUploadError(
                          "Use a script excerpt of up to 2,000 characters.",
                        );
                        return;
                      }
                      setDrafts((drafts) => ({ ...drafts, script }));
                      input.current?.focus();
                    } catch {
                      setUploadError(
                        "Could not read the screenplay. Try pasting it instead.",
                      );
                    }
                  }}
                />
              </label>
            )}
            {mode === "script" && uploadError && (
              <p className="ph-creation-error" role="alert">
                {uploadError}
              </p>
            )}
          </div>
        </div>
        <fieldset>
          <legend>Start from</legend>
          <div className="ph-start-options">
            {options.map(({ id, label, description, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-pressed={mode === id}
                aria-label={label}
                disabled={busy}
                onClick={() => setMode(id)}
              >
                <Icon size={32} strokeWidth={1.5} aria-hidden="true" />
                <span>{label}</span>
                <small>{description}</small>
                {mode === id && (
                  <span className="ph-option-check" aria-hidden="true">
                    <Check size={14} strokeWidth={3} />
                  </span>
                )}
              </button>
            ))}
          </div>
        </fieldset>
        <button className="ph-primary ph-submit" type="submit" disabled={busy}>
          {busy ? "Starting…" : "Start a film"}
          <ArrowRight size={18} />
        </button>
      </form>
      <Dialog
        open={!!review}
        onOpenChange={(open) => {
          if (!open) setReview(null);
        }}
      >
        <DialogContent className="st-dialog">
          <DialogTitle>Review your film</DialogTitle>
          <DialogDescription>
            Start with this {review?.mode === "script" ? "script" : "idea"}. You
            can edit the scene breakdown before generating any media.
          </DialogDescription>
          <pre className="ph-brief-preview">{review?.prompt}</pre>
          <p className="ds-muted">
            No image or video generation starts here. Generation costs are shown
            when you choose to generate.
          </p>
          <button
            className="ds-button ds-primary"
            disabled={busy}
            onClick={() => {
              if (review) {
                onStart(review.mode, review.prompt);
                setReview(null);
              }
            }}
          >
            Create film
            <ArrowRight size={16} />
          </button>
          <button className="ds-button" onClick={() => setReview(null)}>
            Keep editing
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}
