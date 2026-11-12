import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Film,
  Magnet,
  Mic,
  Minus,
  Plus,
  Scissors,
  Trash2,
  Undo2,
  Volume2,
} from "lucide-react";
import { useStore } from "../stores/store";
import {
  shotsOfEpisode,
  setShotDuration,
  useWorkspaceTake,
} from "../domain/workspace";
import { trimShot, reorderShots } from "../domain/commands";
import { deleteCardSelection } from "../domain/card-deletion";
import { insertEditMedia, splitEditClip } from "../domain/episode-edit";
import { isBusy, timecode } from "../domain/selectors";
import { SortableList, SortableItem } from "../components/Sortable";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../components/ui/dialog";
import { StudioPlayer } from "./director-desk/StudioPlayer";
import { commit } from "./generation";
import { useSelection } from "./selection";
import { DraftField, StatusBadge } from "./design/Primitives";

export function EpisodeEdit({ episodeId }: { episodeId: string }) {
  const data = useStore((state) => state.data),
    episode = data.episodes[episodeId];
  const shots = shotsOfEpisode(data, episodeId),
    keys = useSelection((state) => state.keys);
  const selected =
    shots.find((shot) => keys.includes(`shot:${shot.id}`)) ?? shots[0];
  const [zoom, setZoom] = useState(100),
    [frame, setFrame] = useState(0),
    [snap, setSnap] = useState(true);
  const [addMedia, setAddMedia] = useState(false),
    [assetId, setAssetId] = useState(""),
    [duration, setDuration] = useState(5);
  const [width, setWidth] = useState(1000);
  const scroll = useRef<HTMLDivElement>(null);
  const total = shots.reduce((n, shot) => n + shot.outFrame - shot.inFrame, 0);
  const before = shots
    .slice(
      0,
      Math.max(
        0,
        shots.findIndex((shot) => shot.id === selected?.id),
      ),
    )
    .reduce((n, shot) => n + shot.outFrame - shot.inFrame, 0);
  const scale = Math.max(
    width < 600 ? 48 : 12,
    (((width - 104) / Math.max(1, total / 30)) * zoom) / 100,
  );
  const take = data.takes[selected?.currentTakeId ?? ""];
  const media =
    data.assets[
      (take ?? data.takes[selected?.imageTakeId ?? ""])?.assetId ?? ""
    ];
  const available = media?.url && !media.missing && !media.archived;
  const editable = !!selected && !selected.locked && !isBusy(data, selected.id);
  const options = Object.values(data.takes).filter(
    (item) =>
      item.shotId === selected?.id &&
      item.kind === "video" &&
      item.approved &&
      item.revision === selected?.revision &&
      !selected?.discardedTakeIds?.includes(item.id) &&
      data.assets[item.assetId]?.url &&
      !data.assets[item.assetId]?.missing &&
      !data.assets[item.assetId]?.archived,
  );
  const assets = Object.values(data.assets).filter(
    (asset) =>
      asset.projectId === episode.projectId &&
      asset.kind !== "audio" &&
      !asset.missing &&
      !asset.archived &&
      asset.url,
  );
  useEffect(() => {
    const target = scroll.current;
    if (!target || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) =>
      setWidth(entries[0].contentRect.width),
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (
      selected &&
      (frame < before || frame >= before + selected.outFrame - selected.inFrame)
    )
      setFrame(before);
  }, [selected?.id]);
  useEffect(() => {
    if (frame >= total) setFrame(Math.max(0, total - 1));
  }, [total]);
  const select = (id: string) => {
    useSelection.getState().replace([`shot:${id}`]);
    let offset = 0;
    for (const shot of shots) {
      if (shot.id === id) break;
      offset += shot.outFrame - shot.inFrame;
    }
    setFrame(offset);
  };
  const seek = (next: number, shouldSnap = false) => {
    let offset = 0,
      value = next;
    if (snap && shouldSnap)
      for (const shot of shots) {
        if (Math.abs(next - offset) <= 5) value = offset;
        offset += shot.outFrame - shot.inFrame;
      }
    value = Math.max(0, Math.min(total - 1, value));
    setFrame(value);
    let end = 0;
    const current = shots.find((shot) => {
      end += shot.outFrame - shot.inFrame;
      return value < end;
    });
    if (current && current.id !== selected?.id)
      useSelection.getState().replace([`shot:${current.id}`]);
  };
  const trim = (kind: "in" | "out", value: string) => {
    if (!selected) return false;
    return commit(
      (d) =>
        trimShot(
          d,
          selected.id,
          kind === "in" ? Math.round(Number(value) * 30) : selected.inFrame,
          kind === "out" ? Math.round(Number(value) * 30) : selected.outFrame,
        ),
      `${kind === "in" ? "In" : "Out"} point updated`,
    );
  };
  return (
    <div className="ds-edit-workspace film-edit-workspace">
      <div className="ds-edit-preview">
        <StudioPlayer
          timeline
          shotIds={shots.map((shot) => shot.id)}
          position={frame}
          onPositionChange={seek}
        />
      </div>
      <aside className="ds-clip-inspector" aria-label="Selected clip controls">
        <h2>Selected clip</h2>
        {selected ? (
          <>
            {available ? (
              media.kind === "video" ? (
                <video src={media.url} preload="metadata" muted />
              ) : (
                <img src={media.url} alt="Selected clip preview" />
              )
            ) : (
              <div className="film-clip-placeholder">
                <Film size={32} />
                Draft / preview
              </div>
            )}
            <div className="ds-section-title">
              <h3>{selected.title}</h3>
              <small>
                Shot {String(shots.indexOf(selected) + 1).padStart(2, "0")}
              </small>
            </div>
            <div className="film-clip-source">
              <span>Source</span>
              {!options.length &&
                (take?.approved &&
                !selected.stale &&
                take.revision === selected.revision ? (
                  <StatusBadge tone="success">Approved take</StatusBadge>
                ) : (
                  <StatusBadge>Draft / preview</StatusBadge>
                ))}
              {options.length > 0 && (
                <select
                  aria-label="Clip source take"
                  disabled={!editable}
                  value={take?.id ?? ""}
                  onChange={(event) =>
                    commit(
                      (d) =>
                        useWorkspaceTake(d, selected.id, event.target.value),
                      "Clip source updated",
                    )
                  }
                >
                  {!take && <option value="">Choose a take</option>}
                  {options.map((item, index) => (
                    <option key={item.id} value={item.id}>
                      Take {String(index + 1).padStart(2, "0")}
                      {item.approved ? " · Approved" : " · Needs review"}
                    </option>
                  ))}
                </select>
              )}
              <Link
                className="ds-icon film-source-review"
                aria-label="Choose another take"
                to={`/projects/${episode.projectId}/episodes/${episodeId}/shots/${selected.id}?stage=review`}
              >
                <ArrowRight size={14} />
              </Link>
            </div>
            <div className="ds-trim-fields">
              <label>
                In
                <DraftField
                  label="In seconds"
                  key={`${selected.id}-in`}
                  value={String(selected.inFrame / 30)}
                  disabled={!editable}
                  onSave={(value) => trim("in", value)}
                />
              </label>
              <label>
                Out
                <DraftField
                  label="Out seconds"
                  key={`${selected.id}-out`}
                  value={String(selected.outFrame / 30)}
                  disabled={!editable}
                  onSave={(value) => trim("out", value)}
                />
              </label>
              <label>
                Duration
                <output>
                  {timecode((selected.outFrame - selected.inFrame) / 30)}
                </output>
              </label>
            </div>
            {!take && (
              <label className="ds-field">
                Placeholder duration
                <DraftField
                  label="Placeholder duration"
                  value={String(selected.targetFrames / 30)}
                  disabled={!editable}
                  onSave={(value) =>
                    commit(
                      (d) => setShotDuration(d, selected.id, Number(value)),
                      "Placeholder duration updated",
                    )
                  }
                />
              </label>
            )}
            <label className="ds-field">
              Dialogue
              <textarea
                aria-label="Clip dialogue"
                value={selected.dialogue || "No dialogue"}
                readOnly
                rows={2}
              />
            </label>
            <label className="ds-field film-volume">
              <span>Volume</span>
              <div>
                <Volume2 size={20} />
                <input
                  aria-label="Clip volume"
                  type="range"
                  min={0}
                  max={100}
                  disabled={!editable}
                  value={(selected.volume ?? 1) * 100}
                  onChange={(event) =>
                    commit((d) => {
                      d.shots[selected.id].volume =
                        Number(event.target.value) / 100;
                      d.episodes[episodeId].timelineVersion++;
                    }, "Clip volume saved")
                  }
                />
                <output>
                  {selected.volume === 0
                    ? "−∞ dB"
                    : `${Math.round(20 * Math.log10(selected.volume ?? 1))} dB`}
                </output>
              </div>
            </label>

            {selected.locked && (
              <p className="dd-readiness">
                Unlock this shot from the board to edit it.
              </p>
            )}
          </>
        ) : (
          <p className="ds-muted">Add shots to begin your edit.</p>
        )}
      </aside>
      <section className="ds-edit-timeline" aria-label="Episode timeline">
        <div className="ds-timeline-toolbar">
          <button
            className="ds-button"
            disabled={!episode.sceneIds.length}
            onClick={() => setAddMedia(true)}
          >
            <Plus size={20} />
            Add media
          </button>
          <button
            className="ds-icon"
            aria-label="Split clip at playhead"
            disabled={
              !editable ||
              frame <= before ||
              frame >= before + selected.outFrame - selected.inFrame
            }
            onClick={() =>
              commit((d) => {
                splitEditClip(d, selected.id, frame - before);
              }, "Clip split")
            }
          >
            <Scissors size={19} />
          </button>
          <button
            className="ds-icon"
            aria-label="Remove selected clip"
            disabled={!editable}
            onClick={() => {
              if (
                commit((d) => {
                  deleteCardSelection(d, [`shot:${selected.id}`]);
                }, "Clip removed · Undo to restore")
              )
                useSelection.getState().replace([]);
            }}
          >
            <Trash2 size={19} />
          </button>
          <button
            className="ds-icon"
            aria-label="Undo edit"
            onClick={() => useStore.getState().undo()}
          >
            <Undo2 size={19} />
          </button>
          <span className="film-toolbar-divider" />
          <div className="ds-timeline-zoom">
            <button
              className="ds-icon"
              aria-label="Zoom out timeline"
              onClick={() => setZoom((value) => Math.max(50, value - 25))}
            >
              <Minus size={17} />
            </button>
            <input
              aria-label="Timeline zoom"
              type="range"
              min={50}
              max={300}
              step={25}
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
            />
            <button
              className="ds-icon"
              aria-label="Zoom in timeline"
              onClick={() => setZoom((value) => Math.min(300, value + 25))}
            >
              <Plus size={17} />
            </button>
          </div>
          <button
            className="ds-button film-snap"
            aria-pressed={snap}
            onClick={() => setSnap(!snap)}
          >
            <Magnet size={17} />
            Snap
          </button>
          <small>
            {shots.length} clips · {(total / 30).toFixed(1)}s
          </small>
        </div>
        <div className="ds-timeline-scroll" ref={scroll}>
          <div
            className="ds-timeline-sheet"
            style={{ width: Math.max(width, (total / 30) * scale + 104) }}
          >
            <div className="ds-timeline-ruler">
              <span>TIME</span>
              {Array.from(
                { length: Math.floor(total / 30) + 1 },
                (_, second) => (
                  <time key={second} style={{ left: 104 + second * scale }}>
                    {timecode(second)}
                  </time>
                ),
              )}
              <input
                aria-label="Timeline playhead"
                type="range"
                min={0}
                max={Math.max(0, total - 1)}
                value={Math.min(frame, Math.max(0, total - 1))}
                onChange={(event) => seek(Number(event.target.value), true)}
                style={{ left: 104, width: (total / 30) * scale }}
              />
            </div>
            <div className="ds-track-label">
              <Film size={18} />
              <span>
                V1<small>Video</small>
              </span>
            </div>
            <div className="ds-timeline-scenes">
              {episode.sceneIds.map((sceneId) => (
                <section key={sceneId} aria-label={data.scenes[sceneId].title}>
                  <SortableList
                    ids={data.scenes[sceneId].shotIds}
                    onReorder={(ids) =>
                      commit(
                        (d) => reorderShots(d, sceneId, ids),
                        "Timeline reordered",
                      )
                    }
                  >
                    <div className="ds-timeline-clips">
                      {data.scenes[sceneId].shotIds.map((id) => {
                        const shot = data.shots[id],
                          sourceTake =
                            data.takes[
                              shot.currentTakeId ?? shot.imageTakeId ?? ""
                            ],
                          asset = data.assets[sourceTake?.assetId ?? ""];
                        return (
                          <SortableItem
                            key={id}
                            id={id}
                            className={`ds-timeline-sort ${selected?.id === id ? "is-selected" : ""}`}
                            style={{
                              width:
                                ((shot.outFrame - shot.inFrame) / 30) * scale,
                            }}
                          >
                            <button
                              className="ds-timeline-clip"
                              aria-label={`Timeline shot ${shot.title}`}
                              aria-pressed={selected?.id === id}
                              onClick={() => select(id)}
                            >
                              {asset?.url &&
                              !asset.missing &&
                              !asset.archived ? (
                                asset.kind === "video" ? (
                                  <video
                                    src={asset.url}
                                    muted
                                    preload="metadata"
                                  />
                                ) : (
                                  <img src={asset.url} alt="" />
                                )
                              ) : (
                                <div className="film-timeline-placeholder">
                                  <Film size={22} />
                                </div>
                              )}
                              <span>
                                <b>
                                  {String(shots.indexOf(shot) + 1).padStart(
                                    2,
                                    "0",
                                  )}
                                  　{shot.title}
                                </b>
                                <small>
                                  {(shot.outFrame - shot.inFrame) / 30}s
                                </small>
                              </span>
                            </button>
                          </SortableItem>
                        );
                      })}
                    </div>
                  </SortableList>
                </section>
              ))}
            </div>
            <div className="film-audio-row">
              <div className="film-audio-label">
                <Mic size={19} />
                <span>
                  A1<small>Source audio</small>
                </span>
              </div>
              <div className="film-audio-clips">
                {shots.map((shot) => {
                  const asset =
                    data.assets[
                      data.takes[shot.currentTakeId ?? ""]?.assetId ?? ""
                    ];
                  return (
                    <button
                      key={shot.id}
                      aria-label={`Audio for ${shot.title}`}
                      onClick={() => select(shot.id)}
                      style={{
                        width: ((shot.outFrame - shot.inFrame) / 30) * scale,
                      }}
                    >
                      <Mic size={16} />
                      <span>
                        {shot.dialogue ||
                          (asset?.kind === "video"
                            ? "Source audio"
                            : "No source audio")}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div
              className="ds-timeline-playhead"
              style={{ left: 104 + (frame / 30) * scale }}
              aria-hidden="true"
            />
          </div>
        </div>
      </section>
      <Dialog open={addMedia} onOpenChange={setAddMedia}>
        <DialogContent className="st-dialog film-add-media">
          <DialogTitle>Add media to episode</DialogTitle>
          <DialogDescription>
            Choose production media. For video, enter its available source
            length; for an image, choose its time on screen.
          </DialogDescription>
          <label className="ds-field">
            Media
            <select
              aria-label="Edit media"
              value={assetId}
              onChange={(event) => setAssetId(event.target.value)}
            >
              <option value="">Choose image or video</option>
              {assets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.title} · {asset.kind}
                </option>
              ))}
            </select>
          </label>
          <label className="ds-field">
            Source duration (seconds)
            <input
              aria-label="Media source duration"
              type="number"
              min={1}
              max={30}
              value={duration}
              onChange={(event) => setDuration(Number(event.target.value))}
            />
          </label>
          <button
            className="ds-button ds-primary"
            disabled={!assetId || duration < 1 || duration > 30}
            onClick={() => {
              let id = "";
              if (
                commit((d) => {
                  id = insertEditMedia(
                    d,
                    selected?.sceneId ?? episode.sceneIds[0],
                    assetId,
                    duration,
                  );
                }, "Media added to edit")
              ) {
                setAddMedia(false);
                select(id);
              }
            }}
          >
            Add to edit
            <ArrowRight size={16} />
          </button>
          <Link
            className="ds-text"
            to={`/projects/${episode.projectId}/library`}
          >
            Open media library
          </Link>
        </DialogContent>
      </Dialog>
    </div>
  );
}
