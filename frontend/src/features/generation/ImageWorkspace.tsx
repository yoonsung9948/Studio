import { useState } from "react";
import { ArrowLeft, Check, ImageIcon, Sparkles } from "lucide-react";
import { Button } from "../../components/ui/button";
import { DialogDescription, DialogTitle } from "../../components/ui/dialog";
import { useStore } from "../../stores/store";
import { enqueueFrameImage } from "../../domain/commands";
import {
  generationInputs,
  saveGenerationInputs,
} from "../../domain/generation-inputs";
import { effectiveCast, versionAsset } from "../../domain/studio-selectors";
import { CONFIG } from "../../domain/types";
import { isBusy } from "../../domain/selectors";
import type { FrameKind } from "./FrameControls";

export function ImageWorkspace({
  shotId,
  kind,
  back,
  embedded = false,
}: {
  shotId: string;
  kind: FrameKind;
  back: () => void;
  embedded?: boolean;
}) {
  const d = useStore((s) => s.data),
    mutate = useStore((s) => s.mutate);
  const shot = d.shots[shotId],
    scene = d.scenes[shot.sceneId];
  const inputs = generationInputs(d, scene.id, shotId);
  const [prompt, setPrompt] = useState(
    [
      inputs.instructions,
      shot.action,
      "Describe the composition, framing, and lighting.",
    ]
      .filter(Boolean)
      .join("\n\n"),
  );
  const [selected, setSelected] = useState<string | undefined>(inputs[kind]);
  const [error, setError] = useState("");
  const [messages, setMessages] = useState<string[]>([]);
  const busy = isBusy(d, shotId);
  const takes = Object.values(d.takes)
    .filter((t) => t.shotId === shotId && t.kind === "image")
    .sort((a, b) => b.createdAt - a.createdAt);
  const assetId = selected ?? takes[0]?.assetId;
  const asset = assetId ? d.assets[assetId] : undefined;
  const cast = effectiveCast(d, shotId);
  const location = inputs.locationId
    ? d.studio.locations[inputs.locationId]
    : undefined;
  const Title = embedded ? "h2" : DialogTitle;
  const Description = embedded ? "p" : DialogDescription;
  const generate = () => {
    const text = prompt.trim();
    if (
      mutate((data) => {
        enqueueFrameImage(data, shotId, text);
      })
    ) {
      setMessages([...messages, text]);
      setSelected(undefined);
      setError("");
    } else setError(useStore.getState().notice);
  };
  return (
    <div className="frame-image-workspace">
      <header className="image-workspace-heading">
        <Button variant="ghost" onClick={back}>
          <ArrowLeft size={15} />
          Back to video
        </Button>
        <div>
          <Title>Create image with AI</Title>
          <Description>
            {scene.title} / {shot.title} ·{" "}
            {kind === "startingFrameAssetId" ? "Starting" : "Ending"} frame
          </Description>
        </div>
        <Button
          variant="default"
          disabled={!asset || asset.missing || busy}
          onClick={() => {
            if (
              assetId &&
              mutate(
                (data) =>
                  saveGenerationInputs(
                    data,
                    scene.id,
                    { [kind]: assetId },
                    shotId,
                  ),
                true,
              )
            )
              back();
            else setError(useStore.getState().notice);
          }}
        >
          <Check size={14} />
          Use as {kind === "startingFrameAssetId" ? "starting" : "ending"} frame
        </Button>
      </header>
      <div className="image-workspace-layout">
        <main className="image-workspace-center">
          <div className="image-large-preview">
            {asset?.url && !asset.missing ? (
              <img src={asset.url} alt="Selected frame composition" />
            ) : (
              <div className="empty">
                <ImageIcon size={42} />
                <h2>Shape the opening composition.</h2>
                <p>
                  Describe your image to AI Director. Your selected references
                  are already included.
                </p>
                <Button
                  onClick={generate}
                  disabled={
                    !prompt.trim() || busy || d.credits < CONFIG.imageCost
                  }
                >
                  <Sparkles size={14} />
                  Generate image · {CONFIG.imageCost} demo cr
                </Button>
              </div>
            )}
            {busy && (
              <div className="image-generating" role="status">
                Generating composition… You can return to video while it
                finishes.
              </div>
            )}
          </div>
          <div
            className="image-alternatives"
            aria-label="Generated image alternatives"
          >
            {takes.map((t) => (
              <button
                key={t.id}
                aria-pressed={assetId === t.assetId}
                onClick={() => setSelected(t.assetId)}
              >
                <img
                  src={d.assets[t.assetId]?.url}
                  alt={`Composition ${takes.indexOf(t) + 1}`}
                />
                <span>
                  {t.revision === shot.revision
                    ? "Current inputs"
                    : "Previous inputs"}
                </span>
              </button>
            ))}
          </div>
          <p className="muted">
            Local demonstration · storyboard images stand in for AI output.
            Generated candidates remain in your library.
          </p>
        </main>
        <aside className="image-director" aria-label="Image AI Director">
          <div className="section-heading">
            <h2>AI Director</h2>
            <span className="badge">IMAGE</span>
          </div>
          <p>
            Refine this shot’s composition. Generating an image is optional.
          </p>
          <h3>Inherited references</h3>
          <div className="image-context-references">
            {cast.map((c) => {
              const character = d.characters[c.characterId],
                a = versionAsset(
                  d,
                  (c.lookId
                    ? d.studio.looks[c.lookId]?.primaryVersionId
                    : undefined) ?? character?.canonicalVersionId,
                );
              return (
                <div key={c.characterId}>
                  {a?.url && <img src={a.url} alt="" />}
                  <span>
                    {character?.name}
                    {c.lookId
                      ? ` · ${d.studio.looks[c.lookId]?.name ?? "Selected Look"}`
                      : ""}
                  </span>
                </div>
              );
            })}
            {location && (
              <div>
                {location.assetId && (
                  <img src={d.assets[location.assetId]?.url} alt="" />
                )}
                <span>{location.name}</span>
              </div>
            )}
            {inputs.referenceInputs.map((ref) => (
              <div key={ref.assetId}>
                <span>{d.assets[ref.assetId]?.title}</span>
              </div>
            ))}
            {!cast.length && !location && !inputs.referenceInputs.length && (
              <span className="muted">Using the scene description.</span>
            )}
          </div>
          <div className="image-director-conversation" aria-live="polite">
            {messages.map((m, i) => (
              <div key={i}>
                <b>You</b>
                <p>{m}</p>
                <b>AI Director</b>
                <p>
                  Composition requested. Select a result or describe another
                  variation.
                </p>
              </div>
            ))}
          </div>
          <label>
            Composition instructions
            <textarea
              aria-label="Image direction"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              maxLength={10000}
            />
          </label>
          <Button
            variant="default"
            disabled={busy || !prompt.trim() || d.credits < CONFIG.imageCost}
            onClick={generate}
          >
            <Sparkles size={14} />
            {busy
              ? "Generating…"
              : `Generate image · ${CONFIG.imageCost} demo cr`}
          </Button>
          <small>{d.credits} demo credits available · no real AI calls</small>
          {error && <p role="alert">{error}</p>}
        </aside>
      </div>
    </div>
  );
}
