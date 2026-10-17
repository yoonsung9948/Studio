import { useEffect, useMemo, useState, type PointerEvent } from "react";
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { Group, Panel, Separator } from "react-resizable-panels";
import {
  Plus,
  Film,
  ChevronDown,
  GripVertical,
  Sparkles,
  Play,
  Lock,
  PanelRight,
  PanelLeft,
  PanelLeftClose,
  LayoutGrid,
  AlignLeft,
  PanelsTopLeft,
} from "lucide-react";
import { useStore } from "../stores/store";
import {
  type EntityKey,
  entity,
  useSelection,
  useStudio,
  type WorkspaceView,
} from "./selection";
import {
  CommandButton,
  CommandMenu,
  useCommands,
  useRegisterCommands,
  type StudioCommand,
} from "./commands";
import { commit, useGenerate } from "./generation";
import { SelectionSurface } from "./SelectionSurface";
import { Inspector } from "./inspector";
import { SortableList, SortableItem } from "../components/Sortable";
import {
  shotStatus,
  shotAsset,
  shotBadges,
  addWorkspaceScene,
  addWorkspaceShot,
  reorderWorkspaceScenes,
  reorderShots,
  buildBoard,
  updateScript,
  setShotDuration,
  lockWorkspace,
  assignWorld,
  shotsOfEpisode,
  selectedWorkspaceShots,
} from "../domain/workspace";
import { isBusy } from "../domain/selectors";
import { Player } from "../features/Player";
import { CONFIG, type Shot } from "../domain/types";
import { useActions } from "../components/Actions";

function ShotCard({
  id,
  order,
  mini = false,
}: {
  id: string;
  order: EntityKey[];
  mini?: boolean;
}) {
  const d = useStore((s) => s.data),
    selected = useSelection((s) => s.keys.includes(`shot:${id}`)),
    { execute } = useCommands();
  const shot = d.shots[id];
  if (!shot) return null;
  const asset = shotAsset(d, shot),
    status = shotStatus(d, shot),
    badges = shotBadges(d, shot);
  const choose = (
    e: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean } = {},
  ) => {
    useSelection.getState().choose(`shot:${id}`, order, e);
    if (window.innerWidth <= 650) useStudio.getState().set({ inspector: true });
  };
  return (
    <CommandMenu
      ids={[
        `generate:${id}`,
        `animate:${id}`,
        "selection.lock",
        "selection.director",
      ]}
      onSelect={() => {
        if (!selected) choose();
      }}
    >
      <article
        className={`st-shot ${selected ? "is-selected" : ""} ${mini ? "st-shot-mini" : ""}`}
        data-selection-key={`shot:${id}`}
        aria-label={`Shot ${shot.title}`}
        tabIndex={0}
        aria-selected={selected}
        onClick={choose}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            choose(e);
          }
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          try {
            const value = JSON.parse(
              e.dataTransfer.getData("application/dotori-world"),
            );
            commit(
              (data) => assignWorld(data, [id], value.kind, value.id),
              "World element assigned",
            );
          } catch {
            useStore
              .getState()
              .setNotice("Drag a character, place or prop onto this shot.");
          }
        }}
      >
        <div className="st-shot-media">
          {asset?.url && !asset.missing ? (
            asset.kind === "video" ? (
              <video src={asset.url} preload="metadata" muted playsInline />
            ) : (
              <img
                src={asset.url}
                alt={`${shot.title} thumbnail`}
                loading="lazy"
              />
            )
          ) : (
            <div className="st-shot-placeholder">
              <Film size={25} />
              <span>Draft</span>
            </div>
          )}
          <span className="st-duration">
            {(shot.currentTakeId
              ? shot.outFrame - shot.inFrame
              : shot.targetFrames) / 30}
            s
          </span>
          {status === "Locked" && <Lock className="st-locked-mark" size={14} />}
        </div>
        <div className="st-shot-copy">
          <div>
            <b>{shot.title}</b>
            <span className={`st-status status-${status.toLowerCase()}`}>
              {status}
            </span>
          </div>
          <p>{shot.action || "Describe this shot in the inspector."}</p>
          {badges.length > 0 && (
            <div className="st-badges">
              {badges.map((b) => (
                <span key={b}>{b}</span>
              ))}
            </div>
          )}
          {!mini && (
            <button
              className="st-card-generate"
              title={
                status === "Draft" ? "Generate still (G)" : "Animate (Shift+G)"
              }
              onClick={(e) => {
                e.stopPropagation();
                execute(`${status === "Draft" ? "generate" : "animate"}:${id}`);
              }}
            >
              {status === "Draft" ? <Sparkles size={12} /> : <Play size={12} />}{" "}
              {status === "Draft" ? "Generate · 8 cr" : "Animate · 24 cr"}
            </button>
          )}
        </div>
      </article>
    </CommandMenu>
  );
}
function Outline({
  episodeId,
  order,
}: {
  episodeId: string;
  order: EntityKey[];
}) {
  const d = useStore((s) => s.data),
    ep = d.episodes[episodeId],
    keys = useSelection((s) => s.keys);
  const [world, setWorld] = useState(false);
  const select = useSelection((s) => s.choose);
  return (
    <aside className="st-outline">
      <header>
        <b>Outline</b>
        <div>
          <CommandButton id="scene.add" icon>
            <Plus size={15} />
          </CommandButton>
          <button
            className="st-icon"
            aria-label="Collapse outline"
            title="Collapse outline"
            onClick={() => useStudio.getState().set({ outline: false })}
          >
            <PanelLeftClose size={15} />
          </button>
        </div>
      </header>
      <SelectionSurface className="st-panel-scroll" aria-label="Scene outline">
        <SortableList
          ids={ep.sceneIds}
          onReorder={(ids) =>
            commit(
              (data) => reorderWorkspaceScenes(data, episodeId, ids),
              "Scenes reordered",
            )
          }
        >
          {ep.sceneIds.map((sid, i) => (
            <SortableItem id={sid} key={sid} className="st-outline-scene">
              <button
                data-selection-key={`scene:${sid}`}
                className={`st-outline-scene-title ${keys.includes(`scene:${sid}`) ? "is-selected" : ""}`}
                onClick={(e) =>
                  select(
                    `scene:${sid}`,
                    ep.sceneIds.map((id) => `scene:${id}` as EntityKey),
                    e,
                  )
                }
              >
                <ChevronDown size={12} />
                <span>{String(i + 1).padStart(2, "0")}</span>
                {d.scenes[sid].title}
              </button>
              <SortableList
                ids={d.scenes[sid].shotIds}
                onReorder={(ids) =>
                  commit(
                    (data) => reorderShots(data, sid, ids),
                    "Shots reordered",
                  )
                }
              >
                {d.scenes[sid].shotIds.map((id) => (
                  <SortableItem id={id} key={id} className="st-outline-shot">
                    <button
                      className={
                        keys.includes(`shot:${id}`) ? "is-selected" : ""
                      }
                      data-selection-key={`shot:${id}`}
                      onClick={(e) => select(`shot:${id}`, order, e)}
                    >
                      <span
                        className={`st-status-dot ${shotStatus(d, d.shots[id]).toLowerCase()}`}
                      />
                      {d.shots[id].title}
                    </button>
                  </SortableItem>
                ))}
              </SortableList>
            </SortableItem>
          ))}
        </SortableList>
        {!ep.sceneIds.length && (
          <p className="st-empty-small">
            Add a scene or build a board from your script.
          </p>
        )}
      </SelectionSurface>
      <section className="st-outline-world">
        <button onClick={() => setWorld(!world)} aria-expanded={world}>
          <ChevronDown size={13} />
          Cast & places <small>Drag onto shots</small>
        </button>
        {world && (
          <div>
            {Object.values(d.characters)
              .filter((c) => c.projectId === ep.projectId)
              .map((c) => (
                <div
                  draggable
                  key={c.id}
                  onDragStart={(e) =>
                    e.dataTransfer.setData(
                      "application/dotori-world",
                      JSON.stringify({ kind: "character", id: c.id }),
                    )
                  }
                >
                  <GripVertical size={12} />
                  {c.name}
                </div>
              ))}
            {Object.values(d.studio.locations)
              .filter((l) => l.projectId === ep.projectId)
              .map((l) => (
                <div
                  draggable
                  key={l.id}
                  onDragStart={(e) =>
                    e.dataTransfer.setData(
                      "application/dotori-world",
                      JSON.stringify({ kind: "place", id: l.id }),
                    )
                  }
                >
                  <GripVertical size={12} />
                  {l.name}
                </div>
              ))}
            {(d.projects[ep.projectId].worldElements ?? []).map((element) => (
              <div
                draggable
                key={element.id}
                onDragStart={(e) =>
                  e.dataTransfer.setData(
                    "application/dotori-world",
                    JSON.stringify({ kind: element.kind, id: element.id }),
                  )
                }
              >
                <GripVertical size={12} />
                {element.name}
              </div>
            ))}
          </div>
        )}
      </section>
    </aside>
  );
}
function TimelineClip({ shot, order }: { shot: Shot; order: EntityKey[] }) {
  const d = useStore((s) => s.data),
    selected = useSelection((s) => s.keys.includes(`shot:${shot.id}`));
  const [resizing, setResizing] = useState<number | null>(null);
  const [start, setStart] = useState<{ x: number; seconds: number } | null>(
    null,
  );
  const seconds =
      (shot.currentTakeId ? shot.outFrame - shot.inFrame : shot.targetFrames) /
      30,
    asset = shotAsset(d, shot);
  const end = (e: PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (start) {
      commit(
        (data) => setShotDuration(data, shot.id, resizing ?? seconds),
        "Clip duration updated",
      );
      setStart(null);
      setResizing(null);
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    }
  };
  return (
    <div
      className={`st-timeline-clip ${selected ? "is-selected" : ""} ${!shot.currentTakeId ? "placeholder" : ""}`}
      style={{ width: Math.max(105, (resizing ?? seconds) * 24) }}
      onClick={(e) =>
        useSelection.getState().choose(`shot:${shot.id}`, order, e)
      }
      tabIndex={0}
      data-selection-key={`shot:${shot.id}`}
      aria-label={`Timeline shot ${shot.title}`}
      onKeyDown={(e) => {
        if (e.key === "Enter")
          useSelection.getState().choose(`shot:${shot.id}`, order, e);
      }}
    >
      {asset?.url && <img src={asset.url} alt="" />}
      <span>{shot.title}</span>
      <small>
        {resizing ?? seconds}s · {shotStatus(d, shot)}
      </small>
      <button
        className="st-trim-handle"
        aria-label={`Resize ${shot.title}`}
        title="Drag duration; edit exact seconds in Inspector"
        onPointerDown={(e) => {
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          setStart({ x: e.clientX, seconds });
          setResizing(seconds);
        }}
        onPointerMove={(e) => {
          if (start)
            setResizing(
              Math.round(
                Math.max(
                  1,
                  Math.min(30, start.seconds + (e.clientX - start.x) / 24),
                ) * 10,
              ) / 10,
            );
        }}
        onPointerUp={end}
        onPointerCancel={() => {
          setStart(null);
          setResizing(null);
        }}
      />
    </div>
  );
}
export function EpisodeWorkspace() {
  const { projectId = "", episodeId = "" } = useParams();
  const d = useStore((s) => s.data),
    [params] = useSearchParams(),
    navigate = useNavigate(),
    generate = useGenerate(),
    modal = useActions();
  const ep = d.episodes[episodeId],
    view = useStudio((s) => s.view),
    inspector = useStudio((s) => s.inspector),
    outline = useStudio((s) => s.outline),
    keys = useSelection((s) => s.keys);
  const { execute } = useCommands();
  const shots = shotsOfEpisode(d, episodeId),
    order = shots.map((s) => `shot:${s.id}` as EntityKey);
  useEffect(() => {
    useSelection.getState().replace([]);
    useStudio.getState().set({ outline: window.innerWidth > 900 });
    if (window.innerWidth <= 650)
      useStudio.getState().set({ inspector: false });
    const requested =
      params.get("view") ??
      (params.get("tab") === "script"
        ? "script"
        : params.get("tab") === "edit"
          ? "timeline"
          : "board");
    useStudio.getState().set({
      view: ["board", "script", "timeline", "review"].includes(requested)
        ? (requested as WorkspaceView)
        : "board",
    });
    const selected = params.get("shot") ?? params.get("scene");
    if (selected)
      useSelection
        .getState()
        .replace([`${params.get("shot") ? "shot" : "scene"}:${selected}`]);
  }, [episodeId]);
  useEffect(() => {
    const key = keys.at(-1);
    if (key?.startsWith("shot:")) {
      const s = d.shots[entity(key).id];
      if (s)
        useStore.getState().setUI({
          selectedShots: {
            ...useStore.getState().ui.selectedShots,
            [s.sceneId]: s.id,
          },
        });
    }
  }, [keys]);
  const commands = useMemo<StudioCommand[]>(() => {
    if (!ep) return [];
    const selected = () =>
      selectedWorkspaceShots(
        useStore.getState().data,
        useSelection.getState().keys,
        episodeId,
      );
    const gen = (ids: string[]) => {
      const data = useStore.getState().data;
      generate(
        ids,
        ids.some((id) => !data.shots[id].imageTakeId) ? "image" : "video",
      );
    };
    return [
      {
        id: "episode.generate",
        label: `Generate episode · ${shots.length * (shots.some((s) => !s.imageTakeId) ? 8 : 24)} cr`,
        reason: !shots.length
          ? "Add a scene or build a board first"
          : undefined,
        fix: !shots.length ? () => execute("scene.add") : undefined,
        run: () => gen(shots.map((s) => s.id)),
      },
      {
        id: "scene.add",
        label: "Add scene",
        shortcut: "n",
        run: () => {
          let id = "";
          if (
            commit((data) => {
              id = addWorkspaceScene(data, episodeId);
            }, "Scene added")
          )
            useSelection.getState().replace([`scene:${id}`]);
        },
      },
      {
        id: "shot.add",
        label: "Add shot",
        shortcut: "Shift+n",
        run: () => {
          const key = entity(useSelection.getState().keys.at(-1));
          const sid =
            key.type === "scene"
              ? key.id
              : key.type === "shot"
                ? d.shots[key.id]?.sceneId
                : ep.sceneIds.at(-1);
          if (!sid) {
            execute("scene.add");
            return;
          }
          let id = "";
          if (
            commit((data) => {
              id = addWorkspaceShot(data, sid);
            }, "Shot added")
          )
            useSelection.getState().replace([`shot:${id}`]);
        },
      },
      {
        id: "selection.generate",
        label: "Generate selection · 8 cr / shot",
        shortcut: "g",
        run: () => {
          const ids = selected();
          generate(ids.length ? ids : shots.map((s) => s.id), "image");
        },
      },
      {
        id: "selection.animate",
        label: "Animate selection · 24 cr / shot",
        shortcut: "Shift+g",
        run: () => {
          const ids = selected();
          generate(ids.length ? ids : shots.map((s) => s.id), "video");
        },
      },
      {
        id: "selection.lock",
        label: "Lock / unlock selection",
        shortcut: "l",
        run: () => {
          const ids = selected();
          commit(
            (data) =>
              lockWorkspace(
                data,
                ids,
                !ids.every((id) => data.shots[id].locked),
              ),
            "Lock updated",
          );
        },
      },
      {
        id: "selection.director",
        label: "Ask AI Director",
        shortcut: "d",
        run: () =>
          useStudio
            .getState()
            .set({ inspector: true, inspectorTab: "director" }),
      },
      {
        id: "script.board",
        label: ep.sceneIds.length
          ? "Refresh board from script · 0 cr"
          : "Build board from script · 0 cr",
        run: () => {
          if (commit((data) => buildBoard(data, episodeId), "Board updated"))
            useStudio.getState().set({ view: "board" });
        },
      },
      {
        id: "episode.export",
        label: "Export episode",
        run: () => modal({ kind: "export", episodeId }),
      },
      ...shots.flatMap((s) => [
        {
          id: `generate:${s.id}`,
          label: `Generate still · ${CONFIG.imageCost} cr`,
          run: () => generate([s.id], "image"),
        },
        {
          id: `animate:${s.id}`,
          label: `Animate · ${CONFIG.videoCost} cr`,
          run: () => generate([s.id], "video"),
        },
      ]),
      ...ep.sceneIds.map((sid) => ({
        id: `generate-scene:${sid}`,
        label: `Generate scene · ${d.scenes[sid].shotIds.length * (d.scenes[sid].shotIds.some((id) => !d.shots[id].imageTakeId) ? 8 : 24)} cr`,
        run: () => gen(d.scenes[sid].shotIds),
      })),
    ];
  }, [
    episodeId,
    ep,
    shots.map((s) => `${s.id}:${s.imageTakeId}`).join(","),
    d.scenes,
    generate,
    modal,
  ]);
  useRegisterCommands("episode", commands);
  if (!ep || ep.projectId !== projectId)
    return (
      <div className="st-empty">
        <p>Episode unavailable.</p>
        <button className="st-button" onClick={() => navigate("/projects")}>
          Home
        </button>
      </div>
    );
  const board = (mini = false) => (
    <div className={`st-board ${mini ? "st-mini-board" : ""}`}>
      {ep.sceneIds.map((sid, i) => (
        <section className="st-board-scene" key={sid}>
          <header>
            <button
              onClick={(e) =>
                useSelection.getState().choose(
                  `scene:${sid}`,
                  ep.sceneIds.map((id) => `scene:${id}` as EntityKey),
                  e,
                )
              }
            >
              <span>{String(i + 1).padStart(2, "0")}</span>
              <b>{d.scenes[sid].title}</b>
              <small>{d.scenes[sid].shotIds.length} shots</small>
            </button>
            {!mini && <CommandButton id={`generate-scene:${sid}`} />}
          </header>
          <SortableList
            ids={d.scenes[sid].shotIds}
            onReorder={(ids) =>
              commit((data) => reorderShots(data, sid, ids), "Shots reordered")
            }
          >
            <div className="st-shot-grid">
              {d.scenes[sid].shotIds.map((id) => (
                <SortableItem id={id} key={id} className="st-sortable-card">
                  <ShotCard id={id} order={order} mini={mini} />
                </SortableItem>
              ))}
            </div>
          </SortableList>
        </section>
      ))}
      {!ep.sceneIds.length && (
        <div className="st-empty">
          <Film size={28} />
          <p>No scenes</p>
          <CommandButton id="scene.add" className="st-primary" />
          <button
            className="st-text-button"
            onClick={() => useStudio.getState().set({ view: "script" })}
          >
            Write a script
          </button>
        </div>
      )}
    </div>
  );
  const select = keys.at(-1)?.startsWith("shot:")
    ? entity(keys.at(-1)).id
    : shots[0]?.id;
  return (
    <div
      className={`st-episode ${view === "review" ? "st-review-mode" : ""} ${outline ? "st-outline-open" : ""}`}
    >
      <header className="st-workspace-header">
        <span title={ep.title}>{ep.title}</span>
        <nav className="st-view-switcher" aria-label="Workspace views">
          {(
            [
              { name: "board", icon: LayoutGrid },
              { name: "script", icon: AlignLeft },
              { name: "timeline", icon: PanelsTopLeft },
              { name: "review", icon: Play },
            ] as const
          ).map((v, i) => (
            <button
              key={v.name}
              aria-label={v.name[0].toUpperCase() + v.name.slice(1)}
              aria-pressed={view === v.name}
              title={`${v.name[0].toUpperCase() + v.name.slice(1)} (${i + 1})`}
              onClick={() => execute(`view.${v.name}`)}
            >
              <v.icon size={13} />
              <span>{v.name[0].toUpperCase() + v.name.slice(1)}</span>
            </button>
          ))}
        </nav>
        <CommandButton id="episode.generate" className="st-primary" />
      </header>
      <Group
        orientation="horizontal"
        id="episode-panels"
        defaultLayout={useStore.getState().ui.layouts.studio}
        onLayoutChanged={(layout) =>
          useStore.getState().setUI({
            layouts: { ...useStore.getState().ui.layouts, studio: layout },
          })
        }
      >
        {outline && view !== "review" && (
          <>
            <Panel
              id="outline"
              defaultSize="19%"
              minSize="150px"
              maxSize="300px"
              className="st-outline-panel"
            >
              <Outline episodeId={episodeId} order={order} />
            </Panel>
            <Separator className="st-separator" />
          </>
        )}
        <Panel id="canvas" minSize="25%" className="st-canvas-panel">
          <div className="st-canvas">
            <div className="st-canvas-toolbar">
              <button
                className="st-icon"
                aria-label={outline ? "Hide outline" : "Show outline"}
                title={outline ? "Hide outline" : "Show outline"}
                aria-expanded={outline}
                onClick={() => useStudio.getState().set({ outline: !outline })}
              >
                <PanelLeft size={15} />
              </button>
              <div>
                <CommandButton id="scene.add">
                  <Plus size={13} />
                  Add scene
                </CommandButton>
                <CommandButton id="shot.add">
                  <Plus size={13} />
                  Shot
                </CommandButton>
                {!inspector && (
                  <button
                    className="st-icon"
                    aria-label="Show inspector"
                    onClick={() =>
                      useStudio.getState().set({ inspector: true })
                    }
                  >
                    <PanelRight size={15} />
                  </button>
                )}
              </div>
            </div>
            {view === "board" && (
              <SelectionSurface
                className="st-panel-scroll"
                aria-label="Shot board"
              >
                {board()}
              </SelectionSurface>
            )}
            {view === "script" && (
              <div className="st-script-view">
                <section>
                  <div className="st-script-tools">
                    <span>Screenplay</span>
                    <CommandButton id="script.board" />
                  </div>
                  <textarea
                    aria-label="Episode screenplay"
                    key={ep.id}
                    defaultValue={ep.script}
                    placeholder="Write or paste a screenplay…"
                    onBlur={(e) => {
                      if (ep.script !== e.target.value)
                        commit(
                          (data) =>
                            updateScript(data, episodeId, e.target.value),
                          "Screenplay updated",
                        );
                    }}
                  />
                </section>
                <aside aria-label="Synced mini-board">
                  <SelectionSurface className="st-mini-selection">
                    {board(true)}
                  </SelectionSurface>
                </aside>
              </div>
            )}
            {view === "timeline" && (
              <>
                <div className="st-timeline-player">
                  <Player
                    studio
                    shotIds={shots.map((s) => s.id)}
                    selectedId={select}
                    onSelect={(id) =>
                      useSelection.getState().replace([`shot:${id}`])
                    }
                  />
                </div>
                <SelectionSurface
                  className="st-timeline"
                  aria-label="Episode timeline"
                >
                  <div className="st-ruler">
                    {Array.from({ length: 19 }, (_, i) => (
                      <span key={i}>{i * 5}s</span>
                    ))}
                  </div>
                  <div className="st-timeline-track">
                    {ep.sceneIds.map((sid) => (
                      <section className="st-timeline-scene" key={sid}>
                        <button
                          className="st-text-button"
                          onClick={() =>
                            useSelection.getState().replace([`scene:${sid}`])
                          }
                        >
                          {d.scenes[sid].title}
                        </button>
                        <SortableList
                          ids={d.scenes[sid].shotIds}
                          onReorder={(ids) =>
                            commit(
                              (data) => reorderShots(data, sid, ids),
                              "Timeline reordered",
                            )
                          }
                        >
                          <div className="st-timeline-clips">
                            {d.scenes[sid].shotIds.map((id) => (
                              <SortableItem
                                key={id}
                                id={id}
                                className="st-timeline-sort"
                              >
                                <TimelineClip
                                  shot={d.shots[id]}
                                  order={order}
                                />
                              </SortableItem>
                            ))}
                          </div>
                        </SortableList>
                      </section>
                    ))}
                  </div>
                </SelectionSurface>
              </>
            )}
            {view === "review" && (
              <div className="st-review">
                <Player
                  studio
                  shotIds={shots.map((s) => s.id)}
                  selectedId={select}
                  onSelect={(id) =>
                    useSelection.getState().replace([`shot:${id}`])
                  }
                />
                <div className="st-review-strip">
                  {shots.map((s) => (
                    <button
                      key={s.id}
                      aria-pressed={s.id === select}
                      onClick={() =>
                        useSelection.getState().replace([`shot:${s.id}`])
                      }
                    >
                      {shotAsset(d, s)?.url && (
                        <img src={shotAsset(d, s)!.url} alt="" />
                      )}
                      <span>{s.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <footer className="st-canvas-status">
              <span>
                {shots.length} shots ·{" "}
                {shots.reduce((n, s) => n + (s.outFrame - s.inFrame) / 30, 0)}s
              </span>
              <span>
                {keys.length} selected ·{" "}
                {shots.filter((s) => isBusy(d, s.id)).length} generating
              </span>
            </footer>
          </div>
        </Panel>
        {inspector && view !== "review" && (
          <>
            <Separator className="st-separator" />
            <Panel
              id="inspector"
              defaultSize="29%"
              minSize="260px"
              maxSize="440px"
              className="st-inspector-panel"
            >
              <Inspector episodeId={episodeId} projectId={projectId} />
            </Panel>
          </>
        )}
      </Group>
    </div>
  );
}
export function LegacyEpisodeRedirect() {
  const { projectId, episodeId, sceneId } = useParams();
  const [params] = useSearchParams();
  const location = useLocation();
  const edit = location.pathname.endsWith("/edit");
  return (
    <LegacyGo
      to={`/projects/${projectId}/episodes/${episodeId}?view=${edit ? "timeline" : params.get("tab") === "script" ? "script" : "board"}${sceneId ? `&scene=${sceneId}` : ""}`}
    />
  );
}
function LegacyGo({ to }: { to: string }) {
  const navigate = useNavigate();
  useEffect(() => {
    navigate(to, { replace: true });
  }, [to, navigate]);
  return null;
}
