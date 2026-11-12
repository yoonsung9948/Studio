import { useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  Download,
  Plus,
  Scissors,
  Trash2,
  Upload,
} from "lucide-react";
import {
  getCut,
  editCut,
  cutDuration,
  syncChosenTakes,
  updateCutClip,
  splitCutClip,
  addCutAudio,
} from "../../domain/cut";
import { uid } from "../../domain/types";
import { episodeMediaAssetIds } from "../../domain/episode-resources";
import { CutTimeline } from "./CutTimeline";
import { FinalMediaPicker } from "./FinalMediaPicker";
import { DraftField } from "../design/Primitives";
import { StudioPlayer } from "../director-desk/StudioPlayer";
import { commit } from "../generation";
import { useRender, startProduceRender } from "../../services/produce-render";
import { saveMediaBlob } from "../../services/media-storage";
import type { ProduceContext } from "./useProduce";
import type { CutAudio } from "../../domain/cut-schema";

export function FinalVideo({ context }: { context: ProduceContext }) {
  const { data, episode, allShots, go } = context;
  const cut = getCut(data, episode.id);
  const [selectedId, setSelected] = useState(""),
    [position, setPosition] = useState(0),
    [tab, setTab] = useState("Clip"),
    [audioPicker, setAudioPicker] = useState(false);
  const [audioRole, setAudioRole] = useState<CutAudio["role"]>("ambience"),
    [audioError, setAudioError] = useState("");
  const [mediaPicker, setMediaPicker] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  const render = useRender();
  const selected =
    cut.clips.find((clip) => clip.id === selectedId) ?? cut.clips[0];
  const take = data.takes[selected?.takeId ?? ""],
    shot = data.shots[selected?.shotId ?? ""];
  const preview = data.assets[take?.assetId ?? ""];
  const total = cutDuration(cut),
    remaining = allShots.filter((item) => !item.currentTakeId);
  const canRender = !!cut.clips.length && !remaining.length;
  const exports = Object.values(data.exports)
    .filter((record) => record.episodeId === episode.id && record.outputAssetId)
    .sort((a, b) => b.createdAt - a.createdAt);
  const latestRender = exports[0],
    latestOutput = data.assets[latestRender?.outputAssetId ?? ""];
  const mediaIds = episodeMediaAssetIds(data, episode.id);
  const audioAssets = Object.values(data.assets).filter(
    (asset) =>
      mediaIds.has(asset.id) &&
      asset.kind === "audio" &&
      !asset.missing &&
      !asset.archived,
  );
  const changeClip = (fields: Parameters<typeof updateCutClip>[3]) =>
    selected &&
    commit(
      (d) => updateCutClip(d, episode.id, selected.id, fields),
      "Cut saved",
    );
  const addAudio = async (assetId: string, url: string) => {
    setAudioError("");
    try {
      const seconds = await audioDuration(url);
      commit(
        (d) =>
          addCutAudio(
            d,
            episode.id,
            assetId,
            Math.round(seconds * 30),
            audioRole,
          ),
        "Audio added",
      );
      setAudioPicker(false);
    } catch (error) {
      setAudioError(
        error instanceof Error ? error.message : "Audio could not be loaded.",
      );
    }
  };
  const importAudio = async (file: File) => {
    const id = uid("audio-asset"),
      url = URL.createObjectURL(file);
    try {
      const duration = await audioDuration(url);
      await saveMediaBlob(id, file);
      commit((d) => {
        d.assets[id] = {
          id,
          title: file.name,
          projectId: episode.projectId,
          kind: "audio",
          url,
          sessionOnly: true,
          storedBlob: true,
          provenance: "Uploaded audio",
        };
        d.episodes[episode.id].mediaAssetIds = [
          ...(d.episodes[episode.id].mediaAssetIds ?? []),
          id,
        ];
        addCutAudio(d, episode.id, id, Math.round(duration * 30), audioRole);
      }, "Audio uploaded and added");
      setAudioPicker(false);
    } catch (error) {
      URL.revokeObjectURL(url);
      setAudioError(
        error instanceof Error ? error.message : "Audio could not be imported.",
      );
    }
  };
  const beginRender = () => {
    void startProduceRender(episode.id).catch((error: unknown) =>
      setAudioError(
        error instanceof Error ? error.message : "Rendering could not start.",
      ),
    );
  };
  return (
    <div className="produce-final">
      <header className="produce-final-heading">
        <span>
          {remaining.length ? (
            `${remaining.length} shots still need a chosen take`
          ) : (
            <>
              <Check size={17} />
              All {allShots.length} shots have chosen takes
            </>
          )}
        </span>
        <div className="produce-actions">
          {latestOutput?.url && !latestOutput.missing && (
            <a
              className="ds-button ds-primary"
              href={latestOutput.url}
              download={`${latestRender.title}.${latestRender.preset.includes("MP4") ? "mp4" : "webm"}`}
            >
              <Download size={17} />
              Download latest render
            </a>
          )}
          <button
            className="ds-button"
            onClick={() =>
              commit(
                (d) => syncChosenTakes(d, episode.id),
                "Cut updated from chosen takes",
              )
            }
          >
            Update chosen takes
          </button>
          <button
            className="ds-button ds-primary"
            disabled={!canRender || render.running}
            onClick={beginRender}
          >
            {render.running
              ? `Rendering ${render.progress}%`
              : "Render final video"}
            <ArrowRight size={17} />
          </button>
        </div>
      </header>
      <div className="produce-final-top">
        <section className="produce-panel produce-cut-monitor">
          <StudioPlayer
            shotIds={cut.clips.map((clip) => clip.shotId)}
            cutClips={cut.clips}
            audio={cut.audio}
            captions={cut.captions}
            aspectRatio={cut.aspectRatio}
            timeline
            position={position}
            onPositionChange={setPosition}
          />
        </section>
        <aside className="produce-panel produce-clip-inspector">
          <h2>Selected clip</h2>
          {selected && shot ? (
            <>
              {preview?.url && (
                <div className="produce-selected-clip">
                  {preview.kind === "video" ? (
                    <video src={preview.url} muted preload="metadata" />
                  ) : (
                    <img src={preview.url} alt="Selected clip" />
                  )}
                  <b>{shot.title}</b>
                  <small>
                    Chosen take · {(selected.outFrame - selected.inFrame) / 30}s
                  </small>
                </div>
              )}
              <nav className="produce-tabs" aria-label="Selected clip controls">
                {["Clip", "Audio", "Captions"].map((name) => (
                  <button
                    key={name}
                    aria-pressed={tab === name}
                    onClick={() => setTab(name)}
                  >
                    {name}
                  </button>
                ))}
              </nav>
              {tab === "Clip" && (
                <>
                  <div className="produce-trim">
                    <label>
                      Trim in (s)
                      <DraftField
                        key={`${selected.id}-in`}
                        label="Clip trim in"
                        value={String(selected.inFrame / 30)}
                        onSave={(value) =>
                          changeClip({
                            inFrame: Math.round(Number(value) * 30),
                          })
                        }
                      />
                    </label>
                    <label>
                      Trim out (s)
                      <DraftField
                        key={`${selected.id}-out`}
                        label="Clip trim out"
                        value={String(selected.outFrame / 30)}
                        onSave={(value) =>
                          changeClip({
                            outFrame: Math.round(Number(value) * 30),
                          })
                        }
                      />
                    </label>
                  </div>
                  <p>Transition: Cut</p>
                  <button
                    className="ds-button"
                    onClick={() => go("takes", shot.sceneId, shot.id)}
                  >
                    Replace or refine take
                    <ArrowRight size={15} />
                  </button>
                  <p className="produce-hint">
                    Trims change this clip only. The shot plan and source take
                    stay intact.
                  </p>
                </>
              )}
              {tab === "Audio" && (
                <>
                  <label>
                    Original audio volume
                    <input
                      aria-label="Clip audio volume"
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={selected.volume}
                      onChange={(e) =>
                        changeClip({ volume: Number(e.target.value) })
                      }
                    />
                  </label>
                  <button
                    className="ds-button"
                    onClick={() =>
                      changeClip({ volume: selected.volume ? 0 : 1 })
                    }
                  >
                    {selected.volume ? "Mute" : "Unmute"} original audio
                  </button>
                  <p>Dialogue: {shot.dialogue || "No dialogue specified"}</p>
                  <button
                    className="produce-link"
                    onClick={() => setAudioPicker(true)}
                  >
                    Add dialogue or sound
                  </button>
                </>
              )}
              {tab === "Captions" && (
                <>
                  <label className="produce-toggle">
                    <input
                      aria-label="Include captions"
                      type="checkbox"
                      checked={cut.captions}
                      onChange={(e) =>
                        commit(
                          (d) =>
                            editCut(d, episode.id, (c) => {
                              c.captions = e.target.checked;
                            }),
                          "Captions updated",
                        )
                      }
                    />
                    Include dialogue captions
                  </label>
                  <p>
                    {shot.dialogue ||
                      "Add dialogue in Takes to caption this shot."}
                  </p>
                </>
              )}
            </>
          ) : (
            <p>Choose video takes to begin your cut.</p>
          )}
        </aside>
        <aside className="produce-panel produce-render-panel">
          <h2>Render final video</h2>
          <dl>
            <div>
              <dt>Resolution</dt>
              <dd>1080p</dd>
            </div>
            <div>
              <dt>Format</dt>
              <dd>MP4 / WebM · video + audio</dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd>{(total / 30).toFixed(1)} seconds</dd>
            </div>
          </dl>
          <label>
            Aspect ratio
            <select
              aria-label="Final aspect ratio"
              value={cut.aspectRatio}
              onChange={(e) =>
                commit(
                  (d) =>
                    editCut(d, episode.id, (c) => {
                      c.aspectRatio = e.target.value as typeof c.aspectRatio;
                    }),
                  "Output saved",
                )
              }
            >
              <option>16:9</option>
              <option>9:16</option>
              <option>1:1</option>
            </select>
          </label>
          <button
            className="ds-button ds-primary"
            disabled={!canRender || render.running}
            onClick={beginRender}
          >
            Render {(total / 30).toFixed(1)}s video
            <ArrowRight size={16} />
          </button>
          {remaining.length > 0 && (
            <button
              className="produce-link"
              onClick={() => go("takes", remaining[0].sceneId, remaining[0].id)}
            >
              Finish remaining shots →
            </button>
          )}
          <p className="produce-hint">
            Rendering uses this cut’s saved choices, audio and captions. Keep
            the studio open while encoding.
          </p>
          {render.running && (
            <div role="status">
              <progress max={100} value={render.progress} />
              <p>
                {render.progress}% · Rendering{" "}
                {data.episodes[render.episodeId ?? ""]?.title}
              </p>
              <button className="ds-button" onClick={render.cancel}>
                Cancel render
              </button>
            </div>
          )}
          {render.error && <p role="alert">{render.error}</p>}
          <div className="produce-render-history">
            {exports.map((record) => {
              const asset = data.assets[record.outputAssetId!];
              return (
                <div className="produce-render-result" key={record.id}>
                  <b>Cut v{record.timelineVersion}</b>
                  {asset?.url && !asset.missing ? (
                    <>
                      <details className="produce-render-playback">
                        <summary>Preview rendered video</summary>
                        <video
                          src={asset.url}
                          controls
                          preload="metadata"
                          aria-label={`Rendered cut v${record.timelineVersion}`}
                        />
                      </details>
                      <a
                        className="ds-button"
                        href={asset.url}
                        download={`${record.title}.${record.preset.includes("MP4") ? "mp4" : "webm"}`}
                      >
                        <Download size={15} />
                        Download video
                      </a>
                    </>
                  ) : (
                    <small>Stored media unavailable</small>
                  )}
                </div>
              );
            })}
          </div>
        </aside>
      </div>
      <div className="produce-panel produce-cut-toolbar">
        <button className="ds-button" onClick={() => setMediaPicker(true)}>
          <Plus size={16} />
          Add media
        </button>
        <button
          className="ds-button"
          onClick={() => setAudioPicker(!audioPicker)}
        >
          <Plus size={16} />
          Add audio
        </button>
        <button
          className="ds-button"
          disabled={!selected}
          onClick={() => {
            if (!selected) return;
            let offset = position;
            for (const clip of cut.clips) {
              if (clip.id === selected.id) break;
              offset -= clip.outFrame - clip.inFrame;
            }
            commit(
              (d) => splitCutClip(d, episode.id, selected.id, offset),
              "Clip split",
            );
          }}
        >
          <Scissors size={16} />
          Split
        </button>
        <button
          className="ds-button"
          disabled={!selected}
          onClick={() =>
            commit(
              (d) =>
                editCut(d, episode.id, (c) => {
                  c.clips = c.clips.filter((clip) => clip.id !== selected?.id);
                }),
              "Clip removed",
            )
          }
        >
          <Trash2 size={16} />
          Remove clip
        </button>
        <button
          className="ds-button"
          onClick={() =>
            commit(
              (d) =>
                editCut(d, episode.id, (c) => {
                  c.captions = !c.captions;
                }),
              "Captions updated",
            )
          }
        >
          Captions {cut.captions ? "on" : "off"}
        </button>
      </div>
      {mediaPicker && (
        <FinalMediaPicker
          context={context}
          onClose={() => setMediaPicker(false)}
        />
      )}
      {audioPicker && (
        <section className="produce-panel produce-audio-picker">
          <h3>Add audio</h3>
          <label>
            Track type
            <select
              value={audioRole}
              onChange={(e) => setAudioRole(e.target.value as typeof audioRole)}
            >
              <option value="dialogue">Dialogue</option>
              <option value="ambience">Ambience / sound</option>
              <option value="music">Music</option>
            </select>
          </label>
          <button className="ds-button" onClick={() => upload.current?.click()}>
            <Upload size={16} />
            Upload audio
          </button>
          <input
            hidden
            ref={upload}
            type="file"
            accept="audio/*"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importAudio(file);
              e.target.value = "";
            }}
          />
          {audioAssets.map((asset) => (
            <button
              key={asset.id}
              className="ds-button"
              onClick={() => void addAudio(asset.id, asset.url)}
            >
              {asset.title}
              <Plus size={14} />
            </button>
          ))}
          <p className="produce-hint">
            Music, voice and sound generation can be added here when providers
            are connected.
          </p>
        </section>
      )}
      {audioError && <p role="alert">{audioError}</p>}
      <CutTimeline
        context={context}
        selectedId={selected?.id}
        position={position}
        onSelect={setSelected}
        setPosition={setPosition}
      />
    </div>
  );
}

function audioDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = document.createElement("audio");
    const timer = setTimeout(() => finish(undefined), 15000);
    const finish = (duration?: number) => {
      clearTimeout(timer);
      audio.removeAttribute("src");
      audio.load();
      if (duration && Number.isFinite(duration)) resolve(duration);
      else reject(Error("Could not read this audio file’s duration."));
    };
    audio.onloadedmetadata = () => finish(audio.duration);
    audio.onerror = () => finish(undefined);
    audio.src = url;
  });
}
