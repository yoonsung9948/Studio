import { Check, MapPin, UserRound } from "lucide-react";
import { useStore } from "../../stores/store";
import {
  characterReady,
  effectiveCast,
  versionAsset,
} from "../../domain/studio-selectors";
import { generationInputs } from "../../domain/generation-inputs";

export function ReferenceStrip({ shotId }: { shotId: string }) {
  const data = useStore((state) => state.data);
  const shot = data.shots[shotId];
  const inputs = generationInputs(data, shot.sceneId, shotId);
  const location = inputs.locationId
    ? data.studio.locations[inputs.locationId]
    : undefined;
  const references = effectiveCast(data, shotId).map((assignment) => {
    const character = data.characters[assignment.characterId];
    const look = assignment.lookId
      ? data.studio.looks[assignment.lookId]
      : undefined;
    const asset = versionAsset(
      data,
      look?.primaryVersionId ?? character?.canonicalVersionId,
    );
    return {
      id: character.id,
      title: character.name,
      detail: look?.name ?? "Identity reference",
      url: asset?.url || character.reference,
      icon: UserRound,
      approved: characterReady(data, character.id),
    };
  });
  if (location)
    references.push({
      id: location.id,
      title: location.name,
      detail: "Location reference",
      url: location.assetId ? (data.assets[location.assetId]?.url ?? "") : "",
      icon: MapPin,
      approved: false,
    });
  return (
    <section className="dd-references" aria-label="Shot references">
      <div className="dd-section-heading">
        <h3>References</h3>
        <span>Inherited from the scene</span>
      </div>
      <div className="dd-reference-grid">
        {references.map((reference) => (
          <div className="dd-reference" key={reference.id}>
            {reference.url ? (
              <img src={reference.url} alt={reference.title} />
            ) : (
              <div className="dd-reference-empty">
                <reference.icon size={24} />
              </div>
            )}
            <div>
              <span>
                {reference.title}
                <small>{reference.detail}</small>
              </span>
              {reference.approved && (
                <Check
                  className="dd-approved-check"
                  size={23}
                  aria-label="Approved character reference"
                />
              )}
            </div>
          </div>
        ))}
        {!references.length && (
          <p className="dd-muted">
            Add your cast and location in Scene setup to keep this shot
            connected to its world.
          </p>
        )}
      </div>
    </section>
  );
}
