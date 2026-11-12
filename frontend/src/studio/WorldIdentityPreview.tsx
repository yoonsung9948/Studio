import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Plus } from "lucide-react";
import { useStore } from "../stores/store";
import {
  characterLooks,
  characterReferences,
  referenceLabels,
  versionAsset,
} from "../domain/studio-selectors";
import { worldAppearances } from "../domain/workspace";
import { StatusBadge } from "./design/Primitives";
import { lookGenerationPath } from "./CharacterLooks";

export function WorldIdentityPreview({
  characterId,
  projectId,
  onEdit,
}: {
  characterId: string;
  projectId: string;
  onEdit(): void;
}) {
  const data = useStore((state) => state.data),
    character = data.characters[characterId];
  const [tab, setTab] = useState("identity");
  const looks = characterLooks(data, characterId),
    refs = characterReferences(data, characterId);
  return (
    <section className="ds-identity-preview">
      <header className="ds-section-title">
        <h2>{character.name}</h2>
        <StatusBadge tone={character.approved ? "success" : "neutral"}>
          {character.approved ? "Approved" : "Needs review"}
        </StatusBadge>
      </header>
      {character.reference && (
        <img
          className="ds-identity-image"
          src={character.reference}
          alt={`${character.name} identity`}
        />
      )}
      <h2>{character.name}</h2>
      <dl className="dd-take-details">
        <div>
          <dt>Role</dt>
          <dd>{character.role || "Not set"}</dd>
        </div>
        <div>
          <dt>Description</dt>
          <dd>{character.description}</dd>
        </div>
      </dl>
      <nav className="ds-tabs" aria-label="Character reference views">
        {["identity", "looks", "angles"].map((value) => (
          <button
            key={value}
            aria-pressed={tab === value}
            onClick={() => setTab(value)}
          >
            {value === "angles"
              ? "Reference angles"
              : value[0].toUpperCase() + value.slice(1)}
          </button>
        ))}
      </nav>
      {tab === "looks" ? (
        <div className="ds-reference-mini-grid">
          {looks.map((look) => (
            <Link
              key={look.id}
              to={lookGenerationPath(projectId, characterId, look.id)}
            >
              {versionAsset(data, look.primaryVersionId)?.url ? (
                <img
                  src={versionAsset(data, look.primaryVersionId)!.url}
                  alt=""
                />
              ) : (
                <span className="ds-reference-placeholder">
                  <Plus size={20} />
                </span>
              )}
              <span>{look.name}</span>
            </Link>
          ))}
          <button onClick={onEdit}>
            <span className="ds-reference-placeholder">
              <Plus size={20} />
            </span>
            New look
          </button>
        </div>
      ) : (
        <div className="ds-reference-mini-grid">
          {refs.map((ref) => {
            const asset = versionAsset(data, ref.activeVersionId);
            return (
              <button key={ref.id} onClick={onEdit}>
                {asset?.url ? (
                  <img src={asset.url} alt="" />
                ) : (
                  <span className="ds-reference-placeholder">
                    <Plus size={20} />
                  </span>
                )}
                <span>{referenceLabels[ref.type]}</span>
              </button>
            );
          })}
          {!refs.length && (
            <p className="ds-muted">No approved reference angles yet.</p>
          )}
          <button onClick={onEdit}>
            <span className="ds-reference-placeholder">
              <Plus size={20} />
            </span>
            Add reference
          </button>
        </div>
      )}
      <div className="ds-section-title ds-usage-link">
        <h3>
          Appears in · {worldAppearances(data, "character", characterId).length}{" "}
          shots
        </h3>
        <Link
          className="ds-text"
          to={`/projects/${projectId}/world?kind=character&id=${characterId}`}
        >
          View usage
          <ArrowRight size={14} />
        </Link>
      </div>
      <button className="ds-button" onClick={onEdit}>
        Edit character
        <ArrowRight size={15} />
      </button>
    </section>
  );
}
