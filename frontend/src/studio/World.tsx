import { SelectionSurface } from "./SelectionSurface";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Plus,
  Users,
  MapPin,
  Box,
  StickyNote,
  ArrowUpRight,
  ArrowLeft,
  Search,
  GripVertical,
} from "lucide-react";
import { useStore } from "../stores/store";
import { type EntityKey, useSelection } from "./selection";
import { commit } from "./generation";
import {
  CommandButton,
  CommandMenu,
  useRegisterCommands,
  type StudioCommand,
} from "./commands";
import {
  Field,
  registerInspector,
  RegisteredInspectorSections,
} from "./inspector";
import {
  createWorldElement,
  editWorldElement,
  worldAppearances,
  updateWorldShots,
  scriptSuggestions,
  changeWorldAsset,
  worldElementCards,
  type WorldElementCard,
  type WorldElementKind,
} from "../domain/workspace";
import {
  createLook,
  updateLook,
  addLookAngle,
  enqueueStudio,
  studioCost,
  approveVersion,
} from "../domain/studio-commands";
import {
  targetBusy,
  characterLooks,
  characterReferences,
  referenceLabels,
} from "../domain/studio-selectors";
import type { StudioOperation } from "../domain/types";

function WorldMedia({
  kind,
  id,
  current,
  title,
}: {
  kind: StudioOperation;
  id: string;
  current?: string;
  title: string;
}) {
  const d = useStore((s) => s.data),
    cost = studioCost(kind);
  const versions = Object.values(d.studio.versions)
    .filter(
      (v) =>
        v.ownerKind === kind && v.ownerId === id && v.approval !== "rejected",
    )
    .sort((a, b) => b.createdAt - a.createdAt);
  const selected = versions.find((v) => v.id === current) ?? versions[0],
    asset = selected ? d.assets[selected.assetId] : undefined;
  let reason = "";
  if (targetBusy(d, kind, id)) reason = "Generating";
  else
    try {
      const clone = structuredClone(d);
      enqueueStudio(clone, kind, [id]);
    } catch (e) {
      reason = (e as Error).message
        .replace(
          /Approve the character identity first\./,
          "Use an identity image first.",
        )
        .replace(
          /Approve the Look before generating its additional angle\./,
          "Use a Look image first.",
        );
    }
  const commands = useMemo<StudioCommand[]>(
    () => [
      {
        id: `world.generate:${kind}:${id}`,
        label: `Generate ${title.toLowerCase()} · ${cost} cr`,
        reason: reason || undefined,
        fix: reason
          ? () =>
              document
                .getElementById("world-identity-fields")
                ?.scrollIntoView({ block: "center" })
          : undefined,
        run: () =>
          commit(
            (data) => {
              enqueueStudio(data, kind, [id]);
            },
            "Image generation submitted",
            false,
          ),
      },
    ],
    [kind, id, title, cost, reason],
  );
  useRegisterCommands(`world-media:${kind}:${id}`, commands);
  return (
    <section className="st-world-media">
      <div className="st-section-heading">
        <h3>{title}</h3>
        <span className="st-status">{asset ? "Still" : "Draft"}</span>
      </div>
      {asset?.url && !asset.missing ? (
        <img
          className="st-world-image"
          src={asset.url}
          alt={`${title} preview`}
        />
      ) : (
        <div className="st-world-image st-world-placeholder">{title}</div>
      )}
      <CommandButton id={`world.generate:${kind}:${id}`} />
      {versions.length > 0 && (
        <div className="st-world-versions">
          {versions.map((v) => (
            <div key={v.id}>
              <img
                src={d.assets[v.assetId]?.url}
                alt={`${title} alternative`}
              />
              <span>{v.id === current ? "In use" : "New take"}</span>
              {v.id !== current && (
                <button
                  className="st-text-button"
                  onClick={() =>
                    commit(
                      (data) => approveVersion(data, v.id),
                      "Image selected",
                    )
                  }
                >
                  Use image
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
const worldTabs = [
  { kind: "character", label: "Characters", icon: Users },
  { kind: "place", label: "Places", icon: MapPin },
  { kind: "prop", label: "Props", icon: Box },
  { kind: "note", label: "Notes", icon: StickyNote },
] as const;
export function WorldWorkspace() {
  const { projectId = "" } = useParams(),
    d = useStore((s) => s.data),
    [params, setParams] = useSearchParams();
  const keys = useSelection((s) => s.keys);
  const [showInspector, setShowInspector] = useState(false);
  const grid = useRef<HTMLDivElement>(null),
    positions = useRef<Record<string, number>>({});
  const filter = worldTabs.some((tab) => tab.kind === params.get("kind"))
    ? (params.get("kind") as WorldElementKind)
    : "character";
  const query = params.get("q") ?? "",
    sheet = !!params.get("id");
  const elements = worldElementCards(d, projectId),
    visible = elements.filter(
      (e) =>
        e.kind === filter && e.name.toLowerCase().includes(query.toLowerCase()),
    );
  const selected = sheet
    ? elements.find((e) => e.id === params.get("id"))
    : elements.find(
        (e) => `${e.kind}:${e.id}` === keys.at(-1) && e.kind === filter,
      );
  const kind = selected?.kind ?? filter,
    id = selected?.id ?? "";
  const c = kind === "character" ? d.characters[id] : undefined,
    l = kind === "place" ? d.studio.locations[id] : undefined;
  const category = worldTabs.find((tab) => tab.kind === filter)!;
  const Icon = worldTabs.find((tab) => tab.kind === kind)!.icon;
  const preview = selected?.assetId ? d.assets[selected.assetId] : undefined;
  const updateParams = (
    values: { kind?: string; q?: string; id?: string },
    replace = false,
  ) => {
    const next = new URLSearchParams();
    next.set("kind", values.kind ?? filter);
    if (values.q ?? query) next.set("q", values.q ?? query);
    if (values.id) next.set("id", values.id);
    setParams(next, { replace });
  };
  const open = (item: WorldElementCard) => {
    if (grid.current) positions.current[filter] = grid.current.scrollTop;
    useSelection.getState().replace([`${item.kind}:${item.id}`]);
    updateParams({ kind: item.kind, id: item.id });
  };
  const choose = (
    item: WorldElementCard,
    modifiers: {
      metaKey?: boolean;
      ctrlKey?: boolean;
      shiftKey?: boolean;
    } = {},
  ) => {
    useSelection.getState().choose(
      `${item.kind}:${item.id}`,
      visible.map((e) => `${e.kind}:${e.id}` as EntityKey),
      modifiers,
    );
  };
  const create = (type: string, name: string) => {
    let created = "";
    if (
      commit((data) => {
        created = createWorldElement(data, projectId, type, name);
      }, `${type} created`)
    ) {
      updateParams({ kind: type, id: created });
      useSelection.getState().replace([`${type}:${created}` as EntityKey]);
    }
  };
  useEffect(() => {
    const item = elements.find((e) => e.id === params.get("id"));
    useSelection.getState().replace(item ? [`${item.kind}:${item.id}`] : []);
    setShowInspector(false);
  }, [projectId]);
  useEffect(() => {
    if (sheet && selected) useSelection.getState().replace([`${kind}:${id}`]);
  }, [sheet, id, kind]);
  useLayoutEffect(() => {
    if (!sheet && grid.current)
      grid.current.scrollTop = positions.current[filter] ?? 0;
  }, [sheet, filter]);
  const commands = useMemo<StudioCommand[]>(
    () => [
      ...worldTabs.map((tab) => ({
        id: `world.${tab.kind}.add`,
        label: `Add ${tab.kind}`,
        run: () => create(tab.kind, `Untitled ${tab.kind}`),
      })),
      ...elements.map((item) => ({
        id: `world.open:${item.id}`,
        label: `Open ${item.name}`,
        run: () => open(item),
      })),
      {
        id: "world.open",
        label: "Open sheet",
        reason: !selected ? "Select an element." : undefined,
        run: () => {
          if (selected) open(selected);
        },
      },
      {
        id: "world.update",
        label: "Update affected shots",
        run: () =>
          commit((data) => {
            const selection = useSelection
              .getState()
              .keys.filter((key) =>
                ["character", "place", "prop", "note"].includes(
                  key.slice(0, key.indexOf(":")),
                ),
              );
            for (const key of selection.length
              ? selection
              : id
                ? [`${kind}:${id}`]
                : []) {
              const i = key.indexOf(":");
              updateWorldShots(data, key.slice(0, i), key.slice(i + 1));
            }
          }, "Affected shots marked for update"),
      },
    ],
    [
      projectId,
      id,
      kind,
      query,
      elements.map((e) => `${e.id}:${e.name}`).join("|"),
    ],
  );
  useRegisterCommands("world", commands);
  if (!d.projects[projectId])
    return <div className="st-empty">Project unavailable</div>;
  const inspector = (
    <aside
      className={`st-world-inspector ${showInspector ? "is-mobile-open" : ""}`}
      aria-label="World inspector"
    >
      <header>
        <b>
          {keys.length > 1 && !sheet ? `${keys.length} selected` : "Inspector"}
        </b>
        <button
          className="st-icon st-mobile-details"
          aria-label="Close World inspector"
          onClick={() => setShowInspector(false)}
        >
          ×
        </button>
      </header>
      <div className="st-panel-scroll">
        {selected ? (
          <>
            {!sheet && (
              <section className="st-world-card-summary">
                {preview && !preview.missing && (
                  <img
                    className="st-world-image"
                    src={preview.url}
                    alt={`${selected.name} preview`}
                  />
                )}
                <h2>{selected.name}</h2>
                <p>{selected.description}</p>
                <small>{d.projects[projectId].title}</small>
                <CommandButton id="world.open">
                  Open sheet <ArrowUpRight size={12} />
                </CommandButton>
              </section>
            )}
            <RegisteredInspectorSections
              type={kind}
              id={id}
              projectId={projectId}
            />
          </>
        ) : (
          <section>
            <p className="st-muted">
              Select a card to inspect its details and shot usage. Double-click
              or choose Open to edit.
            </p>
          </section>
        )}
        <section>
          <h3>Suggested from script</h3>
          {scriptSuggestions(d, projectId).map((name) => (
            <button
              className="st-appears-row"
              key={name}
              onClick={() => create("character", name)}
            >
              <span>{name}</span>
              <Plus size={13} />
            </button>
          ))}
          {!scriptSuggestions(d, projectId).length && (
            <p className="st-muted">No new names found.</p>
          )}
        </section>
      </div>
    </aside>
  );
  return (
    <div className="st-world-workspace">
      <header className="st-world-browser-header">
        <div>
          <span>{d.projects[projectId].title}</span>
          <h1>World</h1>
        </div>
        <div>
          <button
            className="st-button st-mobile-world-inspector"
            onClick={() => setShowInspector(true)}
          >
            Inspector
          </button>
          <CommandButton id={`world.${filter}.add`}>
            <Plus size={13} />
            Add {filter}
          </CommandButton>
        </div>
      </header>
      <div className="st-world-browser-tools">
        <nav className="st-world-tabs" aria-label="World categories">
          {worldTabs.map((tab) => (
            <button
              key={tab.kind}
              aria-pressed={filter === tab.kind}
              onClick={() => {
                useSelection.getState().replace([]);
                updateParams({ kind: tab.kind, q: "" });
              }}
            >
              <tab.icon size={14} />
              {tab.label}
              <small>
                {elements.filter((e) => e.kind === tab.kind).length}
              </small>
            </button>
          ))}
        </nav>
        {!sheet && (
          <label className="st-world-search">
            <Search size={13} />
            <input
              aria-label={`Search ${category.label.toLowerCase()}`}
              placeholder={`Search ${category.label.toLowerCase()}`}
              value={query}
              onChange={(e) => updateParams({ q: e.target.value }, true)}
            />
          </label>
        )}
      </div>
      {sheet ? (
        <div className="st-world-sheet-layout">
          <div className="st-world-detail st-panel-scroll">
            <button
              className="st-text-button st-world-back"
              onClick={() => updateParams({}, true)}
            >
              <ArrowLeft size={13} />
              Back to {category.label}
            </button>
            {selected ? (
              <>
                <div className="st-section-heading">
                  <h1>
                    <Icon size={17} />
                    {selected.name}
                  </h1>
                  <span className="st-status">
                    {preview && !preview.missing ? "Still" : "Draft"}
                  </span>
                </div>
                <section id="world-identity-fields">
                  <Field
                    label="Name"
                    value={selected.name}
                    onSave={(name) =>
                      commit(
                        (data) =>
                          editWorldElement(data, projectId, kind, id, { name }),
                        "Name updated",
                      )
                    }
                  />
                  <Field
                    label={kind === "character" ? "Appearance" : "Description"}
                    value={selected.description}
                    multiline
                    onSave={(description) =>
                      commit(
                        (data) =>
                          editWorldElement(data, projectId, kind, id, {
                            description,
                          }),
                        "Description updated",
                      )
                    }
                  />
                </section>
                {c && (
                  <>
                    <WorldMedia
                      kind="identity"
                      id={id}
                      current={c.canonicalVersionId}
                      title="Identity"
                    />
                    <section className="st-world-looks">
                      <div className="st-section-heading">
                        <h2>Looks</h2>
                        <button
                          className="st-text-button"
                          onClick={() =>
                            commit((data) => {
                              createLook(data, id);
                            }, "Look added")
                          }
                        >
                          + Add Look
                        </button>
                      </div>
                      {characterLooks(d, id).map((look) => (
                        <div className="st-world-look" key={look.id}>
                          <div>
                            <Field
                              label={`Look name ${look.name}`}
                              value={look.name}
                              onSave={(name) =>
                                commit(
                                  (data) => updateLook(data, look.id, { name }),
                                  "Look renamed",
                                )
                              }
                            />
                            <Field
                              label={`Clothing for ${look.name}`}
                              value={look.description}
                              multiline
                              onSave={(description) =>
                                commit(
                                  (data) =>
                                    updateLook(data, look.id, { description }),
                                  "Look updated",
                                )
                              }
                            />
                            <button
                              className="st-text-button"
                              onClick={() =>
                                commit((data) => {
                                  addLookAngle(data, look.id);
                                }, "Angle added")
                              }
                            >
                              + Add angle
                            </button>
                          </div>
                          <WorldMedia
                            kind="look"
                            id={look.id}
                            current={look.primaryVersionId}
                            title={look.name}
                          />
                        </div>
                      ))}
                    </section>
                    <section>
                      <h2>Angles</h2>
                      <div className="st-world-angles">
                        {characterReferences(d, id).map((ref) => (
                          <WorldMedia
                            key={ref.id}
                            kind="reference"
                            id={ref.id}
                            current={ref.activeVersionId}
                            title={`${referenceLabels[ref.type]}${ref.lookId ? ` · ${d.studio.looks[ref.lookId]?.name}` : ""}`}
                          />
                        ))}
                      </div>
                    </section>
                  </>
                )}
                {l && (
                  <WorldMedia
                    kind="location"
                    id={id}
                    current={l.primaryVersionId}
                    title="Place"
                  />
                )}
                {(kind === "prop" || kind === "note") &&
                  id !== `bible-${projectId}` && (
                    <section className="st-world-media">
                      <h3>Reference image</h3>
                      <select
                        aria-label="World reference image"
                        value={(selected as { assetId?: string }).assetId ?? ""}
                        onChange={(e) =>
                          commit(
                            (data) =>
                              changeWorldAsset(
                                data,
                                projectId,
                                id,
                                e.target.value || undefined,
                              ),
                            "World reference updated",
                          )
                        }
                      >
                        <option value="">No image</option>
                        {Object.values(d.assets)
                          .filter(
                            (a) =>
                              a.projectId === projectId &&
                              a.kind === "image" &&
                              !a.missing,
                          )
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.title}
                            </option>
                          ))}
                      </select>
                      {(selected as { assetId?: string }).assetId && (
                        <img
                          className="st-world-image"
                          src={
                            d.assets[
                              (selected as { assetId?: string }).assetId!
                            ]?.url
                          }
                          alt={selected.name}
                        />
                      )}
                    </section>
                  )}
              </>
            ) : (
              <div className="st-empty">
                <p>This element is unavailable.</p>
              </div>
            )}
          </div>
          {inspector}
        </div>
      ) : (
        <div className="st-world-browser-layout">
          <SelectionSurface
            className="st-world-grid-scroll st-panel-scroll"
            aria-label="World cards"
            scrollRef={grid}
            onScroll={(e) => {
              positions.current[filter] = e.currentTarget.scrollTop;
            }}
          >
            <div className={`st-world-card-grid world-${filter}`}>
              {visible.map((item) => {
                const asset = item.assetId ? d.assets[item.assetId] : undefined,
                  selected = keys.includes(`${item.kind}:${item.id}`),
                  CardIcon = worldTabs.find(
                    (tab) => tab.kind === item.kind,
                  )!.icon;
                return (
                  <CommandMenu
                    key={item.id}
                    ids={[
                      `world.open:${item.id}`,
                      "world.update",
                      `world.${item.kind}.add`,
                    ]}
                    onSelect={() => {
                      if (!selected) choose(item);
                    }}
                  >
                    <article
                      className={`st-world-card ${selected ? "is-selected" : ""}`}
                      data-selection-key={`${item.kind}:${item.id}`}
                      aria-label={`${item.kind[0].toUpperCase() + item.kind.slice(1)} ${item.name}`}
                      tabIndex={0}
                      onClick={(e) => {
                        choose(item, e);
                        if (
                          window.matchMedia("(pointer: coarse)").matches &&
                          !e.metaKey &&
                          !e.ctrlKey &&
                          !e.shiftKey
                        )
                          open(item);
                      }}
                      onDoubleClick={() => open(item)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") open(item);
                        if (e.key === " ") {
                          e.preventDefault();
                          choose(item, e);
                        }
                      }}
                    >
                      <div className="st-world-card-preview">
                        <button
                          className="st-world-reference-handle"
                          draggable
                          aria-label={`Drag ${item.name} as reference`}
                          title="Drag as reference"
                          onClick={(e) => e.stopPropagation()}
                          onDoubleClick={(e) => e.stopPropagation()}
                          onDragStart={(e) => {
                            e.dataTransfer.setData(
                              "application/dotori-world",
                              JSON.stringify({ kind: item.kind, id: item.id }),
                            );
                          }}
                        >
                          <GripVertical size={16} />
                        </button>
                        {asset && !asset.missing ? (
                          <img src={asset.url} alt="" loading="lazy" />
                        ) : item.kind === "note" ? (
                          <p>{item.description || "Empty note"}</p>
                        ) : (
                          <CardIcon size={32} />
                        )}
                        <span>
                          {asset && !asset.missing ? "Still" : "Draft"}
                        </span>
                      </div>
                      <div className="st-world-card-copy">
                        <b>{item.name}</b>
                        {item.kind === "character" && (
                          <small>
                            {item.looks} looks · {item.angles} angles
                          </small>
                        )}
                        <div>
                          <small>In {item.appearances} shots</small>
                          <button
                            className="st-text-button"
                            aria-label={`Open ${item.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              open(item);
                            }}
                          >
                            Open <ArrowUpRight size={12} />
                          </button>
                        </div>
                      </div>
                    </article>
                  </CommandMenu>
                );
              })}
            </div>
            {!visible.length && (
              <div className="st-home-empty">
                <category.icon size={28} />
                <p>
                  {query
                    ? "No matches"
                    : `No ${category.label.toLowerCase()} yet`}
                </p>
                <CommandButton id={`world.${filter}.add`} />
              </div>
            )}
          </SelectionSurface>
          {inspector}
        </div>
      )}
    </div>
  );
}

function WorldUsage({
  id,
  kind,
  projectId,
}: {
  id: string;
  kind: string;
  projectId: string;
}) {
  const d = useStore((s) => s.data),
    navigate = useNavigate(),
    appearances = worldAppearances(d, kind, id);
  return (
    <>
      <h3>Appears in · {appearances.length} shots</h3>
      {appearances.map((s) => (
        <button
          key={s.id}
          className="st-appears-row"
          onClick={() =>
            navigate(
              `/projects/${projectId}/episodes/${d.scenes[s.sceneId].episodeId}?view=board&shot=${s.id}`,
            )
          }
        >
          <span>
            {d.scenes[s.sceneId].title}
            <b>{s.title}</b>
          </span>
          <ArrowUpRight size={13} />
        </button>
      ))}
      {!appearances.length && (
        <p className="st-muted">
          Assign this element to a shot from the episode outline.
        </p>
      )}
      <CommandButton id="world.update" />
    </>
  );
}
for (const kind of ["character", "place", "prop", "note"])
  registerInspector(kind, {
    id: "usage",
    title: "Shot usage",
    render: (ctx) => <WorldUsage {...ctx} kind={kind} />,
  });
