import { Volume2 } from "lucide-react";
import { SortableItem, SortableList } from "../../components/Sortable";
import { getCut, cutDuration, editCut } from "../../domain/cut";
import { DraftField } from "../design/Primitives";
import { commit } from "../generation";
import type { ProduceContext } from "./useProduce";
export function CutTimeline({
  context,
  selectedId,
  position,
  onSelect,
  setPosition,
}: {
  context: ProduceContext;
  selectedId?: string;
  position: number;
  onSelect(id: string): void;
  setPosition(frame: number): void;
}) {
  const { data, episode } = context;
  const cut = getCut(data, episode.id),
    total = cutDuration(cut);
  let before = 0;
  return (
    <section
      className="produce-panel produce-timeline"
      aria-label="Final cut timeline"
    >
      <div className="produce-timeline-ruler">
        <span>Timeline · {(total / 30).toFixed(1)}s</span>
        <input
          aria-label="Timeline playhead"
          type="range"
          min={0}
          max={Math.max(0, total - 1)}
          value={Math.min(position, Math.max(0, total - 1))}
          onChange={(e) => setPosition(Number(e.target.value))}
        />
        <time>{(position / 30).toFixed(1)}s</time>
      </div>
      <div className="produce-timeline-video">
        <strong>
          V1<small>Video</small>
        </strong>
        <div className="produce-timeline-clips">
          <SortableList
            ids={cut.clips.map((clip) => clip.id)}
            onReorder={(ids) =>
              commit(
                (d) =>
                  editCut(d, episode.id, (c) => {
                    c.clips = ids.map((id) =>
                      c.clips.find((clip) => clip.id === id)!,
                    );
                  }),
                "Clip order saved",
              )
            }
          >
            {cut.clips.map((clip) => {
              const source =
                  data.assets[data.takes[clip.takeId]?.assetId ?? ""],
                start = before;
              before += clip.outFrame - clip.inFrame;
              return (
                <SortableItem
                  key={clip.id}
                  id={clip.id}
                  className={`produce-timeline-clip ${clip.id === selectedId ? "is-selected" : ""}`}
                  style={{ flex: clip.outFrame - clip.inFrame }}
                >
                  <button
                    onClick={() => {
                      onSelect(clip.id);
                      setPosition(start);
                    }}
                  >
                    {source?.kind === "video" ? (
                      <video src={source.url} muted preload="metadata" />
                    ) : (
                      source?.url && <img src={source.url} alt="" />
                    )}
                    <span>
                      {data.shots[clip.shotId]?.title}
                      <small>{(clip.outFrame - clip.inFrame) / 30}s</small>
                    </span>
                  </button>
                </SortableItem>
              );
            })}
          </SortableList>
        </div>
      </div>
      <div className="produce-source-audio-track">
        <strong>
          A1<small>Source audio</small>
        </strong>
        <div>
          <Volume2 size={16} />
          Original audio follows each clip · adjust levels in the Audio
          inspector
        </div>
      </div>
      {cut.audio.map((track) => (
        <div className="produce-audio-track" key={track.id}>
          <header>
            <b>{track.title}</b>
            <small>{track.role}</small>
            <button
              className="produce-link"
              onClick={() =>
                commit(
                  (d) =>
                    editCut(d, episode.id, (c) => {
                      c.audio = c.audio.filter((item) => item.id !== track.id);
                    }),
                  "Audio removed",
                )
              }
            >
              Remove
            </button>
          </header>
          <audio
            src={data.assets[track.assetId]?.url}
            controls
            preload="metadata"
          />
          <label>
            Start (s)
            <DraftField
              label={`${track.title} start`}
              value={String(track.startFrame / 30)}
              onSave={(value) =>
                commit(
                  (d) =>
                    editCut(d, episode.id, (c) => {
                      c.audio.find((item) => item.id === track.id)!.startFrame =
                        Math.round(Number(value) * 30);
                    }),
                  "Audio timing saved",
                )
              }
            />
          </label>
          <label>
            Volume
            <input
              aria-label={`${track.title} volume`}
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={track.volume}
              onChange={(e) =>
                commit(
                  (d) =>
                    editCut(d, episode.id, (c) => {
                      c.audio.find((item) => item.id === track.id)!.volume =
                        Number(e.target.value);
                    }),
                  "Audio level saved",
                )
              }
            />
          </label>
          <button
            className="ds-button"
            onClick={() =>
              commit(
                (d) =>
                  editCut(d, episode.id, (c) => {
                    const item = c.audio.find((t) => t.id === track.id)!;
                    item.muted = !item.muted;
                  }),
                "Audio mute updated",
              )
            }
          >
            {track.muted ? "Unmute" : "Mute"}
          </button>
        </div>
      ))}
    </section>
  );
}
