import {
  ArrowRight,
  CheckCircle2,
  Clapperboard,
  MapPin,
  Sparkles,
  Tag,
} from "lucide-react";
import { useState } from "react";
import { useEpisodeScope } from "./scope";
import { SaveStatus } from "../design/SavingState";
import { DraftField } from "../design/Primitives";
import { commit } from "../generation";
import { useSelection } from "../selection";
import { CommandButton } from "../commands";
import {
  sceneScreenplay,
  proposeSceneAssistance,
  applySceneSuggestion,
  type SceneSuggestion,
} from "../../domain/scene-assistance";
import { updateScenePlan } from "../../domain/workflow";
import { updateDirection } from "../../domain/studio-commands";
import { episodeContinuity } from "../production/episode-continuity";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../components/ui/dialog";
import { sceneShots } from "../episode-board/scene-presentation";

export function EpisodeScript({
  episodeId,
  onBoard,
}: {
  episodeId: string;
  onBoard(): void;
}) {
  const { data, project, scenes, scene } = useEpisodeScope(episodeId);
  const [proposal, setProposal] = useState<SceneSuggestion>();
  const refs = episodeContinuity(data, episodeId);
  const plan = () => {
    if (scene) useSelection.getState().replace([`scene:${scene.id}`]);
    onBoard();
  };
  if (!scene)
    return (
      <section className="ep-empty">
        <h2>Start your episode script</h2>
        <p>Add a scene to write its story, dialogue, and references.</p>
        <CommandButton id="scene.add" className="ds-button ds-primary">
          Add scene
        </CommandButton>
      </section>
    );
  const notes = data.studio.setups[scene.id]?.direction.notes ?? "";
  const locked = sceneShots(data, scene.id).some((shot) => shot.locked);
  return (
    <div className="ep-columns">
      <section className="ep-script-main" aria-label="Scene script">
        <nav className="ep-scene-picker" aria-label="Script scenes">
          {scenes.map((item) => (
            <button
              key={item.id}
              className="ds-button"
              aria-pressed={item.id === scene.id}
              onClick={() =>
                useSelection.getState().replace([`scene:${item.id}`])
              }
            >
              {item.title}
            </button>
          ))}
          <CommandButton id="scene.add" className="ds-button">
            + Scene
          </CommandButton>
        </nav>
        <section className="ep-screenplay">
          <header>
            <h2>{scene.title}</h2>
            <span>
              Scene {String(scenes.indexOf(scene) + 1).padStart(2, "0")} ·
              <SaveStatus compact />
            </span>
          </header>
          <DraftField
            key={scene.id}
            label="Scene screenplay"
            className="ep-script-input"
            value={sceneScreenplay(data, scene.id)}
            multiline
            rows={21}
            disabled={locked}
            maxLength={10000}
            onSave={(screenplay) =>
              commit(
                (d) => updateScenePlan(d, scene.id, { screenplay }),
                "Scene screenplay saved",
              )
            }
          />
        </section>
        <div className="ep-linked">
          <Clapperboard size={24} />
          <div>
            <h3>
              {sceneShots(data, scene.id).length} shots linked to this scene
            </h3>
            <p>Keep the script and scene board connected.</p>
          </div>
          <button className="ds-button" onClick={plan}>
            Open linked shots <ArrowRight size={18} />
          </button>
        </div>
      </section>
      <aside className="ep-inspector" aria-label="Story and references">
        <header>
          <h2>{scene.title}</h2>
          <span>Story & references</span>
        </header>
        <label className="ep-field">
          Scene intent
          <DraftField
            key={`intent:${scene.id}`}
            value={scene.description}
            label="Scene intent"
            multiline
            disabled={locked}
            onSave={(description) =>
              commit(
                (d) => updateScenePlan(d, scene.id, { description }),
                "Scene intent saved",
              )
            }
          />
        </label>
        <h3 className="ep-ref-heading">Episode references</h3>
        <div className="ep-reference-list">
          {refs.cast.map((entry) => {
            const character = data.characters[entry.id];
            return (
              <div key={entry.id}>
                {character.reference && (
                  <img src={character.reference} alt="" />
                )}
                <span>
                  {character.name}
                  <small>
                    {entry.lookIds
                      .map((id) => data.studio.looks[id].name)
                      .join(" · ") || "Identity reference"}
                  </small>
                </span>
              </div>
            );
          })}
          {refs.locations.map((entry) => (
            <div key={entry.id}>
              <MapPin size={20} />
              <span>{data.studio.locations[entry.id].name}</span>
            </div>
          ))}
          {refs.props.map((entry) => (
            <div key={entry.id}>
              <Tag size={20} />
              <span>
                {
                  project.worldElements?.find((prop) => prop.id === entry.id)
                    ?.name
                }
              </span>
            </div>
          ))}
        </div>
        {!refs.cast.length && !refs.locations.length && !refs.props.length && (
          <p className="ep-subtle">
            No references assigned to this episode yet.
          </p>
        )}
        <label className="ep-field">
          Continuity
          <DraftField
            key={`continuity:${scene.id}`}
            value={notes}
            label="Scene continuity"
            multiline
            maxLength={2000}
            disabled={locked}
            onSave={(notes) =>
              commit(
                (d) => updateDirection(d, scene.id, { notes }),
                "Continuity saved",
              )
            }
          />
        </label>
        <button
          className="ds-button ep-wide ep-enhance"
          disabled={locked}
          onClick={() => setProposal(proposeSceneAssistance(data, scene.id))}
        >
          <Sparkles size={16} />
          Enhance prompt
        </button>
        <div className="ep-inspector-continuity">
          <p className="ep-ready">
            <CheckCircle2 size={18} />
            {sceneScreenplay(data, scene.id).trim()
              ? "Ready to plan shots"
              : "Write your scene to begin"}
          </p>
          <button className="ds-button ds-primary ep-wide" onClick={plan}>
            Plan this scene <ArrowRight size={19} />
          </button>
        </div>
      </aside>
      <Dialog
        open={!!proposal}
        onOpenChange={(open) => !open && setProposal(undefined)}
      >
        <DialogContent className="st-dialog ep-enhancement-dialog">
          <DialogTitle>Enhance prompt</DialogTitle>
          <DialogDescription>
            Review the proposed direction before applying it to this scene.
            Original dialogue is preserved.
          </DialogDescription>
          <pre>{proposal?.revision}</pre>
          <div className="ep-heading-actions">
            <button
              className="ds-button"
              onClick={() => setProposal(undefined)}
            >
              Keep original
            </button>
            <button
              className="ds-button ds-primary"
              onClick={() => {
                if (
                  proposal &&
                  commit(
                    (d) => applySceneSuggestion(d, proposal, "enhance"),
                    "Scene enhanced",
                  )
                )
                  setProposal(undefined);
              }}
            >
              Apply enhancement
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
