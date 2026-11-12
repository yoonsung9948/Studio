import { FrameControls, type FrameKind } from "./FrameControls";
import { ImageWorkspace } from "./ImageWorkspace";
import { prepareVideoGeneration } from "../../domain/video-workflow";
import { approveScenePlan, scriptApproved } from "../../domain/workflow";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Clapperboard,
  Film,
  ImageIcon,
  Music,
  Plus,
  Sparkles,
  Upload,
  Users,
  X,
  AlertCircle,
  MapPin,
} from "lucide-react";
import { DialogTitle, DialogDescription } from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
import { useStore } from "../../stores/store";
import {
  CONFIG,
  uid,
  type CastAssignment,
  type ReferencePurpose,
} from "../../domain/types";
import {
  characterLooks,
  characterReady,
  lookReady,
  effectiveCast,
  characterReferences,
  referenceValid,
  referenceLabels,
  versionAsset,
  targetBusy,
} from "../../domain/studio-selectors";
import {
  generationInputs,
  saveGenerationInputs,
  saveGenerationCast,
  referencePurposes,
} from "../../domain/generation-inputs";
import {
  ensureSetup,
  scenePreflight,
  updateShotPlan,
} from "../../domain/scene-preflight";
import {
  createLocation,
  enqueueStudio,
  studioCost,
  updateDirection,
  bumpStudio,
} from "../../domain/studio-commands";
import { enqueueGeneration } from "../../domain/commands";
import { preflight, shotsOfScene } from "../../domain/selectors";

import { MediaVersions } from "../characters/MediaVersions";
type Picker = "cast" | "setting" | "asset";
export function GenerationDialog({
  ids,
  replacement = false,
  proposalId,
  close,
  embedded = false,
  initialShotId,
  videoMode = false,
  fromScript = false,
  onGenerated,
}: {
  ids: string[];
  replacement?: boolean;
  proposalId?: string;
  close: () => void;
  embedded?: boolean;
  initialShotId?: string;
  videoMode?: boolean;
  fromScript?: boolean;
  onGenerated?: () => void;
}) {
  const d = useStore((s) => s.data),
    mutate = useStore((s) => s.mutate);
  const sceneIds = [
    ...new Set(ids.flatMap((id) => (d.shots[id] ? [d.shots[id].sceneId] : []))),
  ];
  const [sid, setSid] = useState(sceneIds[0] ?? ""),
    [shotId, setShotId] = useState<string | undefined>(
      initialShotId ?? (ids.length === 1 ? ids[0] : undefined),
    );
  const [picker, setPicker] = useState<Picker | null>(null),
    [query, setQuery] = useState(""),
    [error, setError] = useState("");
  const [regenerate, setRegenerate] = useState(replacement),
    [showPreflight, setShowPreflight] = useState(false),
    [newSetting, setNewSetting] = useState(false);
  const [imageWorkspace, setImageWorkspace] = useState<{
    shotId: string;
    kind: FrameKind;
  } | null>(null);
  const summary = useRef<HTMLElement>(null);
  const [summaryHeight, setSummaryHeight] = useState<number>();
  useLayoutEffect(() => {
    if (!embedded) return;
    const resize = () => {
      const el = summary.current;
      if (!el) return;
      if (window.innerWidth <= 850) {
        setSummaryHeight(undefined);
        return;
      }
      setSummaryHeight(
        Math.max(
          200,
          Math.floor(
            window.innerHeight -
              Math.max(24, el.getBoundingClientRect().top) -
              24,
          ),
        ),
      );
    };
    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("scroll", resize, true);
    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", resize, true);
    };
  }, [embedded, sid, !!d.studio.setups[sid]]);
  const upload = useRef<HTMLInputElement>(null),
    uploadFor = useRef<"setting" | "asset">("asset");
  useEffect(() => {
    mutate((d) => {
      for (const id of sceneIds) {
        ensureSetup(d, id);
        if (videoMode) prepareVideoGeneration(d, d.scenes[id].episodeId, id);
      }
    });
  }, []);
  const sc = d.scenes[sid],
    setup = d.studio.setups[sid];
  if (!sc)
    return (
      <>
        <DialogTitle>Generation unavailable</DialogTitle>
        <DialogDescription>
          Choose an existing scene or shot to generate.
        </DialogDescription>
        <Button onClick={close}>Close</Button>
      </>
    );
  if (!setup)
    return (
      <>
        <DialogTitle>Preparing scene inputs</DialogTitle>
        <DialogDescription>Loading saved selections…</DialogDescription>
      </>
    );
  const pid = d.episodes[sc.episodeId].projectId;
  const inputs = generationInputs(d, sid, shotId),
    cast = shotId ? effectiveCast(d, shotId) : setup.cast;
  const shots = shotsOfScene(d, sid).filter((s) => ids.includes(s.id));
  const plans = sceneIds.map((id) => ({
    id,
    plan: scenePreflight(d, id, undefined, undefined, ids),
  }));
  const eligibleIds = ids.filter(
    (id) => plans.find((p) => p.id === d.shots[id]?.sceneId)?.plan.ready,
  );
  const work = preflight(d, eligibleIds, regenerate),
    cost = work.reduce((n, w) => n + w.cost, 0);
  const currentPlan = plans.find((p) => p.id === sid)!.plan;
  const excluded = plans.filter((p) => !p.plan.ready);
  const location = inputs.locationId
    ? d.studio.locations[inputs.locationId]
    : undefined;
  const save = (fields: Parameters<typeof saveGenerationInputs>[2]) =>
    mutate((d) => saveGenerationInputs(d, sid, fields, shotId), true);
  const saveCast = (next: CastAssignment[]) =>
    mutate((d) => saveGenerationCast(d, sid, next, shotId), true);
  const openPicker = (value: Picker) => {
    setPicker(value);
    setQuery("");
  };
  const switchScene = (id: string) => {
    setSid(id);
    setShotId(undefined);
    setPicker(null);
  };
  const focusGroup = (group: string) => {
    setPicker(null);
    document
      .getElementById(
        `generation-${group === "Cast" ? "cast" : group === "Location" ? "setting" : group === "References" ? "references" : "shots"}`,
      )
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  const chooseAsset = (assetId: string) => {
    if (inputs.referenceInputs.length >= 12) {
      setError("Use up to 12 additional references.");
      return;
    }
    if (!inputs.referenceInputs.some((r) => r.assetId === assetId))
      save({
        referenceInputs: [
          ...inputs.referenceInputs,
          {
            assetId,
            purpose:
              d.assets[assetId].kind === "audio"
                ? "audio"
                : d.assets[assetId].kind === "video"
                  ? "camera_movement"
                  : "visual_style",
          },
        ],
      });
    setPicker(null);
  };
  const totalTargets = ids.reduce(
    (n, id) => n + (d.shots[id]?.targetFrames ?? 0) / 30,
    0,
  );
  if (imageWorkspace)
    return (
      <ImageWorkspace
        embedded={embedded}
        shotId={imageWorkspace.shotId}
        kind={imageWorkspace.kind}
        back={() => setImageWorkspace(null)}
      />
    );
  const Title = embedded ? "h2" : DialogTitle;
  const Description = embedded ? "p" : DialogDescription;
  return (
    <div
      className={embedded ? "generation-embedded" : "generation-dialog-inner"}
    >
      <header className="generation-heading">
        <div className="generation-heading-icon">
          <Clapperboard size={20} />
        </div>
        <div>
          <Title>
            {videoMode
              ? sceneIds.length > 1
                ? "Generate episode"
                : "Generate scene"
              : sceneIds.length > 1
                ? "Generate scenes"
                : ids.length === 1
                  ? "Generate shot"
                  : regenerate
                    ? "Regenerate scene"
                    : "Generate scene"}
          </Title>
          <Description>
            {sc.title} <span> / </span> Assemble the references for your next
            take.
          </Description>
        </div>
        <span className="badge">DEMO</span>
      </header>
      <div className="generation-layout">
        <main className="generation-selection">
          {videoMode && fromScript && (
            <p className="workflow-notice">
              Your script has been broken into scenes automatically. You can
              generate now or adjust each scene’s references below.
            </p>
          )}
          {sceneIds.length > 1 && (
            <nav className="generation-scenes" aria-label="Scenes to generate">
              {plans.map((p) => (
                <button
                  key={p.id}
                  aria-pressed={p.id === sid}
                  onClick={() => switchScene(p.id)}
                >
                  <span
                    className={p.plan.ready ? "ready-dot" : "blocked-dot"}
                  />
                  {d.scenes[p.id].title}
                  <small>{p.plan.ready ? "Ready" : "Needs attention"}</small>
                </button>
              ))}
            </nav>
          )}
          <div className="generation-context">
            <div>
              <span className="eyebrow">
                {embedded ? "REFERENCE INPUTS" : "SCENE BRIEF"}
              </span>
              <h2>{sc.title}</h2>
            </div>
            {ids.length > 1 && (
              <div className="generation-scope" aria-label="Input scope">
                <button
                  aria-pressed={!shotId}
                  onClick={() => {
                    setShotId(undefined);
                    setPicker(null);
                  }}
                >
                  Scene
                </button>
                <button
                  aria-pressed={!!shotId}
                  onClick={() => {
                    setShotId(shots[0]?.id);
                    setPicker(null);
                  }}
                >
                  Individual shots
                </button>
              </div>
            )}
          </div>
          {shotId && (
            <div className="generation-shot-context">
              <label>
                Editing shot
                <select
                  aria-label="Editing shot"
                  value={shotId}
                  onChange={(e) => {
                    setShotId(e.target.value);
                    setPicker(null);
                  }}
                >
                  {shots.map((s, i) => (
                    <option key={s.id} value={s.id}>
                      {i + 1}. {s.title}
                    </option>
                  ))}
                </select>
              </label>
              <p>
                {d.shots[shotId].generationOverride ||
                d.shots[shotId].castOverride
                  ? "This shot has custom inputs."
                  : "Inherits the scene’s references. Changes here apply to this shot only."}
              </p>
              {(d.shots[shotId].generationOverride ||
                d.shots[shotId].castOverride) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    mutate((d) => {
                      updateShotPlan(d, shotId, { castOverride: undefined });
                      d.shots[shotId].generationOverride = undefined;
                    }, true)
                  }
                >
                  Reset to scene inputs
                </Button>
              )}
            </div>
          )}
          <section
            className="generation-section"
            hidden={embedded}
            id="generation-instructions"
          >
            <div className="generation-section-label">
              <span>01</span>
              <div>
                <h3>What happens in this scene?</h3>
                <p>Action, dialogue, and the feeling you want to create.</p>
              </div>
            </div>
            <label className="sr-only" htmlFor="scene-generation-prompt">
              Generation instructions
            </label>
            <textarea
              id="scene-generation-prompt"
              key={`${sid}-${shotId}-${inputs.instructions}`}
              defaultValue={inputs.instructions}
              placeholder="Describe the moment you want to bring to life…"
              onBlur={(e) => {
                if (e.target.value !== inputs.instructions)
                  save({ instructions: e.target.value });
              }}
            />
            {shotId && (
              <p className="generation-caption">
                Shot action: {d.shots[shotId].action}
                {d.shots[shotId].dialogue &&
                  ` · Dialogue: ${d.shots[shotId].dialogue}`}
              </p>
            )}
            <details className="generation-advanced">
              <summary>Creative direction</summary>
              <div className="generation-direction">
                {(
                  [
                    "time",
                    "lighting",
                    "mood",
                    "style",
                    "camera",
                    "notes",
                  ] as const
                ).map((key) => (
                  <label key={key}>
                    {
                      {
                        time: "Time of day",
                        lighting: "Lighting",
                        mood: "Mood",
                        style: "Visual style",
                        camera: "Camera",
                        notes: "Notes",
                      }[key]
                    }
                    <input
                      defaultValue={setup.direction[key]}
                      key={`${sid}-${setup.direction[key]}`}
                      onBlur={(e) => {
                        if (e.target.value !== setup.direction[key])
                          mutate(
                            (d) =>
                              updateDirection(d, sid, {
                                [key]: e.target.value,
                              }),
                            true,
                          );
                      }}
                    />
                  </label>
                ))}
              </div>
              <small>Creative direction applies across the scene.</small>
            </details>
          </section>
          <section className="generation-section" id="generation-cast">
            <div className="generation-section-label">
              <span>02</span>
              <div>
                <h3>Who’s in the scene?</h3>
                <p>Choose a character, then the Look they’ll wear.</p>
              </div>
              <Button size="sm" onClick={() => openPicker("cast")}>
                <Plus size={13} />
                Add character
              </Button>
            </div>
            <div className="generation-cast">
              {cast.map((a) => {
                const c = d.characters[a.characterId],
                  look = a.lookId ? d.studio.looks[a.lookId] : undefined;
                const refs = [
                  ...characterReferences(d, a.characterId),
                  ...Object.values(d.studio.references).filter(
                    (r) =>
                      r.characterId === a.characterId &&
                      r.lookId === a.lookId &&
                      !!r.lookId,
                  ),
                ];
                const ready =
                  characterReady(d, a.characterId) && lookReady(d, a.lookId);
                return (
                  <article className="generation-character" key={a.characterId}>
                    <div className="generation-character-top">
                      <div className="generation-character-photo">
                        {versionAsset(
                          d,
                          look?.primaryVersionId ?? c?.canonicalVersionId,
                        )?.url ? (
                          <img
                            src={
                              versionAsset(
                                d,
                                look?.primaryVersionId ?? c?.canonicalVersionId,
                              )!.url
                            }
                            alt={`${c?.name} reference`}
                          />
                        ) : (
                          <Users size={22} />
                        )}
                      </div>
                      <div>
                        <h4>{c?.name ?? "Missing character"}</h4>
                        <label>
                          Look
                          <select
                            aria-label={`Look for ${c?.name}`}
                            value={a.lookId ?? ""}
                            onChange={(e) =>
                              saveCast(
                                cast.map((x) =>
                                  x.characterId === a.characterId
                                    ? {
                                        ...x,
                                        lookId: e.target.value || undefined,
                                        referenceIds: undefined,
                                      }
                                    : x,
                                ),
                              )
                            }
                          >
                            <option value="">Canonical identity</option>
                            {characterLooks(d, a.characterId, sc.episodeId).map(
                              (l) => (
                                <option value={l.id} key={l.id}>
                                  {l.name}
                                  {lookReady(d, l.id)
                                    ? ""
                                    : " · needs approval"}
                                </option>
                              ),
                            )}
                          </select>
                        </label>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${c?.name} from inputs`}
                        onClick={() =>
                          saveCast(
                            cast.filter((x) => x.characterId !== a.characterId),
                          )
                        }
                      >
                        <X size={14} />
                      </Button>
                    </div>
                    <div className="generation-character-footer">
                      <span className={ready ? "green-text" : "amber-text"}>
                        {ready ? (
                          <Check size={12} />
                        ) : (
                          <AlertCircle size={12} />
                        )}{" "}
                        {ready ? "Identity + Look ready" : "Needs approval"}
                      </span>
                      <Link
                        onClick={close}
                        to={`/projects/${pid}/characters/${a.characterId}?${a.lookId ? `tab=looks&look=${a.lookId}&` : ""}returnTo=${encodeURIComponent(`/projects/${pid}/episodes/${sc.episodeId}/scenes/${sid}?step=references`)}`}
                      >
                        Character Studio <ChevronRight size={11} />
                      </Link>
                    </div>
                    <details className="generation-advanced">
                      <summary>
                        {a.referenceIds?.length
                          ? `${a.referenceIds.length} selected views`
                          : "Use approved reference views"}
                      </summary>
                      <p className="generation-caption">
                        Identity and selected Look are always included. Select
                        specific views to require them.
                      </p>
                      <div className="generation-view-options">
                        {refs.map((r) => (
                          <label key={r.id}>
                            <input
                              type="checkbox"
                              checked={a.referenceIds?.includes(r.id) ?? false}
                              onChange={(e) =>
                                saveCast(
                                  cast.map((x) =>
                                    x.characterId === a.characterId
                                      ? {
                                          ...x,
                                          referenceIds: e.target.checked
                                            ? [...(x.referenceIds ?? []), r.id]
                                            : (x.referenceIds ?? []).filter(
                                                (id) => id !== r.id,
                                              ),
                                        }
                                      : x,
                                  ),
                                )
                              }
                            />
                            {referenceLabels[r.type]}
                            {!referenceValid(d, r.id) && (
                              <small>Needs review</small>
                            )}
                          </label>
                        ))}
                      </div>
                    </details>
                  </article>
                );
              })}
              {!cast.length && (
                <div className="generation-empty">
                  <Users size={23} />
                  <p>No characters selected</p>
                  <small>Leave empty for an environment-only scene.</small>
                </div>
              )}
            </div>
            {picker === "cast" && (
              <div
                className="generation-library"
                role="region"
                aria-label="Character library"
              >
                <LibraryHeader
                  title="Choose a character"
                  query={query}
                  setQuery={setQuery}
                  close={() => setPicker(null)}
                />
                <div className="generation-library-grid">
                  {Object.values(d.characters)
                    .filter(
                      (c) =>
                        c.projectId === pid &&
                        !cast.some((a) => a.characterId === c.id) &&
                        c.name.toLowerCase().includes(query.toLowerCase()),
                    )
                    .map((c) => (
                      <button
                        key={c.id}
                        onClick={() => {
                          saveCast([...cast, { characterId: c.id }]);
                          setPicker(null);
                        }}
                      >
                        {versionAsset(d, c.canonicalVersionId)?.url ? (
                          <img
                            src={versionAsset(d, c.canonicalVersionId)!.url}
                            alt=""
                          />
                        ) : (
                          <Users size={24} />
                        )}
                        <b>{c.name}</b>
                        <small>
                          {characterReady(d, c.id)
                            ? `${characterLooks(d, c.id, sc.episodeId).length} Looks available`
                            : "Identity needs approval"}
                        </small>
                      </button>
                    ))}
                </div>
              </div>
            )}
          </section>
          <section className="generation-section" id="generation-setting">
            <div className="generation-section-label">
              <span>03</span>
              <div>
                <h3>Where does it happen?</h3>
                <p>A saved setting or a reference image for the environment.</p>
              </div>
            </div>
            <div className="generation-setting-card">
              {location?.assetId && d.assets[location.assetId]?.url ? (
                <img src={d.assets[location.assetId].url} alt={location.name} />
              ) : (
                <div className="generation-setting-empty">
                  <MapPin size={25} />
                </div>
              )}
              <div>
                <h4>
                  {location?.name ??
                    (inputs.locationMode === "none"
                      ? "No setting reference"
                      : "Infer from instructions")}
                </h4>
                <p>
                  {location?.description ||
                    "Use the scene description to establish the surroundings."}
                </p>
                <div className="row-actions">
                  <Button size="sm" onClick={() => openPicker("setting")}>
                    {location ? "Change setting" : "Choose setting"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      uploadFor.current = "setting";
                      if (upload.current)
                        upload.current.accept =
                          "image/png,image/jpeg,image/webp";
                      upload.current?.click();
                    }}
                  >
                    <Upload size={12} />
                    Upload
                  </Button>
                </div>
              </div>
              {location && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove setting reference"
                  onClick={() =>
                    save({ locationId: undefined, locationMode: "inferred" })
                  }
                >
                  <X size={14} />
                </Button>
              )}
            </div>
            <label className="generation-setting-mode">
              Setting reference
              <select
                aria-label="Setting reference requirement"
                value={inputs.locationMode}
                onChange={(e) =>
                  save({
                    locationMode: e.target.value as typeof inputs.locationMode,
                    ...(["none", "inferred"].includes(e.target.value)
                      ? { locationId: undefined }
                      : {}),
                  })
                }
              >
                <option value="inferred">Infer from scene instructions</option>
                <option value="none">No reference needed</option>
                <option value="selected">Use selected reference</option>
                <option value="required">Reference required</option>
              </select>
            </label>
            {location && (
              <div className="generation-setting-generation">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={
                    targetBusy(d, "location", location.id) ||
                    d.credits < studioCost("location")
                  }
                  onClick={() =>
                    mutate((d) => {
                      enqueueStudio(d, "location", [location.id]);
                    })
                  }
                >
                  <Sparkles size={12} />
                  {targetBusy(d, "location", location.id)
                    ? "Setting generation in progress"
                    : `Generate setting image · ${studioCost("location")} demo cr`}
                </Button>
                <MediaVersions
                  kind="location"
                  id={location.id}
                  currentId={location.primaryVersionId}
                />
              </div>
            )}
            {picker === "setting" && (
              <div
                className="generation-library"
                role="region"
                aria-label="Setting library"
              >
                <LibraryHeader
                  title="Choose a setting"
                  query={query}
                  setQuery={setQuery}
                  close={() => setPicker(null)}
                />
                <Button size="sm" onClick={() => setNewSetting(!newSetting)}>
                  <Plus size={12} />
                  New setting
                </Button>
                {newSetting && (
                  <form
                    className="generation-new-setting"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const fields = new FormData(e.currentTarget);
                      const name = String(fields.get("name") ?? "").trim(),
                        description = String(
                          fields.get("description") ?? "",
                        ).trim();
                      if (!name) return;
                      mutate((d) => {
                        const lid = createLocation(d, pid, name);
                        d.studio.locations[lid].description = description;
                        saveGenerationInputs(
                          d,
                          sid,
                          { locationId: lid, locationMode: "selected" },
                          shotId,
                        );
                      }, true);
                      setNewSetting(false);
                      setPicker(null);
                    }}
                  >
                    <label>
                      Setting name
                      <input
                        name="name"
                        required
                        maxLength={100}
                        placeholder="Rainy apartment at night"
                      />
                    </label>
                    <label>
                      Description
                      <input
                        name="description"
                        maxLength={3000}
                        placeholder="Architecture, lighting, atmosphere…"
                      />
                    </label>
                    <Button variant="default" size="sm">
                      Create setting
                    </Button>
                  </form>
                )}
                <div className="generation-library-grid setting-grid">
                  {Object.values(d.studio.locations)
                    .filter(
                      (l) =>
                        l.projectId === pid &&
                        l.name.toLowerCase().includes(query.toLowerCase()),
                    )
                    .map((l) => (
                      <button
                        key={l.id}
                        onClick={() => {
                          save({ locationId: l.id, locationMode: "selected" });
                          setPicker(null);
                        }}
                      >
                        {l.assetId && d.assets[l.assetId]?.url ? (
                          <img src={d.assets[l.assetId].url} alt="" />
                        ) : (
                          <MapPin size={24} />
                        )}
                        <b>{l.name}</b>
                        <small>
                          {l.assetId && !d.assets[l.assetId]?.missing
                            ? "Reference available"
                            : "Image needed"}
                        </small>
                      </button>
                    ))}
                </div>
                <p className="generation-caption">
                  You can also use an image from the asset library as a setting
                  reference below.
                </p>
              </div>
            )}
          </section>
          <section className="generation-section" id="generation-references">
            <div className="generation-section-label">
              <span>04</span>
              <div>
                <h3>
                  Other references <small>Optional</small>
                </h3>
                <p>Guide the visual style, movement, continuity, or sound.</p>
              </div>
              <Button size="sm" onClick={() => openPicker("asset")}>
                <Plus size={13} />
                Add reference
              </Button>
            </div>
            <div className="generation-extra-references">
              {inputs.referenceInputs.map((r, index) => {
                const a = d.assets[r.assetId];
                return (
                  <div className="generation-reference-row" key={r.assetId}>
                    {a?.kind === "image" && a.url ? (
                      <img src={a.url} alt={a.title} />
                    ) : (
                      <div className="generation-reference-icon">
                        {a?.kind === "audio" ? (
                          <Music size={20} />
                        ) : (
                          <Film size={20} />
                        )}
                      </div>
                    )}
                    <div>
                      <b>{a?.title ?? "Missing reference"}</b>
                      <small>
                        {a?.missing ? "Reattach after reload" : a?.kind}
                      </small>
                      <select
                        aria-label={`Purpose for ${a?.title ?? "missing reference"}`}
                        value={r.purpose}
                        onChange={(e) =>
                          save({
                            referenceInputs: inputs.referenceInputs.map(
                              (x, i) =>
                                i === index
                                  ? {
                                      ...x,
                                      purpose: e.target
                                        .value as ReferencePurpose,
                                    }
                                  : x,
                            ),
                          })
                        }
                      >
                        {Object.entries(referencePurposes).map(
                          ([key, label]) => (
                            <option key={key} value={key}>
                              {label}
                            </option>
                          ),
                        )}
                      </select>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove reference ${a?.title}`}
                      onClick={() =>
                        save({
                          referenceInputs: inputs.referenceInputs.filter(
                            (_, i) => i !== index,
                          ),
                        })
                      }
                    >
                      <X size={14} />
                    </Button>
                  </div>
                );
              })}
            </div>
            {!inputs.referenceInputs.length && (
              <button
                className="generation-reference-drop"
                onClick={() => {
                  uploadFor.current = "asset";
                  if (upload.current)
                    upload.current.accept =
                      "image/png,image/jpeg,image/webp,video/mp4,video/webm,audio/mpeg,audio/wav,audio/ogg";
                  upload.current?.click();
                }}
              >
                <Upload size={17} />
                <span>
                  Upload an image, video, or audio reference
                  <small>
                    Or choose generated media from your asset library.
                  </small>
                </span>
              </button>
            )}
            {picker === "asset" && (
              <div
                className="generation-library"
                role="region"
                aria-label="Asset library"
              >
                <LibraryHeader
                  title="Choose reference media"
                  query={query}
                  setQuery={setQuery}
                  close={() => setPicker(null)}
                />
                <Button
                  size="sm"
                  onClick={() => {
                    uploadFor.current = "asset";
                    if (upload.current)
                      upload.current.accept =
                        "image/png,image/jpeg,image/webp,video/mp4,video/webm,audio/mpeg,audio/wav,audio/ogg";
                    upload.current?.click();
                  }}
                >
                  <Upload size={12} />
                  Upload reference
                </Button>
                <div className="generation-library-grid">
                  {Object.values(d.assets)
                    .filter(
                      (a) =>
                        a.projectId === pid &&
                        a.url &&
                        !a.missing &&
                        !inputs.referenceInputs.some(
                          (r) => r.assetId === a.id,
                        ) &&
                        a.title.toLowerCase().includes(query.toLowerCase()),
                    )
                    .map((a) => (
                      <button key={a.id} onClick={() => chooseAsset(a.id)}>
                        {a.kind === "image" ? (
                          <img src={a.url} alt="" />
                        ) : a.kind === "audio" ? (
                          <Music size={24} />
                        ) : (
                          <Film size={24} />
                        )}
                        <b>{a.title}</b>
                        <small>{a.kind}</small>
                      </button>
                    ))}
                </div>
              </div>
            )}
            <p className="generation-caption">
              Up to 12 additional references. Uploaded files stay available for
              this browser session.
            </p>
          </section>
          {videoMode && (
            <FrameControls
              ids={shots.map((s) => s.id)}
              onCreate={(shotId, kind) => setImageWorkspace({ shotId, kind })}
            />
          )}
          <section
            className="generation-section"
            hidden={embedded}
            id="generation-shots"
          >
            <div className="generation-section-label">
              <span>05</span>
              <div>
                <h3>Shot plan</h3>
                <p>Scene inputs apply to each shot unless you override them.</p>
              </div>
            </div>
            {shots.map((s, i) => (
              <details className="generation-shot-row" key={s.id}>
                <summary>
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  <b>{s.title}</b>
                  <small>{s.targetFrames / 30}s</small>
                  <span
                    className={
                      s.castOverride || s.generationOverride ? "amber-text" : ""
                    }
                  >
                    {s.castOverride || s.generationOverride
                      ? "Custom inputs"
                      : "Scene inputs"}
                  </span>
                  <ChevronRight size={13} />
                </summary>
                <p>{s.action}</p>
                {s.dialogue && <p>Dialogue: {s.dialogue}</p>}
                <div className="generation-shot-fields">
                  <label>
                    Target seconds
                    <input
                      type="number"
                      aria-label={`Target duration ${s.title}`}
                      min={1}
                      max={30}
                      defaultValue={s.targetFrames / 30}
                      key={s.targetFrames}
                      onBlur={(e) => {
                        const n = Math.round(Number(e.target.value) * 30);
                        if (n !== s.targetFrames)
                          mutate(
                            (d) => updateShotPlan(d, s.id, { targetFrames: n }),
                            true,
                          );
                      }}
                    />
                  </label>
                  <label>
                    Continuation source
                    <select
                      aria-label={`Dependency for ${s.title}`}
                      value={s.dependsOn ?? ""}
                      onChange={(e) =>
                        mutate(
                          (d) =>
                            updateShotPlan(d, s.id, {
                              dependsOn: e.target.value || undefined,
                            }),
                          true,
                        )
                      }
                    >
                      <option value="">Independent</option>
                      {shotsOfScene(d, sid)
                        .slice(0, d.scenes[sid].shotIds.indexOf(s.id))
                        .map((other) => (
                          <option key={other.id} value={other.id}>
                            {other.title}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    setShotId(s.id);
                    setPicker(null);
                    document
                      .querySelector(".generation-selection")
                      ?.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  Edit this shot’s inputs
                </Button>
              </details>
            ))}
            <label className="generation-target">
              Scene target
              <input
                type="number"
                min={3}
                max={90}
                aria-label="Scene target seconds"
                key={setup.targetSeconds}
                defaultValue={setup.targetSeconds}
                onBlur={(e) =>
                  mutate((d) => {
                    const n = Number(e.target.value);
                    if (!Number.isFinite(n) || n < 3 || n > 90)
                      throw Error("Scene target must be 3–90 seconds.");
                    d.studio.setups[sid].targetSeconds = n;
                    bumpStudio(d, pid);
                  }, true)
                }
              />
              seconds
            </label>
          </section>
          <input
            ref={upload}
            type="file"
            hidden
            aria-label="Upload generation reference"
            accept={
              uploadFor.current === "setting"
                ? "image/png,image/jpeg,image/webp"
                : "image/png,image/jpeg,image/webp,video/mp4,video/webm,audio/mpeg,audio/wav,audio/ogg"
            }
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const kind = f.type.startsWith("image/")
                ? "image"
                : f.type.startsWith("video/")
                  ? "video"
                  : f.type.startsWith("audio/")
                    ? "audio"
                    : undefined;
              if (
                !kind ||
                f.size > CONFIG.maxUploadBytes ||
                (uploadFor.current === "setting" && kind !== "image")
              ) {
                setError(
                  "Choose a supported image, video, or audio file under 20 MB. Settings require an image.",
                );
                e.target.value = "";
                return;
              }
              const url = URL.createObjectURL(f);
              mutate((d) => {
                const aid = uid("asset");
                d.assets[aid] = {
                  id: aid,
                  projectId: pid,
                  title: f.name,
                  kind,
                  url,
                  sessionOnly: true,
                  provenance: "User reference upload · session only.",
                };
                if (uploadFor.current === "setting") {
                  const lid = createLocation(d, pid, f.name, aid);
                  saveGenerationInputs(
                    d,
                    sid,
                    { locationId: lid, locationMode: "selected" },
                    shotId,
                  );
                } else {
                  if (inputs.referenceInputs.length >= 12)
                    throw Error("Use up to 12 additional references.");
                  saveGenerationInputs(
                    d,
                    sid,
                    {
                      referenceInputs: [
                        ...inputs.referenceInputs,
                        {
                          assetId: aid,
                          purpose:
                            kind === "audio"
                              ? "audio"
                              : kind === "video"
                                ? "camera_movement"
                                : "visual_style",
                        },
                      ],
                    },
                    shotId,
                  );
                }
              }, true);
              setPicker(null);
              e.target.value = "";
            }}
          />
        </main>
        <aside
          className="generation-preflight"
          ref={summary}
          style={
            embedded && summaryHeight ? { maxHeight: summaryHeight } : undefined
          }
          aria-label="Generation preflight"
        >
          <div
            id="generation-mobile-review"
            className={`generation-preflight-scroll ${showPreflight ? "is-expanded" : ""}`}
          >
            <div className="generation-preflight-heading">
              <Sparkles size={16} />
              <h2>Preflight</h2>
              <span
                className={`status ${currentPlan.ready ? "green" : "amber"}`}
              >
                {currentPlan.ready ? "Ready" : "Needs attention"}
              </span>
            </div>
            {videoMode && (
              <section className="video-generation-method">
                <h3>Video generation</h3>
                <p>
                  Generate directly from the scene descriptions and selected
                  references. Starting images are optional.
                </p>
                <span className="status">
                  {
                    shots.filter(
                      (s) =>
                        generationInputs(d, sid, s.id).startingFrameAssetId,
                    ).length
                  }{" "}
                  shots with frame conditioning
                </span>
              </section>
            )}
            {videoMode &&
              currentPlan.issues.some(
                (i) => i.group === "Plan" && i.level === "blocker",
              ) && (
                <section className="video-plan-approval">
                  <h3>Review the source</h3>
                  <p>{sc.description}</p>
                  <Button
                    onClick={() =>
                      mutate((data) => {
                        const episode = data.episodes[sc.episodeId];
                        if (!scriptApproved(episode))
                          throw Error(
                            "Refresh scene plans from the current script first.",
                          );
                        approveScenePlan(data, sid);
                      }, true)
                    }
                  >
                    Approve this scene plan
                  </Button>
                </section>
              )}
            <section>
              <span className="eyebrow">READY TO ROLL?</span>
              {(
                ["Plan", "Cast", "References", "Location", "Shot plan"] as const
              ).map((group) => {
                const issues = currentPlan.issues.filter(
                  (i) => i.level === "blocker" && i.group === group,
                );
                return (
                  <div className="generation-readiness-group" key={group}>
                    <button
                      className="generation-readiness-row"
                      onClick={() => focusGroup(group)}
                    >
                      {issues.length ? (
                        <AlertCircle className="amber-text" size={14} />
                      ) : (
                        <Check className="green-text" size={14} />
                      )}
                      <span>{group === "Location" ? "Setting" : group}</span>
                      <small>{issues.length ? "Action needed" : "Ready"}</small>
                    </button>
                    {issues.map((issue) => (
                      <div className="generation-issue" key={issue.id}>
                        <p>{issue.message}</p>
                        {issue.href.includes("/characters/") ||
                        issue.group === "Plan" ? (
                          <Link to={issue.href} onClick={close}>
                            {issue.action}
                            <ChevronRight size={11} />
                          </Link>
                        ) : (
                          <button onClick={() => focusGroup(group)}>
                            {issue.action}
                            <ChevronRight size={11} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
              {currentPlan.issues.some((i) => i.level === "warning") && (
                <details className="generation-suggestions">
                  <summary>
                    {
                      currentPlan.issues.filter((i) => i.level === "warning")
                        .length
                    }{" "}
                    suggestions · optional
                  </summary>
                  {currentPlan.issues
                    .filter((i) => i.level === "warning")
                    .map((i) => (
                      <p key={i.id}>{i.message}</p>
                    ))}
                </details>
              )}
            </section>
            <section>
              <span className="eyebrow">
                SELECTED INPUTS {shotId ? " / THIS SHOT" : ""}
              </span>
              <div className="generation-input-summary">
                {cast.map((a) => (
                  <div key={a.characterId}>
                    <Users size={13} />
                    <span>
                      {d.characters[a.characterId]?.name ?? "Missing character"}
                      <small>
                        {a.lookId
                          ? d.studio.looks[a.lookId]?.name
                          : "Canonical identity"}{" "}
                        ·{" "}
                        {a.referenceIds?.length
                          ? `${a.referenceIds.length} selected views`
                          : "approved views"}
                      </small>
                    </span>
                  </div>
                ))}
                {!cast.length && (
                  <div>
                    <Users size={13} />
                    <span>No cast · environment only</span>
                  </div>
                )}
                <div>
                  <MapPin size={13} />
                  <span>{location?.name ?? "Setting from instructions"}</span>
                </div>
                <div>
                  <ImageIcon size={13} />
                  <span>
                    {inputs.referenceInputs.length} additional references
                  </span>
                </div>
              </div>
            </section>
            <section className="generation-output">
              <span className="eyebrow">
                OUTPUT SETTINGS {shotId ? " / THIS SHOT" : ""}
              </span>
              <label>
                Model
                <select
                  aria-label="Generation model"
                  value={inputs.model}
                  onChange={() => {}}
                >
                  <option value="demo">dotori studio multimodal demo</option>
                </select>
              </label>
              <p className="generation-caption">
                Simulated inputs and outputs. No external model is connected.
              </p>
              <div className="generation-output-grid">
                <label>
                  Aspect ratio
                  <select
                    aria-label="Generation aspect ratio"
                    value={inputs.aspectRatio}
                    onChange={(e) =>
                      save({
                        aspectRatio: e.target
                          .value as typeof inputs.aspectRatio,
                      })
                    }
                  >
                    <option>9:16</option>
                    <option>16:9</option>
                    <option>1:1</option>
                  </select>
                </label>
                <label>
                  Variations
                  <select aria-label="Generation variations" disabled value="1">
                    <option value="1">1 per shot</option>
                  </select>
                </label>
              </div>
              <div className="generation-fact">
                <span>Selected duration</span>
                <b>
                  {totalTargets}s · {ids.length} shots
                </b>
              </div>
            </section>
            <section>
              <span className="eyebrow">EXECUTION & COST</span>
              <div className="generation-fact">
                <span>Image jobs</span>
                <b>
                  {work.filter((w) => w.operation === "image").length} ×{" "}
                  {CONFIG.imageCost} cr
                </b>
              </div>
              <div className="generation-fact">
                <span>Video jobs</span>
                <b>
                  {work.filter((w) => w.operation === "video").length} ×{" "}
                  {CONFIG.videoCost} cr
                </b>
              </div>
              {work.some((w) => w.blocked) && (
                <p className="generation-caption">
                  Continuation jobs wait for source take approval.
                </p>
              )}
              <p className="generation-caption">
                {videoMode
                  ? "Approved takes are reused. Generate video directly; frame images are optional."
                  : "Approved takes are reused. Images need approval before the video step."}
              </p>
              {excluded.length > 0 && sceneIds.length > 1 && (
                <div className="generation-issue">
                  <p>
                    {excluded.length} scene(s) excluded until requirements are
                    resolved.
                  </p>
                  {excluded.map((p) => (
                    <button key={p.id} onClick={() => switchScene(p.id)}>
                      {d.scenes[p.id].title}
                      <ChevronRight size={11} />
                    </button>
                  ))}
                </div>
              )}
              <label className="generation-replace-option">
                <input
                  type="checkbox"
                  checked={regenerate}
                  onChange={(e) => setRegenerate(e.target.checked)}
                />
                Regenerate approved takes
              </label>
              {currentPlan.issues
                .filter((i) => i.group === "Budget")
                .map((i) => (
                  <p className="generation-issue" key={i.id}>
                    {i.message}
                  </p>
                ))}
              {!work.length && (
                <p className="generation-issue">
                  No eligible work. Resolve requirements, review pending
                  candidates, or regenerate approved takes.
                </p>
              )}
            </section>
          </div>
          <footer className="generation-submit">
            <button
              className="generation-mobile-review"
              aria-expanded={showPreflight}
              aria-controls="generation-mobile-review"
              onClick={() => {
                setShowPreflight(!showPreflight);
                if (!showPreflight)
                  requestAnimationFrame(() =>
                    document
                      .getElementById("generation-mobile-review")
                      ?.scrollIntoView({ block: "start", behavior: "smooth" }),
                  );
              }}
            >
              <span>
                Preflight · {currentPlan.ready ? "Ready" : "Needs attention"}
              </span>
              <span>
                {showPreflight ? "Hide" : "Review"} <ChevronRight size={12} />
              </span>
            </button>
            <div>
              <span>Estimated total</span>
              <strong>
                {cost}
                <small> demo credits</small>
              </strong>
            </div>
            <p>{d.credits} credits available · charged on confirmation</p>
            {cost > d.credits && (
              <p role="alert" className="error">
                Not enough demo credits for this selection.
              </p>
            )}
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <Button
              variant="default"
              disabled={!work.length || cost > d.credits}
              onClick={() => {
                if (
                  mutate((d) => {
                    if (proposalId) {
                      const p = d.proposals[proposalId];
                      if (
                        !p ||
                        p.state !== "proposed" ||
                        d.projects[p.scope.projectId]?.revision !==
                          p.scope.revision
                      )
                        throw Error(
                          "Proposal context changed. Request a new proposal.",
                        );
                      p.state = "applied";
                    }
                    enqueueGeneration(d, eligibleIds, regenerate);
                  })
                ) {
                  onGenerated?.();
                  close();
                } else setError(useStore.getState().notice);
              }}
            >
              <Sparkles size={15} />
              {videoMode
                ? `Generate video · ${work.length} ${work.length === 1 ? "shot" : "shots"} · ${cost} cr`
                : `Generate ${work.length} ${work.length === 1 ? "shot" : "shots"} · ${cost} cr`}
            </Button>
            <span className="generation-submit-note">
              {regenerate
                ? "Current takes stay until you approve replacements."
                : "Review every result before using it in your film."}
            </span>
          </footer>
        </aside>
      </div>
    </div>
  );
}
function LibraryHeader({
  title,
  query,
  setQuery,
  close,
}: {
  title: string;
  query: string;
  setQuery: (v: string) => void;
  close: () => void;
}) {
  return (
    <div className="generation-library-header">
      <div>
        <ArrowLeft size={14} />
        <h4>{title}</h4>
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Close reference library"
        onClick={close}
      >
        <X size={14} />
      </Button>
      <input
        aria-label={`Search ${title.toLowerCase()}`}
        placeholder="Search library…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
    </div>
  );
}
