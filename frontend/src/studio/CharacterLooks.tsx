import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, Plus, UserRound } from "lucide-react";
import { useStore } from "../stores/store";
import { createLook, updateLook } from "../domain/studio-commands";
import { characterLooks, lookFrontPortrait } from "../domain/studio-selectors";
import { commit } from "./generation";
import { useSelection, type EntityKey } from "./selection";
import { SelectionSurface } from "./SelectionSurface";
import { Field } from "./inspector";
import {
  CommandButton,
  CommandMenu,
  useRegisterCommands,
  type StudioCommand,
} from "./commands";

export const lookGenerationPath = (
  projectId: string,
  characterId: string,
  lookId: string,
) =>
  `/projects/${encodeURIComponent(projectId)}/world/characters/${encodeURIComponent(characterId)}/looks/${encodeURIComponent(lookId)}`;

export function CharacterLooks({
  characterId,
  projectId,
}: {
  characterId: string;
  projectId: string;
}) {
  const d = useStore((s) => s.data),
    keys = useSelection((s) => s.keys),
    navigate = useNavigate();
  const looks = characterLooks(d, characterId);
  const commands = useMemo<StudioCommand[]>(
    () => [
      {
        id: "world.look.add",
        label: "Add Look",
        run: () => {
          let id = "";
          if (
            commit((data) => {
              id = createLook(data, characterId);
            }, "Look added")
          )
            useSelection.getState().replace([`look:${id}`]);
        },
      },
      ...looks.map((look) => ({
        id: `world.look.open:${look.id}`,
        label: `Open ${look.name}`,
        run: () =>
          navigate(lookGenerationPath(projectId, characterId, look.id)),
      })),
    ],
    [
      characterId,
      projectId,
      navigate,
      looks.map((look) => `${look.id}:${look.name}`).join("|"),
    ],
  );
  useRegisterCommands("world-looks", commands);
  return (
    <section className="st-character-looks" aria-label="Character looks">
      <header className="st-section-heading">
        <h2>Looks</h2>
        <CommandButton id="world.look.add">
          <Plus size={13} />
          Add Look
        </CommandButton>
      </header>
      <SelectionSurface
        className="st-panel-scroll st-look-cards-scroll"
        aria-label="Look cards"
      >
        <div className="st-look-card-grid">
          {looks.map((look) => {
            const asset = lookFrontPortrait(d, look.id),
              key: EntityKey = `look:${look.id}`;
            const open = () =>
              navigate(lookGenerationPath(projectId, characterId, look.id));
            return (
              <CommandMenu
                key={look.id}
                ids={[`world.look.open:${look.id}`, "world.look.add"]}
                onSelect={() => {
                  if (!keys.includes(key))
                    useSelection.getState().replace([key]);
                }}
              >
                <article
                  className={`st-world-card st-look-card ${keys.includes(key) ? "is-selected" : ""}`}
                  data-selection-key={key}
                  aria-label={`Look ${look.name}`}
                  tabIndex={0}
                  onClick={(event) =>
                    useSelection.getState().choose(
                      key,
                      looks.map((l): EntityKey => `look:${l.id}`),
                      event,
                    )
                  }
                  onDoubleClick={open}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === "Enter") open();
                    if (event.key === " ") {
                      event.preventDefault();
                      useSelection.getState().choose(key);
                    }
                  }}
                >
                  <div className="st-world-card-preview st-look-portrait">
                    {asset ? (
                      <img
                        src={asset.url}
                        alt={`${look.name} front portrait`}
                          className={asset.url.startsWith("/media/studio-look-") ? "st-look-legacy-portrait" : undefined}
                      />
                    ) : (
                      <UserRound size={36} />
                    )}
                    <span>{asset ? "Still" : "Draft"}</span>
                  </div>
                  <div className="st-world-card-copy">
                    <Field
                      label={`Look name ${look.name}`}
                      value={look.name}
                      onSave={(name) =>
                        commit(
                          (data) => updateLook(data, look.id, { name }),
                          "Look renamed",
                        )
                      }
                    />
                    <Field
                      label={`Clothing for ${look.name}`}
                      value={look.description}
                      multiline
                      onSave={(description) =>
                        commit(
                          (data) => updateLook(data, look.id, { description }),
                          "Look updated",
                        )
                      }
                    />
                    <div>
                      <small>Front portrait</small>
                      <button
                        className="st-text-button"
                        aria-label={`Open ${look.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          open();
                        }}
                      >
                        Open <ArrowUpRight size={12} />
                      </button>
                    </div>
                  </div>
                </article>
              </CommandMenu>
            );
          })}
        </div>
        {!looks.length && (
          <div className="st-home-empty">
            <UserRound size={28} />
            <p>No looks yet</p>
            <CommandButton id="world.look.add" />
          </div>
        )}
      </SelectionSurface>
    </section>
  );
}
