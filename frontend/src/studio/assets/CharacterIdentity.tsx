import { ArrowRight, ChevronDown, ChevronRight, Image } from "lucide-react";
import { Link } from "react-router-dom";
import { useState } from "react";
import type { Character, Data } from "../../domain/types";
import {
  characterEpisodeUsage,
  characterView,
  characterViewSlots,
} from "../../domain/asset-characters";
import { updateCharacter } from "../../domain/studio-commands";
import { commit } from "../generation";

export function CharacterIdentity({
  data,
  character,
  onViews,
}: {
  data: Data;
  character: Character;
  onViews(): void;
}) {
  const [name, setName] = useState(character.name);
  const [description, setDescription] = useState(
    character.appearance || character.description,
  );
  const [notes, setNotes] = useState(character.notes ?? "");
  const [error, setError] = useState("");
  const dirty =
    name !== character.name ||
    description !== (character.appearance || character.description) ||
    notes !== (character.notes ?? "");
  const saved = characterViewSlots
    .map((slot) => ({ ...slot, ...characterView(data, character, slot.type) }))
    .filter((view) => view.ready);
  const usage = characterEpisodeUsage(data, character.id);
  const reset = () => {
    setName(character.name);
    setDescription(character.appearance || character.description);
    setNotes(character.notes ?? "");
    setError("");
  };
  return (
    <div className="ac-identity-layout">
      <form
        className="ac-panel ac-identity-form"
        aria-label="Character identity"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) {
            setError("Enter a character name.");
            return;
          }
          if (
            commit(
              (next) =>
                updateCharacter(next, character.id, {
                  name: name.trim(),
                  appearance: description,
                  notes,
                }),
              "Character saved",
            )
          )
            setError("");
          else
            setError(
              "Your changes could not be saved. Check the fields and try again.",
            );
        }}
      >
        <div className="ac-section-heading">
          <h3>Character details</h3>
          <span className="ac-save-status" aria-live="polite">
            {dirty ? "Unsaved changes" : "Saved"}
          </span>
        </div>
        <label className="ac-field">
          Name
          <input
            value={name}
            maxLength={100}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="ac-field">
          Description
          <textarea
            aria-label="Description"
            value={description}
            maxLength={3000}
            rows={6}
            onChange={(event) => setDescription(event.target.value)}
          />
          <small className="ac-counter">{description.length}/3000</small>
        </label>
        <p className="ac-muted">
          Who they are, how they look, what stays consistent.
        </p>
        <details className="ac-private-notes">
          <summary>
            <ChevronDown size={17} />
            Private notes
          </summary>
          <label className="ac-field">
            Notes
            <textarea
              value={notes}
              rows={3}
              maxLength={2000}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
        </details>
        {error && (
          <p role="alert" className="ac-error">
            {error}
          </p>
        )}
        <footer className="ac-form-actions">
          <span className="ac-muted">
            {dirty
              ? "Save your changes to update this identity."
              : "Build consistent visual references in Views."}
          </span>
          <button
            type="button"
            className="ds-button"
            onClick={reset}
            disabled={!dirty}
          >
            Cancel
          </button>
          <button
            className="ds-button ds-primary"
            type="submit"
            disabled={!dirty}
          >
            Save changes
          </button>
        </footer>
      </form>
      <aside
        className="ac-panel ac-identity-inspector"
        aria-label="Identity preview and usage"
      >
        {character.reference ? (
          <img
            className="ac-identity-photo"
            src={character.reference}
            alt={`${character.name} identity`}
          />
        ) : (
          <div className="ac-empty-photo">
            <Image size={36} />
            <span>No identity photo yet</span>
          </div>
        )}
        <div className="ac-section-heading">
          <h3>Identity photo</h3>
          <button className="ac-text-button" onClick={onViews}>
            Change in Views <ArrowRight size={15} />
          </button>
        </div>
        <section className="ac-usage">
          <h3>Used in episodes</h3>
          {usage.map((episode) => {
            const project = data.projects[episode.projectId];
            return (
              <Link
                key={episode.id}
                to={`/projects/${project.id}/episodes/${episode.id}/references`}
                className="ac-usage-row"
              >
                {project.cover && <img src={project.cover} alt="" />}
                <span>
                  <strong>{project.title}</strong>
                  <small>
                    Episode{" "}
                    {String(
                      project.episodeIds.indexOf(episode.id) + 1,
                    ).padStart(2, "0")}{" "}
                    · {episode.title}
                  </small>
                </span>
                <ChevronRight size={18} />
              </Link>
            );
          })}
          {!usage.length && (
            <p className="ac-muted">
              Not assigned to an episode yet. Choose Views to use this character
              in a scene.
            </p>
          )}
        </section>
        <button className="ac-saved-summary" onClick={onViews}>
          <strong>{saved.length} saved views</strong>
          <span className="ac-saved-thumbnails">
            {saved.slice(0, 4).map((view) => (
              <img key={view.type} src={view.image} alt={view.label} />
            ))}
            {!saved.length && (
              <span className="ac-muted">
                Build visual references in Views.
              </span>
            )}
          </span>
          <span className="ac-text-button">
            Open views <ArrowRight size={15} />
          </span>
        </button>
      </aside>
    </div>
  );
}
