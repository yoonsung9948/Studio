import { productionSync } from "../../services/production-sync";
import { generateShotBatch, useShotJobs } from "../../services/shot-generation";
import { useStore } from "../../stores/store";
import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Heart,
  ImageIcon,
  Columns2,
} from "lucide-react";
import { active, isBusy } from "../../domain/selectors";
import {
  generationInputs,
  saveGenerationInputs,
  defaultCraft,
} from "../../domain/generation-inputs";
import {
  chooseFrame,
  chooseVideo,
  generateProduceBatch,
  shotResults,
} from "../../domain/produce";
import { DraftField } from "../design/Primitives";
import { commit } from "../generation";
import {
  GenerationButton,
  ResultPreview,
  ResultCard,
} from "./GenerationResults";
import { CameraControls, TakeControls } from "./GenerationControls";
import { ReferencePicker, referenceCards } from "./ReferencePicker";
import type { ProduceContext } from "./useProduce";
import type { CraftSettings } from "../../domain/types";
import { CONFIG } from "../../domain/types";

export function ShotNavigation({ context }: { context: ProduceContext }) {
  const { data, allShots, shot, stage, go } = context;
  return (
    <nav className="produce-shot-navigation" aria-label="Episode shots">
      {allShots.map((item) => {
        const take = data.takes[item.imageTakeId ?? ""],
          image = data.assets[take?.assetId ?? ""];
        return (
          <button
            key={item.id}
            aria-current={item.id === shot?.id ? "true" : undefined}
            onClick={() => go(stage, item.sceneId, item.id)}
          >
            {image?.url ? (
              <img src={image.url} alt="" />
            ) : (
              <div className="produce-shot-placeholder">
                <ImageIcon size={20} />
              </div>
            )}
            <b>{item.title}</b>
            <small>{item.targetFrames / 30}s</small>
          </button>
        );
      })}
    </nav>
  );
}

export function ShotGeneration({ context }: { context: ProduceContext }) {
  const { data, scene, shot, stage, go } = context;
  const serverBusy = useShotJobs((s) => s[shot?.id ?? ""] ?? 0);
  const video = stage === "takes";
  const [references, setReferences] = useState(false),
    [count, setCount] = useState(2),
    [compare, setCompare] = useState(false),
    [favorites, setFavorites] = useState(false);
  const [previewId, setPreview] = useState("");
  if (!shot || !scene)
    return (
      <div className="produce-empty">
        <h2>Plan a shot first.</h2>
        <button className="ds-button ds-primary" onClick={() => go("plan")}>
          Open Scene plan
          <ArrowRight size={17} />
        </button>
      </div>
    );
  const inputs = generationInputs(data, scene.id, shot.id),
    craft = { ...defaultCraft, ...inputs.craft };
  const results = shotResults(data, shot.id, video ? "video" : "image");
  const chosenId = video
    ? shot.currentTakeId
    : results.find((take) => take.assetId === inputs.startingFrameAssetId)?.id;
  const chosen = data.takes[chosenId ?? ""];
  const selected =
    results.find((take) => take.id === previewId) ?? results.at(-1) ?? chosen;
  const asset = data.assets[selected?.assetId ?? ""],
    source = data.assets[inputs.startingFrameAssetId ?? ""];
  const cards = referenceCards(data, scene.id, shot.id);
  const busy = !!serverBusy || isBusy(data, shot.id),
    job = Object.values(data.jobs).find(
      (item) => item.shotId === shot.id && active(item),
    );
  const cost = count * (video ? CONFIG.videoCost : CONFIG.imageCost);
  const saveCraft = (fields: Partial<CraftSettings>) =>
    commit(
      (d) =>
        saveGenerationInputs(
          d,
          scene.id,
          { craft: { ...craft, ...fields } },
          shot.id,
        ),
      "Controls saved",
    );
  const run = () => {
    if (productionSync()) {
      void generateShotBatch([shot.id], video ? "video" : "image", count).catch(
        (e) => useStore.getState().setNotice(e.message),
      );
      return;
    }
    return commit(
      (d) => generateProduceBatch(d, shot.id, video ? "video" : "image", count),
      `${count} ${video ? "takes" : "frames"} queued`,
      false,
    );
  };
  const useResult = () =>
    selected &&
    commit(
      (d) =>
        video
          ? chooseVideo(d, shot.id, selected.id)
          : chooseFrame(d, shot.id, selected.id),
      video ? "Take chosen" : "Starting frame chosen",
    );
  const canVideo = !!source?.url && !source.missing && !source.archived;
  return (
    <div
      className={`produce-generation ${video ? "produce-takes" : "produce-frames"} ${references ? "has-reference-picker" : ""}`}
    >
      <header className="produce-generation-heading">
        <div>
          <button
            className="produce-link"
            onClick={() => go(video ? "shots" : "plan")}
          >
            <ArrowLeft size={15} />
            {video ? "Shots" : "Scene plan"}
          </button>
          <h2>
            Shot {String(context.shots.indexOf(shot) + 1).padStart(2, "0")} ·{" "}
            {shot.title}
          </h2>
          <p>
            {scene.title} · {shot.action}
          </p>
        </div>
        <ShotNavigation context={context} />
      </header>
      {!video && (
        <button
          className="produce-reference-summary ds-button"
          onClick={() => setReferences(true)}
        >
          {cards
            .slice(0, 4)
            .map(
              (card) =>
                card.image && <img key={card.id} src={card.image} alt="" />,
            )}
          {cards.length} references · Edit
        </button>
      )}
      <div className="produce-generation-layout">
        <aside className="produce-panel produce-generation-controls">
          {video ? (
            <>
              <h3>Source</h3>
              {source?.url ? (
                <img
                  className="produce-source-frame"
                  src={source.url}
                  alt="Chosen starting frame"
                />
              ) : (
                <div className="produce-reference-placeholder">
                  <ImageIcon />
                </div>
              )}
              <p>Starting frame for this shot</p>
              <button className="produce-link" onClick={() => go("shots")}>
                Change frame
              </button>
              <hr />
              <h3>Inherited setup</h3>
              <p>
                {cards.map((card) => card.name).join(" · ") ||
                  "No references selected"}
              </p>
              <small>
                Captured with the source frame. Change visual references in
                Shots.
              </small>
            </>
          ) : (
            <>
              <h3>Camera & composition</h3>
              <CameraControls
                context={context}
                craft={craft}
                onCraft={saveCraft}
              />
              <button
                className="produce-link"
                onClick={() =>
                  commit((d) => {
                    delete d.shots[shot.id].generationOverride;
                    delete d.shots[shot.id].castOverride;
                    delete d.shots[shot.id].worldElementIds;
                  }, "Scene defaults restored")
                }
              >
                Use scene settings
              </button>
            </>
          )}
        </aside>
        <div className="produce-generation-center">
          <div className={`produce-preview ${compare ? "is-comparing" : ""}`}>
            {compare && chosen && (
              <div>
                <small>Chosen</small>
                <ResultPreview take={chosen} shotId={shot.id} />
              </div>
            )}
            <div>
              {selected ? (
                <>
                  <span className="produce-preview-label">
                    {selected.id === chosenId ? "Chosen" : "Previewing"} ·{" "}
                    {video ? "Take" : "Frame"} {results.indexOf(selected) + 1}
                  </span>
                  <ResultPreview take={selected} shotId={shot.id} />
                </>
              ) : video && source?.url ? (
                <>
                  <img src={source.url} alt="Starting frame preview" />
                  <span className="produce-preview-label">
                    Starting frame · No video takes yet
                  </span>
                </>
              ) : (
                <div className="produce-empty">
                  <ImageIcon size={38} />
                  <h2>Give this moment a frame.</h2>
                  <p>Choose your references and direction, then generate.</p>
                  <button
                    className="ds-button ds-primary"
                    disabled={busy}
                    onClick={run}
                  >
                    Generate starting frames
                  </button>
                </div>
              )}
            </div>
          </div>
          {busy && (
            <div className="produce-job" role="status">
              <span className="produce-spinner" />
              {job?.state === "queued" ? "Queued" : "Generating"}{" "}
              {video ? "takes" : "frames"}… {job?.progress ?? 0}%
              <progress max={100} value={job?.progress ?? 0} />
            </div>
          )}
          <header className="produce-section-heading">
            <h3>
              {video ? "Take candidates" : "Frame candidates"}{" "}
              <small>{results.length} saved</small>
            </h3>
            <div className="produce-actions">
              <button
                className="produce-link"
                aria-pressed={favorites}
                onClick={() => setFavorites(!favorites)}
              >
                <Heart size={15} />
                {favorites ? "Show all" : "Favorites"}
              </button>
              <button
                className="produce-link"
                disabled={!chosen || !selected || chosen.id === selected.id}
                aria-pressed={compare}
                onClick={() => setCompare(!compare)}
              >
                <Columns2 size={15} />
                Compare
              </button>
            </div>
          </header>
          <div className="produce-result-strip">
            {results
              .filter((take) => !favorites || take.favorite)
              .map((take) => (
                <ResultCard
                  key={take.id}
                  take={take}
                  label={`${video ? "Take" : "Frame"} ${String(results.indexOf(take) + 1).padStart(2, "0")}`}
                  chosen={take.id === chosenId}
                  previewing={take.id === selected?.id}
                  onPreview={() => setPreview(take.id)}
                />
              ))}
            {!results.length && (
              <p className="produce-hint">
                New results appear here. Earlier results remain available.
              </p>
            )}
          </div>
          {!video && (
            <section className="produce-panel produce-composer">
              <label>
                Direction for next frame(s)
                <DraftField
                  label="Frame direction"
                  multiline
                  rows={3}
                  value={inputs.instructions}
                  onSave={(instructions) =>
                    commit(
                      (d) =>
                        saveGenerationInputs(
                          d,
                          scene.id,
                          { instructions },
                          shot.id,
                        ),
                      "Frame direction saved",
                    )
                  }
                />
              </label>
              <GenerationButton
                count={count}
                setCount={setCount}
                cost={cost}
                disabled={busy || shot.locked}
                onGenerate={run}
                video={false}
              />
            </section>
          )}
        </div>
        {video && (
          <TakeControls context={context} craft={craft} onCraft={saveCraft} />
        )}
      </div>
      <footer className="produce-generation-footer">
        <div>
          {chosen ? (
            <>
              <Check size={17} />
              <b>
                Current choice: {video ? "Take" : "Frame"}{" "}
                {results.findIndex((take) => take.id === chosen.id) + 1}
              </b>
              <span className="produce-chosen">Chosen</span>
            </>
          ) : (
            <span>
              Choose a {video ? "take" : "starting frame"} to continue.
            </span>
          )}
          {video && asset?.kind === "image" && (
            <small>Demo take · still-image animatic</small>
          )}
        </div>
        <div className="produce-actions">
          {video && (
            <GenerationButton
              count={count}
              setCount={setCount}
              cost={cost}
              disabled={busy || !canVideo || shot.locked}
              onGenerate={run}
              video
            />
          )}
          <button
            className="ds-button ds-primary"
            disabled={!selected || selected.id === chosenId || shot.locked}
            onClick={useResult}
          >
            Use {video ? "take" : "frame"}{" "}
            {selected ? results.indexOf(selected) + 1 : ""}
            <Check size={16} />
          </button>
          <button
            className="ds-button"
            disabled={video ? !chosen : !canVideo}
            onClick={() => go(video ? "final" : "takes")}
          >
            {video ? "Continue to Final video" : "Direct video"}
            <ArrowRight size={16} />
          </button>
        </div>
      </footer>
      {references && (
        <ReferencePicker
          sceneId={scene.id}
          shotId={shot.id}
          onClose={() => setReferences(false)}
        />
      )}
    </div>
  );
}
