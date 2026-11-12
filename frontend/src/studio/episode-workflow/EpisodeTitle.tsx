import { useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { commit } from "../generation";

/** A single title editor shared by every episode stage. */
export function EpisodeTitle({
  episodeId,
  title,
}: {
  episodeId: string;
  title: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const button = useRef<HTMLButtonElement>(null);
  const finished = useRef(false);
  const finish = (save: boolean, restoreFocus = false) => {
    if (finished.current) return;
    finished.current = true;
    const next = draft.trim();
    if (save && next && next !== title)
      commit((data) => {
        data.episodes[episodeId].title = next;
      }, "Episode renamed");
    setEditing(false);
    if (restoreFocus) button.current?.focus();
  };
  return (
    <div className="ep-title-row">
      {editing ? (
        <input
          autoFocus
          aria-label="Episode title"
          value={draft}
          maxLength={200}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => finish(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === "Escape") {
              event.preventDefault();
              finish(event.key === "Enter", true);
            }
          }}
        />
      ) : (
        <h1>{title}</h1>
      )}
      <button
        ref={button}
        className="ds-icon"
        aria-label="Edit episode title"
        onClick={() => {
          finished.current = false;
          setDraft(title);
          setEditing(true);
        }}
      >
        <Pencil size={18} />
      </button>
    </div>
  );
}
