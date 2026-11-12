import type { Ref } from "react";
import { SceneReferenceUploads } from "./SceneReferenceUploads";
import { ArrowRight, ImageIcon } from "lucide-react";
import { ensureSetup } from "../../domain/scene-preflight";
import { DraftField } from "../design/Primitives";
import { commit } from "../generation";
import { referenceCards } from "./ReferencePicker";
import type { ProduceContext } from "./useProduce";
export function SceneFoundations({
  context,
  onReferences,
  panelRef,
}: {
  context: ProduceContext;
  panelRef?: Ref<HTMLElement>;
  onReferences(): void;
}) {
  const { data, scene, shots, go } = context;
  if (!scene) return null;
  const setup = data.studio.setups[scene.id],
    cards = referenceCards(data, scene.id);
  return (
    <aside
      ref={panelRef}
      className="produce-panel produce-foundations"
      aria-label="Scene planning inspector"
    >
      <header>
        <h2>Scene foundations</h2>
        <button className="produce-link" onClick={() => onReferences()}>
          Edit references
        </button>
      </header>
      <h3>Characters</h3>
      <div className="produce-foundation-cast">
        {cards
          .filter((card) => card.category === "character")
          .map((card) => (
            <ReferenceCard
              key={card.id}
              card={card}
              onClick={() => onReferences()}
            />
          ))}
      </div>
      {!["character"].some((kind) =>
        cards.some((card) => card.category === kind),
      ) && (
        <button
          className="produce-add-reference"
          onClick={() => onReferences()}
        >
          + Choose characters
        </button>
      )}
      {(
        [
          ["place", "Location"],
          ["prop", "Key props"],
        ] as const
      ).map(([kind, title]) => (
        <section key={kind}>
          <header>
            <h3>{title}</h3>
            <button className="produce-link" onClick={() => onReferences()}>
              Change
            </button>
          </header>
          {cards
            .filter((card) => card.category === kind)
            .map((card) => (
              <ReferenceCard
                key={card.id}
                card={card}
                onClick={() => onReferences()}
              />
            ))}
          {!cards.some((card) => card.category === kind) && (
            <button
              className="produce-add-reference"
              onClick={() => onReferences()}
            >
              + Add {title.toLowerCase()}
            </button>
          )}
        </section>
      ))}
      <SceneReferenceUploads context={context} />
      <details>
        <summary>Sound notes (optional)</summary>
        <DraftField
          key={scene.id}
          label="Scene sound notes"
          multiline
          rows={2}
          value={setup?.soundNotes ?? ""}
          onSave={(soundNotes) =>
            commit((d) => {
              ensureSetup(d, scene.id).soundNotes = soundNotes;
            }, "Sound notes saved")
          }
        />
      </details>
      <button
        className="ds-button ds-primary produce-next"
        disabled={!shots.length}
        onClick={() => go("shots")}
      >
        Create starting frames
        <ArrowRight size={17} />
      </button>
    </aside>
  );
}
function ReferenceCard({
  card,
  onClick,
}: {
  card: ReturnType<typeof referenceCards>[number];
  onClick(): void;
}) {
  return (
    <button className="produce-foundation-card" onClick={onClick}>
      {card.image ? (
        <img src={card.image} alt="" />
      ) : (
        <div className="produce-reference-placeholder">
          <ImageIcon />
        </div>
      )}
      <span>
        <b>{card.name}</b>
        <small>{card.detail}</small>
      </span>
    </button>
  );
}
