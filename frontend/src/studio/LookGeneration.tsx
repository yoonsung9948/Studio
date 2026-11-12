import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Check, ImagePlus, Sparkles } from "lucide-react";
import { useStore } from "../stores/store";
import {
  updateLook,
  enqueueStudio,
  approveVersion,
  studioCost,
} from "../domain/studio-commands";
import {
  targetBusy,
  versionAsset,
  versionsFor,
} from "../domain/studio-selectors";
import { Field } from "./inspector";
import { commit } from "./generation";
import { StatusBadge } from "./design/Primitives";

export function LookGenerationWorkspace() {
  const { projectId = "", characterId = "", lookId = "" } = useParams();
  const data = useStore((state) => state.data),
    character = data.characters[characterId],
    look = data.studio.looks[lookId];
  const [prompt, setPrompt] = useState(""),
    [selectedId, setSelectedId] = useState("");
  if (
    !character ||
    character.projectId !== projectId ||
    !look ||
    look.characterId !== characterId
  )
    return <div className="st-empty">Look unavailable</div>;
  const versions = versionsFor(data, "look", lookId).filter(
    (version) => version.approval !== "rejected",
  );
  const selected =
      versions.find((version) => version.id === selectedId) ?? versions[0],
    asset = selected ? data.assets[selected.assetId] : undefined;
  const busy = targetBusy(data, "look", lookId),
    cost = studioCost("look");
  const create = () =>
    commit(
      (d) => {
        if (prompt.trim())
          updateLook(d, lookId, { description: prompt.trim() });
        enqueueStudio(d, "look", [lookId]);
      },
      "Look generation submitted",
      false,
    );
  return (
    <div className="ds-look-workspace" aria-label="Look generation workspace">
      <header>
        <Link
          className="ds-text"
          to={`/projects/${projectId}/world?kind=character&id=${characterId}`}
        >
          <ArrowLeft size={15} />
          Back to {character.name}
        </Link>
        <h1>{look.name}</h1>
        <p className="ds-muted">A new look, the same character.</p>
      </header>
      <div className="ds-look-grid">
        <section className="ds-look-main">
          <div className="ds-look-canvas">
            {asset?.url && !asset.missing ? (
              <img src={asset.url} alt={`${look.name} candidate`} />
            ) : (
              <div className="ds-empty">
                <ImagePlus size={36} />
                <h2>Find the look.</h2>
                <p>
                  Describe wardrobe, styling, and atmosphere while keeping the
                  approved character identity.
                </p>
              </div>
            )}
            {busy && (
              <div className="dd-generating" role="status">
                <span className="dd-busy-dot" />
                Generating this look…
              </div>
            )}
          </div>
          <div className="dd-section-heading">
            <h2>Look variations</h2>
            <small>{versions.length} available</small>
          </div>
          <div className="dd-take-strip">
            {versions.map((version, index) => (
              <button
                key={version.id}
                className="dd-take-card"
                aria-pressed={selected?.id === version.id}
                onClick={() => setSelectedId(version.id)}
              >
                {data.assets[version.assetId]?.url && (
                  <img src={data.assets[version.assetId].url} alt="" />
                )}
                <span>
                  Look {versions.length - index}
                  {version.approval === "approved" && <Check size={14} />}
                </span>
              </button>
            ))}
          </div>
          <section className="ds-look-identity">
            <h2>Identity reference</h2>
            <img
              src={
                versionAsset(data, character.canonicalVersionId)?.url ||
                character.reference
              }
              alt={`${character.name} approved identity`}
            />
            <span>
              {character.name}
              <StatusBadge tone={character.approved ? "success" : "neutral"}>
                {character.approved ? "Approved identity" : "Needs approval"}
              </StatusBadge>
            </span>
          </section>
        </section>
        <aside className="dd-controls" aria-label="Look direction">
          <h2>Look direction</h2>
          <Field
            label="Look name"
            value={look.name}
            onSave={(name) =>
              commit((d) => updateLook(d, lookId, { name }), "Look renamed")
            }
          />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
          >
            <label className="ds-field">
              Prompt
              <textarea
                aria-label="Look prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={look.description || "Describe this look…"}
                rows={6}
              />
            </label>
            <Field
              label="Styling"
              multiline
              value={look.styling}
              onSave={(styling) =>
                commit(
                  (d) => updateLook(d, lookId, { styling }),
                  "Styling saved",
                )
              }
            />
            <button
              className="ds-button ds-ai"
              type="submit"
              aria-label="Send message"
              disabled={busy || data.credits < cost}
            >
              <Sparkles size={16} />
              Generate look · {cost} cr
            </button>
          </form>
          <button
            className="ds-button ds-primary"
            disabled={!selected || busy}
            onClick={() =>
              selected &&
              commit((d) => approveVersion(d, selected.id), "Look approved")
            }
          >
            <Check size={16} />
            Use selected look
          </button>
          <p className="ds-muted">
            Local demo · generated variations use illustrative media. Approval
            records the identity source and look revision.
          </p>
        </aside>
      </div>
    </div>
  );
}
