import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Check, Film, MessageSquare } from "lucide-react";
import { useEpisodeScope } from "./scope";
import { StudioPlayer } from "../director-desk/StudioPlayer";
import { commit } from "../generation";
import { timecode } from "../../domain/selectors";
import { addCutNote, resolveCutNote } from "../../domain/episode-review";
import { useEpisodeDelivery } from "./useEpisodeDelivery";
import { useSelection } from "../selection";

export function EpisodeCutReview({
  episodeId,
  onFinish,
}: {
  episodeId: string;
  onFinish(): void;
}) {
  const { data, episode, shots } = useEpisodeScope(episodeId);
  const [position, setPosition] = useState(0),
    [text, setText] = useState("");
  const navigate = useNavigate();
  const { open, remaining, canExport, approved, exportEpisode } =
    useEpisodeDelivery(episodeId);
  const total = shots.reduce((n, shot) => n + shot.outFrame - shot.inFrame, 0);
  useEffect(() => {
    setPosition((frame) =>
      Math.max(0, Math.min(Math.max(0, total - 1), frame)),
    );
  }, [total]);
  const notes = episode.cutReview?.notes ?? [];
  let end = 0;
  const current = shots.find((shot) => {
    end += shot.outFrame - shot.inFrame;
    return position < end;
  });
  return (
    <div className="ep-columns">
      <section className="ep-cut-main" aria-label="Assembled episode review">
        <div className="ep-cut-meta">
          <span>Episode cut · v{episode.timelineVersion}</span>
          <span>
            {timecode(total / 30)} ·{" "}
            {data.studio.setups[shots[0]?.sceneId]?.generation?.aspectRatio ??
              "16:9"}
          </span>
        </div>
        {shots.length ? (
          <StudioPlayer
            timeline
            shotIds={shots.map((shot) => shot.id)}
            position={position}
            onPositionChange={setPosition}
          />
        ) : (
          <div className="ep-empty">
            <Film size={32} />
            <h2>No shots to review yet</h2>
            <p>Plan your scenes before assembling an episode.</p>
          </div>
        )}
        <div className="ep-review-badges">
          <span className={open ? "has-open-notes" : ""}>
            {open
              ? `${open} note${open === 1 ? "" : "s"} to resolve`
              : "No open feedback"}
          </span>
          <span>Cut v{episode.timelineVersion}</span>
          {approved && <span>✓ Cut approved</span>}
        </div>
        <div className="ep-linked">
          <Film size={24} />
          <div>
            <h3>Review the assembled episode</h3>
            <p>Timing, sound, story, and transitions.</p>
            <small>
              {remaining > 0
                ? "Animatic preview includes unfinished shots."
                : "Approved video takes in timeline order."}
            </small>
          </div>
        </div>
      </section>
      <aside className="ep-inspector" aria-label="Cut feedback">
        <header>
          <h2>Cut feedback</h2>
          <span>v{episode.timelineVersion}</span>
        </header>
        <div className="ep-feedback-list">
          {notes.map((note) => (
            <article className="ep-feedback" key={note.id}>
              <header>
                <button
                  className="ep-time-link"
                  onClick={() =>
                    setPosition(Math.min(Math.max(0, total - 1), note.frame))
                  }
                >
                  You · {timecode(note.frame / 30)}
                </button>
                <span>{note.resolved ? "Resolved" : "Open"}</span>
              </header>
              <p>{note.text}</p>
              {note.shotId && data.shots[note.shotId] && (
                <small>
                  {data.shots[note.shotId].title}
                  {note.version !== episode.timelineVersion &&
                    ` · Cut v${note.version}`}
                </small>
              )}
              <div>
                {note.shotId &&
                  shots.some((shot) => shot.id === note.shotId) && (
                    <button
                      className="ds-button"
                      onClick={() => {
                        useSelection
                          .getState()
                          .replace([`shot:${note.shotId}`]);
                        navigate({
                          search: `?view=timeline&shot=${note.shotId}`,
                        });
                      }}
                    >
                      Open in edit
                    </button>
                  )}
                <button
                  className="ds-button"
                  onClick={() =>
                    commit(
                      (d) => resolveCutNote(d, episodeId, note.id),
                      note.resolved ? "Feedback reopened" : "Feedback resolved",
                    )
                  }
                >
                  {note.resolved ? "Reopen" : "Resolve"}
                </button>
              </div>
            </article>
          ))}
        </div>
        {!notes.length && (
          <div className="ep-feedback-empty">
            <MessageSquare size={22} />
            <p>No feedback yet. Add a note at the current time.</p>
          </div>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (
              commit(
                (d) => addCutNote(d, episodeId, position, text, current?.id),
                "Cut feedback saved",
              )
            )
              setText("");
          }}
        >
          <label className="ep-field">
            Add a note · {timecode(position / 30)}
            <textarea
              aria-label="Cut feedback note"
              placeholder="Feedback at the current time…"
              maxLength={2000}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <button
            className="ds-button ep-wide"
            type="submit"
            disabled={!text.trim() || !shots.length}
          >
            Add note
          </button>
        </form>
        <div className="ep-inspector-continuity">
          <p aria-live="polite">
            {remaining
              ? `${remaining} shot${remaining === 1 ? "" : "s"} still need approved video takes.`
              : open
                ? "Resolve the remaining feedback to approve this cut."
                : shots.length
                  ? "All shots approved and feedback resolved."
                  : "Add shots to begin your episode."}
          </p>
          {remaining > 0 && (
            <button className="ds-button ep-wide" onClick={onFinish}>
              Finish remaining shots <ArrowRight size={18} />
            </button>
          )}
          <button
            className="ds-button ds-primary ep-wide"
            disabled={!canExport}
            onClick={exportEpisode}
          >
            {approved ? "Export approved cut" : "Approve cut & export"}
            <Check size={19} />
          </button>
        </div>
      </aside>
    </div>
  );
}
