import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Plus, Search, Sparkles, UserRound } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../components/ui/dialog";
import {
  assetCharacters,
  characterView,
  characterViewSlots,
  createAssetCharacter,
} from "../../domain/asset-characters";
import {
  createEpisodeLook,
  episodeReferenceCharacters,
  linkCharacterToEpisode,
} from "../../domain/episode-characters";
import { useStore } from "../../stores/store";
import { commit } from "../generation";

export function AddEpisodeCharacter({
  episodeId,
  onClose,
  onAdded,
}: {
  episodeId: string;
  onClose(): void;
  onAdded(characterId: string, lookId?: string): void;
}) {
  const data = useStore((state) => state.data),
    navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [id, setId] = useState("");
  const [error, setError] = useState("");
  const linked = episodeReferenceCharacters(data, episodeId);
  const characters = assetCharacters(data).filter(
    (character) =>
      !linked.some(
        (entry) =>
          entry.id === character.id || entry.sourceCharacterId === character.id,
      ),
  );
  const filtered = characters.filter((character) =>
    character.name.toLowerCase().includes(query.toLowerCase()),
  );
  const selected =
    filtered.find((character) => character.id === id) ?? filtered[0];
  const views = selected
    ? characterViewSlots
        .map((slot) => ({
          ...slot,
          ...characterView(data, selected, slot.type),
        }))
        .filter((view) => view.ready)
    : [];
  const add = (withLook: boolean) => {
    if (!selected) return;
    let characterId = "",
      lookId: string | undefined;
    if (
      commit((next) => {
        characterId = linkCharacterToEpisode(next, episodeId, selected.id);
        if (withLook) lookId = createEpisodeLook(next, episodeId, characterId);
      }, "Character linked to episode")
    )
      onAdded(characterId, lookId);
    else setError("This character could not be linked. Try another character.");
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="st-dialog er-assets-drawer">
        <DialogTitle>Add from Assets</DialogTitle>
        <DialogDescription>
          Link a saved identity to this episode, then create looks for its
          scenes.
        </DialogDescription>
        <label className="ac-search">
          <Search size={18} />
          <input
            aria-label="Search asset characters"
            placeholder="Search characters…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="er-source-cards">
          {filtered.map((character) => (
            <button
              key={character.id}
              aria-label={`Choose ${character.name}`}
              aria-pressed={selected?.id === character.id}
              onClick={() => setId(character.id)}
            >
              <div>
                {character.reference ? (
                  <img src={character.reference} alt="" />
                ) : (
                  <UserRound size={38} />
                )}
                {selected?.id === character.id && (
                  <span className="er-selected-check">
                    <Check size={15} />
                  </span>
                )}
              </div>
              <strong>{character.name}</strong>
              <small>Identity · v{character.revision ?? 1}</small>
            </button>
          ))}
        </div>
        {!filtered.length && (
          <p className="ac-muted">
            {characters.length
              ? "No matching characters."
              : "All available characters are already linked. Create a new one in Assets."}
          </p>
        )}
        {selected && (
          <section className="er-source-preview">
            <h3>Selected character</h3>
            <strong>{selected.name}</strong>
            <p className="ac-muted">Identity · v{selected.revision ?? 1}</p>
            <div>
              {views.length
                ? views
                    .slice(0, 4)
                    .map((view) => (
                      <img key={view.type} src={view.image} alt={view.label} />
                    ))
                : selected.reference && (
                    <img
                      src={selected.reference}
                      alt={`${selected.name} identity`}
                    />
                  )}
            </div>
            <p className="ac-muted">
              Links the saved identity and views. Does not assign every scene.
            </p>
          </section>
        )}
        {error && (
          <p className="ac-error" role="alert">
            {error}
          </p>
        )}
        <footer className="er-drawer-actions">
          <button
            className="ds-button ds-primary ac-wide"
            disabled={!selected}
            onClick={() => add(true)}
          >
            <Sparkles size={18} />
            {selected
              ? `Add ${selected.name} and create a look`
              : "Select a character"}
          </button>
          <button
            className="ds-button"
            disabled={!selected}
            onClick={() => add(false)}
          >
            Add identity only
          </button>
          <button
            className="ac-text-button"
            onClick={() => {
              let created = "";
              if (
                commit((next) => {
                  created = createAssetCharacter(next);
                }, "Character created")
              )
                navigate(`/assets?character=${created}&tab=identity`);
            }}
          >
            <Plus size={15} />
            Create new character
          </button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
