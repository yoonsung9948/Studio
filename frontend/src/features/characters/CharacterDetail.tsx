import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  Check,
  ChevronLeft,
  MoreHorizontal,
  Plus,
  Sparkles,
  ArrowUpRight,
  Expand,
} from "lucide-react";
import { useStore } from "../../stores/store";
import { Button } from "../../components/ui/button";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "../../components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../../components/ui/dropdown-menu";
import { useActions } from "../../components/Actions";
import { NotFound } from "../Gallery";
import {
  createLook,
  updateCharacter,
  updateLook,
  deleteLook,
  deleteCharacter,
  addLookAngle,
  affectedShots,
} from "../../domain/studio-commands";
import {
  characterLooks,
  characterReferences,
  characterReady,
  characterStatus,
  lookReady,
  referenceLabels,
  referenceStatus,
  referenceValid,
  targetBusy,
  versionAsset,
  validVersion,
} from "../../domain/studio-selectors";
import { MediaVersions, Portrait } from "./MediaVersions";
export function CharacterDetail() {
  const { projectId = "", characterId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const d = useStore((s) => s.data),
    mutate = useStore((s) => s.mutate),
    setUI = useStore((s) => s.setUI);
  const modal = useActions();
  const c = d.characters[characterId];
  const tab = ["identity", "looks", "references"].includes(
    params.get("tab") ?? "",
  )
    ? params.get("tab")!
    : "identity";
  const lookId = params.get("look") ?? undefined;
  const look = lookId ? d.studio.looks[lookId] : undefined;
  if (
    !c ||
    c.projectId !== projectId ||
    (lookId && (!look || look.characterId !== characterId))
  )
    return <NotFound />;
  const refs = characterReferences(d, c.id),
    looks = characterLooks(d, c.id),
    portrait = versionAsset(d, c.canonicalVersionId);
  const setTab = (value: string, lid?: string) => {
    const next = new URLSearchParams(params);
    next.set("tab", value);
    if (lid) next.set("look", lid);
    else next.delete("look");
    setParams(next);
  };
  const create = () => {
    let id = "";
    if (
      mutate((d) => {
        id = createLook(d, c.id);
      })
    ) {
      setTab("looks", id);
      setUI({ aiOpen: true });
    }
  };
  const returnTo = params.get("returnTo");
  const safeReturn = returnTo?.startsWith(`/projects/${projectId}/episodes/`)
    ? returnTo
    : undefined;
  const affected = [
    ...new Set(
      affectedShots(d, c.id, look?.id).map((id) => d.shots[id].sceneId),
    ),
  ];
  const missing = refs.filter(
    (r) =>
      !referenceValid(d, r.id) &&
      referenceStatus(d, r.id) !== "Needs review" &&
      !targetBusy(d, "reference", r.id),
  );
  return (
    <div className="character-workspace">
      <header className="character-header">
        <div className="eyebrow">
          <Link to={`/projects/${projectId}/characters`}>CHARACTERS</Link> /{" "}
          {c.role || "NEW CHARACTER"}
        </div>
        <div className="page-heading">
          <div>
            <h1>{c.name}</h1>
            <p>
              <span
                className={`status ${characterReady(d, c.id) ? "green" : "amber"}`}
              >
                {characterStatus(d, c.id)}
              </span>{" "}
              · {refs.filter((r) => referenceValid(d, r.id)).length} of 5
              recommended references approved
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="Character actions"
                size="icon"
                variant="ghost"
              >
                <MoreHorizontal size={18} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                onSelect={() =>
                  modal({
                    kind: "form",
                    title: "Rename character",
                    fields: [{ key: "name", label: "Name", value: c.name }],
                    submit: (v, d) => updateCharacter(d, c.id, v),
                  })
                }
              >
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  modal({
                    kind: "confirm",
                    title: "Delete character?",
                    description:
                      "Approved footage and version history are preserved. Cast assignments will be removed.",
                    danger: true,
                    action: (d) => {
                      deleteCharacter(d, c.id);
                      navigate(`/projects/${projectId}/characters`);
                    },
                  })
                }
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {safeReturn && (
          <Link className="return-to-setup" to={safeReturn}>
            <ChevronLeft size={13} />
            Return to scene setup
          </Link>
        )}
      </header>
      <Tabs value={tab} onValueChange={(v) => setTab(v)}>
        <TabsList className="tabs-list character-tabs">
          <TabsTrigger value="identity">Identity</TabsTrigger>
          <TabsTrigger value="looks">
            Looks <span>{looks.length}</span>
          </TabsTrigger>
          <TabsTrigger value="references">
            References <span>{refs.length}</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="identity" className="character-tab-content">
          <div className="identity-layout">
            <div>
              <Portrait
                src={portrait?.url}
                label="Let’s establish this character’s appearance."
              />
              {portrait && (
                <p className="identity-caption">
                  <Check size={13} />
                  Canonical identity · approved
                </p>
              )}
            </div>
            <div className="identity-copy">
              <span className="eyebrow">THE PERSON BEHIND THE STORY</span>
              <h2>
                {portrait
                  ? "A familiar face, in every scene."
                  : "Let’s establish their appearance."}
              </h2>
              <p>
                Describe your character to AI Director or enter the details
                manually.
              </p>
              <div className="identity-fields">
                {[
                  ["name", "Character name"],
                  ["role", "Role"],
                  ["appearance", "Physical appearance"],
                  ["personality", "Personality"],
                  ["notes", "Additional notes"],
                ].map(([key, label]) => (
                  <label key={`${c.id}-${key}`}>
                    {label}
                    {["appearance", "personality", "notes"].includes(key) ? (
                      <textarea
                        key={String(c[key as keyof typeof c])}
                        defaultValue={String(c[key as keyof typeof c] ?? "")}
                        placeholder={
                          key === "appearance"
                            ? "Age, face, hair, defining features…"
                            : "Optional"
                        }
                        onBlur={(e) => {
                          if (
                            e.target.value !==
                            String(c[key as keyof typeof c] ?? "")
                          )
                            mutate(
                              (d) =>
                                updateCharacter(d, c.id, {
                                  [key]: e.target.value,
                                }),
                              true,
                            );
                        }}
                      />
                    ) : (
                      <input
                        key={String(c[key as keyof typeof c])}
                        defaultValue={String(c[key as keyof typeof c] ?? "")}
                        onBlur={(e) => {
                          if (
                            e.target.value !==
                            String(c[key as keyof typeof c] ?? "")
                          )
                            mutate(
                              (d) =>
                                updateCharacter(d, c.id, {
                                  [key]: e.target.value,
                                }),
                              true,
                            );
                        }}
                      />
                    )}
                  </label>
                ))}
              </div>
              <Button
                variant="default"
                disabled={
                  !c.appearance?.trim() || targetBusy(d, "identity", c.id)
                }
                onClick={() =>
                  modal({
                    kind: "studioGenerate",
                    operation: "identity",
                    ids: [c.id],
                  })
                }
              >
                <Sparkles size={14} />
                {portrait ? "Generate new identity" : "Generate Identity"}
              </Button>
              {!c.appearance?.trim() && (
                <small className="field-help">
                  Add a physical description to enable generation.
                </small>
              )}
            </div>
          </div>
          <MediaVersions
            kind="identity"
            id={c.id}
            currentId={c.canonicalVersionId}
          />
          {portrait && (
            <section className="studio-next-step">
              <div>
                <h3>Build a reference pack</h3>
                <p>
                  Your approved identity already covers the front portrait. Add
                  other views as your story needs them.
                </p>
              </div>
              <Button
                onClick={() =>
                  modal({
                    kind: "studioGenerate",
                    operation: "reference",
                    ids: missing.map((r) => r.id),
                  })
                }
                disabled={!missing.length}
              >
                <Sparkles size={14} />
                Generate Reference Pack
              </Button>
            </section>
          )}
        </TabsContent>
        <TabsContent value="looks" className="character-tab-content">
          {look ? (
            <>
              <div className="section-heading">
                <Button variant="ghost" onClick={() => setTab("looks")}>
                  <ChevronLeft size={14} />
                  All Looks
                </Button>
                <span
                  className={`status ${lookReady(d, look.id) ? "green" : "amber"}`}
                >
                  {lookReady(d, look.id)
                    ? "Approved for scenes"
                    : "Needs approval"}
                </span>
              </div>
              <div className="identity-layout">
                <div>
                  <Portrait
                    src={versionAsset(d, look.primaryVersionId)?.url}
                    label="A new appearance, the same person."
                  />
                  <div className="identity-anchor">
                    <img
                      src={portrait?.url || "/media/studio-front.svg"}
                      alt="Canonical identity anchor"
                    />
                    <span>
                      Inherits {c.name}’s identity
                      <small>
                        {portrait
                          ? "Approved face and identity"
                          : "Approve the identity first"}
                      </small>
                    </span>
                  </div>
                </div>
                <div className="identity-copy">
                  <span className="eyebrow">REUSABLE APPEARANCE</span>
                  <h2>{look.name}</h2>
                  <div className="identity-fields">
                    {[
                      ["name", "Look name"],
                      ["description", "Outfit description"],
                      ["styling", "Hair & styling"],
                      ["notes", "Notes"],
                    ].map(([key, label]) => (
                      <label key={key}>
                        {label}
                        <textarea
                          key={String(look[key as keyof typeof look])}
                          defaultValue={String(
                            look[key as keyof typeof look] ?? "",
                          )}
                          onBlur={(e) => {
                            if (
                              e.target.value !==
                              String(look[key as keyof typeof look] ?? "")
                            )
                              mutate(
                                (d) =>
                                  updateLook(d, look.id, {
                                    [key]: e.target.value,
                                  }),
                                true,
                              );
                          }}
                        />
                      </label>
                    ))}
                  </div>
                  <div className="row-actions">
                    <Button
                      variant="default"
                      disabled={
                        !validVersion(d, c.canonicalVersionId) ||
                        !look.description.trim() ||
                        targetBusy(d, "look", look.id)
                      }
                      onClick={() =>
                        modal({
                          kind: "studioGenerate",
                          operation: "look",
                          ids: [look.id],
                        })
                      }
                    >
                      <Sparkles size={14} />
                      {look.primaryVersionId
                        ? "Regenerate Look"
                        : "Generate Look"}
                    </Button>
                    <Button
                      disabled={!validVersion(d, c.canonicalVersionId)}
                      onClick={() =>
                        modal({
                          kind: "studioGenerate",
                          operation: "look",
                          ids: [look.id],
                        })
                      }
                    >
                      Generate Variations
                    </Button>
                  </div>
                  {!portrait && (
                    <Link className="field-help" to={`?tab=identity`}>
                      Approve the identity first →
                    </Link>
                  )}
                  <Button
                    variant="ghost"
                    onClick={() =>
                      modal({
                        kind: "confirm",
                        title: "Delete this Look?",
                        description:
                          "Shots return to the canonical identity and are marked for review. Approved footage is preserved.",
                        danger: true,
                        action: (d) => {
                          deleteLook(d, look.id);
                          setTab("looks");
                        },
                      })
                    }
                  >
                    Delete Look
                  </Button>
                </div>
              </div>
              <MediaVersions
                kind="look"
                id={look.id}
                currentId={look.primaryVersionId}
              />
              <section className="studio-next-step">
                <div>
                  <h3>Additional angle</h3>
                  <p>
                    Generate one optional reference only when this Look needs
                    it.
                  </p>
                </div>
                <Button
                  disabled={!lookReady(d, look.id)}
                  onClick={() => {
                    let rid = "";
                    if (
                      mutate((d) => {
                        rid = addLookAngle(d, look.id);
                      })
                    )
                      modal({
                        kind: "studioGenerate",
                        operation: "reference",
                        ids: [rid],
                      });
                  }}
                >
                  Generate angle
                </Button>
              </section>
              {Object.values(d.studio.references)
                .filter((r) => r.lookId === look.id)
                .map((r) => (
                  <MediaVersions
                    key={r.id}
                    kind="reference"
                    id={r.id}
                    currentId={r.activeVersionId}
                  />
                ))}
            </>
          ) : (
            <>
              <div className="section-heading">
                <div>
                  <h2>One identity. Different appearances.</h2>
                  <p>Outfits and styling that stay connected to {c.name}.</p>
                </div>
                <Button variant="default" onClick={create}>
                  <Plus size={14} />
                  Create Look
                </Button>
              </div>
              <div className="look-grid">
                {looks.map((l) => (
                  <button
                    className="look-card"
                    key={l.id}
                    onClick={() => setTab("looks", l.id)}
                  >
                    <Portrait
                      src={versionAsset(d, l.primaryVersionId)?.url}
                      label={l.name}
                    />
                    <h3>{l.name}</h3>
                    <span
                      className={`status ${lookReady(d, l.id) ? "green" : "amber"}`}
                    >
                      {lookReady(d, l.id) ? "Approved" : "Draft / needs review"}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </TabsContent>
        <TabsContent value="references" className="character-tab-content">
          <div className="section-heading">
            <div>
              <h2>Keep every angle familiar.</h2>
              <p>
                One approved reference is enough to start. Other views are
                optional.
              </p>
            </div>
            <Button
              variant="default"
              disabled={!portrait || !missing.length}
              onClick={() =>
                modal({
                  kind: "studioGenerate",
                  operation: "reference",
                  ids: missing.map((r) => r.id),
                })
              }
            >
              <Sparkles size={14} />
              Generate Missing
            </Button>
          </div>
          <div className="reference-grid">
            {refs.map((r) => (
              <article className="reference-card" key={r.id}>
                <Portrait
                  src={versionAsset(d, r.activeVersionId)?.url}
                  label={referenceLabels[r.type]}
                />
                <div className="section-heading">
                  <h3>{referenceLabels[r.type]}</h3>
                  {r.activeVersionId && (
                    <Button
                      aria-label={`View ${referenceLabels[r.type]}`}
                      size="icon"
                      variant="ghost"
                      onClick={() =>
                        modal({
                          kind: "asset",
                          assetId:
                            d.studio.versions[r.activeVersionId!].assetId,
                        })
                      }
                    >
                      <Expand size={14} />
                    </Button>
                  )}
                </div>
                <span
                  className={`status ${referenceValid(d, r.id) ? "green" : "amber"}`}
                >
                  {referenceStatus(d, r.id)}
                </span>
                <Button
                  size="sm"
                  disabled={!portrait || targetBusy(d, "reference", r.id)}
                  onClick={() =>
                    modal({
                      kind: "studioGenerate",
                      operation: "reference",
                      ids: [r.id],
                    })
                  }
                >
                  {r.activeVersionId
                    ? "Regenerate selected"
                    : "Generate reference"}
                </Button>
                <MediaVersions
                  kind="reference"
                  id={r.id}
                  currentId={r.activeVersionId}
                />
              </article>
            ))}
          </div>
        </TabsContent>
      </Tabs>
      {affected.length > 0 && (
        <details className="affected-scenes">
          <summary>
            {affected.length} linked scenes · inspect affected work
          </summary>
          {affected.map((id) => (
            <Link
              key={id}
              to={`/projects/${projectId}/episodes/${d.scenes[id].episodeId}/scenes/${id}/setup`}
            >
              {d.scenes[id].title}
              <span>
                {d.scenes[id].shotIds.some((id) => d.shots[id].stale)
                  ? "Needs review"
                  : "Linked"}
                <ArrowUpRight size={13} />
              </span>
            </Link>
          ))}
        </details>
      )}
    </div>
  );
}
