import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Group, Panel, Separator } from "react-resizable-panels";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  Scissors,
  Sparkles,
  Undo2,
  Redo2,
} from "lucide-react";
import { useStore } from "../stores/store";
import { Button } from "../components/ui/button";
import { useActions } from "../components/Actions";
import { SortableItem, SortableList } from "../components/Sortable";
import { reorderShots, trimShot } from "../domain/commands";
import {
  displaySeconds,
  duration,
  shotsOfScene,
  stage,
  timecode,
} from "../domain/selectors";
import { Player } from "./Player";
import { ShotDetails } from "./ShotDetails";
import { NotFound } from "./Gallery";
export function Editor() {
  const { projectId = "", episodeId = "", sceneId = "" } = useParams();
  const d = useStore((s) => s.data),
    ui = useStore((s) => s.ui),
    setUI = useStore((s) => s.setUI),
    mutate = useStore((s) => s.mutate);
  const undo = useStore((s) => s.undo),
    redo = useStore((s) => s.redo);
  const modal = useActions();
  const [details, setDetails] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [frame, setFrame] = useState(0);
  const scene = d.scenes[sceneId];
  if (
    !scene ||
    scene.episodeId !== episodeId ||
    d.episodes[episodeId]?.projectId !== projectId
  )
    return <NotFound />;
  if (!scene.shotIds.some((id) => d.shots[id].currentTakeId))
    return (
      <div className="workflow-empty">
        <Scissors size={32} />
        <h2>Approve a result before editing this scene.</h2>
        <p>Your scene plan and reference inputs are in the scene workspace.</p>
        <Button asChild>
          <Link
            to={`/projects/${projectId}/episodes/${episodeId}/scenes/${sceneId}`}
          >
            Open scene
          </Link>
        </Button>
      </div>
    );
  const ep = d.episodes[episodeId];
  const shots = shotsOfScene(d, sceneId);
  const selected =
    shots.find((s) => s.id === ui.selectedShots[sceneId]) ?? shots[0];
  const select = (id: string) =>
    setUI({ selectedShots: { ...ui.selectedShots, [sceneId]: id } });
  const index = ep.sceneIds.indexOf(sceneId);
  const offset = ep.sceneIds
    .slice(0, index)
    .reduce((n, id) => n + duration(shotsOfScene(d, id)), 0);
  const selectedIndex = shots.findIndex((s) => s.id === selected?.id);
  const localOffset = duration(shots.slice(0, selectedIndex));
  const reorder = (ids: string[]) =>
    mutate((d) => reorderShots(d, sceneId, ids), true);
  const updateTrim = (start: number, end: number) =>
    mutate((d) => trimShot(d, selected.id, start, end), true);
  return (
    <div className="editor">
      <div className="editor-toolbar">
        <Link
          className="icon-button"
          aria-label="Back to episode Edit"
          to={`/projects/${projectId}/episodes/${episodeId}?tab=edit`}
        >
          <ArrowLeft size={17} />
        </Link>
        <div>
          <span className="eyebrow">
            SCENE {String(index + 1).padStart(2, "0")}
          </span>
          <h2>{scene.title}</h2>
        </div>
        <div className="spacer" />
        <Button onClick={() => modal({ kind: "generate", ids: scene.shotIds })}>
          Scene inputs
        </Button>
        <Button variant="ghost" onClick={() => setDetails(!details)}>
          {details ? "Hide details" : "Details"}
        </Button>
        <Button
          variant="default"
          onClick={() => modal({ kind: "generate", ids: scene.shotIds })}
        >
          <Sparkles size={14} />
          Generate
        </Button>
      </div>
      <Group
        orientation="vertical"
        defaultLayout={ui.layouts.editor}
        onLayoutChanged={(layout) =>
          setUI({
            layouts: { ...useStore.getState().ui.layouts, editor: layout },
          })
        }
      >
        <Panel id="preview" defaultSize="65%" minSize="30%">
          <Player
            shotIds={scene.shotIds}
            selectedId={selected?.id}
            onSelect={select}
            onTime={setFrame}
          />
        </Panel>
        <Separator className="resize-handle horizontal" />
        <Panel
          id="timeline"
          minSize={
            window.matchMedia("(max-width:699px)").matches ? "40%" : "25%"
          }
        >
          <div className="timeline-section">
            <div className="timeline-toolbar">
              <h3>
                Scene timeline <span>30 fps</span>
              </h3>
              <div className="row-actions">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Undo"
                  onClick={undo}
                >
                  <Undo2 size={15} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Redo"
                  onClick={redo}
                >
                  <Redo2 size={15} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Zoom out"
                  disabled={zoom <= 0.7}
                  onClick={() => setZoom(Math.max(0.7, zoom - 0.2))}
                >
                  <Minus size={14} />
                </Button>
                <span className="muted">{Math.round(zoom * 100)}%</span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Zoom in"
                  disabled={zoom >= 3}
                  onClick={() => setZoom(Math.min(3, zoom + 0.2))}
                >
                  <Plus size={14} />
                </Button>
              </div>
            </div>
            <div className="timeline-scroll">
              <div
                className="timeline-canvas"
                style={{ width: Math.max(520, duration(shots) * 42 * zoom) }}
              >
                <div className="ruler">
                  {Array.from(
                    { length: Math.floor(duration(shots)) + 1 },
                    (_, i) => (
                      <span
                        key={i}
                        style={{ left: `${(i / duration(shots)) * 100}%` }}
                      >
                        {i % 5 === 0 ? timecode(i) : "·"}
                      </span>
                    ),
                  )}
                </div>
                <div
                  className="playhead"
                  style={{
                    left: `${((localOffset + frame / 30) / duration(shots)) * 100}%`,
                  }}
                />
                <div className="timeline-track">
                  <SortableList ids={scene.shotIds} onReorder={reorder}>
                    {shots.map((s, i) => (
                      <SortableItem
                        id={s.id}
                        key={s.id}
                        className={`timeline-clip ${selected?.id === s.id ? "selected" : ""}`}
                        style={{
                          width: `${((s.outFrame - s.inFrame) / 30 / duration(shots)) * 100}%`,
                        }}
                      >
                        <button
                          className="clip-button"
                          aria-pressed={selected?.id === s.id}
                          onClick={() => select(s.id)}
                        >
                          <img src={scene.cover} alt="" />
                          <span>
                            {String(i + 1).padStart(2, "0")} {s.title}
                          </span>
                          <small>
                            {displaySeconds((s.outFrame - s.inFrame) / 30)}s ·{" "}
                            {stage(d, s)}
                          </small>
                        </button>
                        <input
                          className="trim-handle left"
                          aria-label={`Trim start ${s.title}`}
                          title="Drag or use arrow keys to trim start"
                          type="range"
                          min={0}
                          max={s.outFrame - 1}
                          value={s.inFrame}
                          onChange={(e) =>
                            mutate(
                              (d) =>
                                trimShot(d, s.id, +e.target.value, s.outFrame),
                              true,
                            )
                          }
                        />
                        <input
                          className="trim-handle right"
                          aria-label={`Trim end ${s.title}`}
                          title="Drag or use arrow keys to trim end"
                          type="range"
                          min={s.inFrame + 1}
                          max={
                            s.currentTakeId
                              ? d.takes[s.currentTakeId].sourceFrames
                              : s.targetFrames
                          }
                          value={s.outFrame}
                          onChange={(e) =>
                            mutate(
                              (d) =>
                                trimShot(d, s.id, s.inFrame, +e.target.value),
                              true,
                            )
                          }
                        />
                      </SortableItem>
                    ))}
                  </SortableList>
                </div>
              </div>
            </div>
            <div className="timeline-bottom">
              <span>V1 · Embedded audio only</span>
              <span>
                Scene {timecode(localOffset + frame / 30)} · Episode offset{" "}
                {timecode(offset)}
              </span>
            </div>
            {selected && (
              <div className="numeric-trim">
                <Scissors size={15} />
                <span>{selected.title}</span>
                <label>
                  In{" "}
                  <input
                    aria-label="In frame"
                    type="number"
                    min={0}
                    value={selected.inFrame}
                    onChange={(e) =>
                      updateTrim(+e.target.value, selected.outFrame)
                    }
                  />
                </label>
                <label>
                  Out{" "}
                  <input
                    aria-label="Out frame"
                    type="number"
                    min={selected.inFrame + 1}
                    value={selected.outFrame}
                    onChange={(e) =>
                      updateTrim(selected.inFrame, +e.target.value)
                    }
                  />
                </label>
                <small>frames</small>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Move shot earlier"
                  disabled={selectedIndex === 0}
                  onClick={() => {
                    const ids = [...scene.shotIds];
                    [ids[selectedIndex - 1], ids[selectedIndex]] = [
                      ids[selectedIndex],
                      ids[selectedIndex - 1],
                    ];
                    reorder(ids);
                  }}
                >
                  <ChevronLeft size={14} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Move shot later"
                  disabled={selectedIndex === shots.length - 1}
                  onClick={() => {
                    const ids = [...scene.shotIds];
                    [ids[selectedIndex + 1], ids[selectedIndex]] = [
                      ids[selectedIndex],
                      ids[selectedIndex + 1],
                    ];
                    reorder(ids);
                  }}
                >
                  <ChevronRight size={14} />
                </Button>
              </div>
            )}
          </div>
        </Panel>
      </Group>
      {details && <ShotDetails sceneId={sceneId} />}
      <footer className="scene-nav">
        {index > 0 ? (
          <Link
            to={`/projects/${projectId}/episodes/${episodeId}/scenes/${ep.sceneIds[index - 1]}/edit`}
          >
            <ChevronLeft size={14} />
            Previous scene
          </Link>
        ) : (
          <span />
        )}
        <span>
          {index + 1} of {ep.sceneIds.length} scenes
        </span>
        {index < ep.sceneIds.length - 1 ? (
          <Link
            to={`/projects/${projectId}/episodes/${episodeId}/scenes/${ep.sceneIds[index + 1]}/edit`}
          >
            Next scene
            <ChevronRight size={14} />
          </Link>
        ) : (
          <span />
        )}
      </footer>
    </div>
  );
}
