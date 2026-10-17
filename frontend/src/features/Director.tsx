import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  MessageSquare,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { useDirectorRequest } from "../stores/director";
import { useStore } from "../stores/store";
import { Button } from "../components/ui/button";
import { useActions } from "../components/Actions";
import { applyEditProposal, proposal } from "../domain/commands";
import { duration, shotsOfScene, timecode } from "../domain/selectors";
import { uid, type Scope } from "../domain/types";
import { directorService } from "../services/mock";
export function Director({
  projectId,
  episodeId,
  sceneId,
  characterId,
  lookId,
  characterTab,
  setup,
  onGenerate,
}: {
  projectId: string;
  episodeId?: string;
  sceneId?: string;
  characterId?: string;
  lookId?: string;
  characterTab?: "identity" | "looks" | "references";
  setup?: boolean;
  onGenerate?: (
    ids: string[],
    replacement: boolean,
    proposalId: string,
  ) => void;
}) {
  const d = useStore((s) => s.data),
    ui = useStore((s) => s.ui),
    mutate = useStore((s) => s.mutate),
    setUI = useStore((s) => s.setUI);
  const modal = useActions();
  const [input, setInput] = useState("");
  const requestedPrompt = useDirectorRequest((s) => s.prompt);
  const composer = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (requestedPrompt === null) return;
    setInput(requestedPrompt);
    useDirectorRequest.setState({ prompt: null });
    composer.current?.focus({ preventScroll: true });
  }, [requestedPrompt]);
  const [busy, setBusy] = useState(false);
  const [wide, setWide] = useState(false);
  const [range, setRange] = useState(true);
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const threadId = characterId ?? episodeId ?? projectId;
  const thread = d.threads[threadId];
  const selectedId =
    sceneId && !setup
      ? (ui.selectedShots[sceneId] ?? d.scenes[sceneId]?.shotIds[0])
      : undefined;
  const selected = selectedId ? d.shots[selectedId] : undefined;
  const sceneShots = sceneId ? shotsOfScene(d, sceneId) : [];
  const rangeStart =
    duration(
      sceneShots.slice(
        0,
        sceneShots.findIndex((s) => s.id === selectedId),
      ),
    ) * 30;
  const scope: Scope = {
    projectId,
    characterId,
    lookId,
    characterTab,
    setup,
    episodeId,
    sceneId: wide ? undefined : sceneId,
    shotId: wide ? undefined : selectedId,
    revision: d.projects[projectId]?.revision ?? 0,
    fps: 30,
    range:
      !wide && range && selected
        ? [rangeStart, rangeStart + selected.outFrame - selected.inFrame]
        : undefined,
  };
  useEffect(() => {
    setWide(false);
    setRange(true);
  }, [sceneId, selectedId]);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [thread?.messages.length]);
  async function send() {
    if (!input.trim() || busy) return;
    const text = input.trim();
    const snapshot = structuredClone(scope);
    const tid = threadId;
    setInput("");
    setBusy(true);
    const controller = new AbortController();
    abort.current = controller;
    mutate((d) => {
      d.threads[tid] ??= { id: tid, messages: [] };
      d.threads[tid].messages.push({ id: uid("message"), role: "user", text });
    });
    try {
      await directorService.respond(snapshot, text, controller.signal);
      if (controller.signal.aborted) return;
      mutate((d) => {
        const pid = proposal(d, snapshot, text);
        d.threads[tid].messages.push({
          id: uid("message"),
          role: "assistant",
          text: pid
            ? "Here’s a plan for the selected context. Your current takes stay on the timeline until you choose a replacement."
            : "This demo supports developing an episode, adding suspense, shortening a selected shot by one second, generating ready scenes, and regenerating a shot. Character Studio also supports identity descriptions, summer outfits, and black jacket revisions. Scene setup supports darker direction and adding Leo.",
          proposalId: pid,
        });
      });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError"))
        useStore
          .getState()
          .setNotice("The demo response could not complete. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <aside className="director">
      <header>
        <span className="director-icon">
          <Sparkles size={17} />
        </span>
        <h2>AI Director</h2>
        <span className="badge">DEMO</span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close AI Director"
          onClick={() => setUI({ aiOpen: false })}
        >
          <X size={16} />
        </Button>
      </header>
      <div className="director-thread-label">
        <MessageSquare size={13} />
        {characterId
          ? `${d.characters[characterId]?.name} / ${characterTab ?? "identity"}${lookId ? " / " + d.studio.looks[lookId]?.name : ""}`
          : episodeId
            ? "Episode conversation"
            : "Project conversation"}
        <ChevronDown size={13} />
      </div>
      <div className="conversation">
        {!thread?.messages.length && (
          <div className="director-welcome">
            <span className="director-icon">
              <Sparkles size={22} />
            </span>
            <h3>
              Every good story
              <br />
              starts with a conversation.
            </h3>
            <p>
              I can help you develop an episode, shape a scene, or explore a new
              take.
            </p>
            <p className="muted">
              Deterministic demo · no AI service connected
            </p>
          </div>
        )}
        {thread?.messages.map((message) => (
          <div key={message.id} className={`message ${message.role}`}>
            <div className="message-label">
              {message.role === "assistant" ? (
                <>
                  <Sparkles size={13} />
                  dotori studio
                </>
              ) : (
                "You"
              )}
            </div>
            <p>{message.text}</p>
            {message.proposalId &&
              (() => {
                const p = d.proposals[message.proposalId];
                if (!p) return null;
                const content = (
                  <>
                    <div className="proposal-scope">
                      {p.change
                        ? p.change.kind.replaceAll("_", " ")
                        : `${p.shotIds.length} shots`}{" "}
                      · original context · revision {p.scope.revision}
                    </div>
                    <h4>
                      {p.intent === "replace"
                        ? "Explore a new take"
                        : p.intent === "trim"
                          ? "Tighten the edit"
                          : "A direction for your story"}
                    </h4>
                    <details>
                      <summary>Before / after instructions</summary>
                      <p className="muted">Before: {p.before}</p>
                      <p>After: {p.after}</p>
                    </details>
                    <p>{p.after}</p>
                    <small>
                      <Check size={12} /> Preserve character & continuity
                    </small>
                    {p.shotIds.some((id) => d.shots[id]?.dependsOn) && (
                      <p className="amber-text">
                        Continuation source must be approved. A changed source
                        flags dependents for review.
                      </p>
                    )}
                    <div className="proposal-footer">
                      <span>
                        {p.cost ? p.cost + " demo credits" : "No credit cost"}
                      </span>
                      {p.state === "proposed" ? (
                        <div className="row-actions">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              mutate((d) => {
                                d.proposals[p.id].state = "canceled";
                              })
                            }
                          >
                            Cancel
                          </Button>
                          {p.change && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={
                                p.scope.characterId !== scope.characterId ||
                                p.scope.sceneId !== scope.sceneId ||
                                p.scope.lookId !== scope.lookId
                              }
                              onClick={() => setInput(p.after)}
                            >
                              Revise
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() => {
                              if (
                                p.intent === "generate" ||
                                p.intent === "replace"
                              ) {
                                if (onGenerate) {
                                  onGenerate(
                                    p.shotIds,
                                    p.intent === "replace",
                                    p.id,
                                  );
                                  return;
                                }
                                modal({
                                  kind: "generate",
                                  ids: p.shotIds,
                                  replacement: p.intent === "replace",
                                  proposalId: p.id,
                                });
                              } else
                                mutate((d) => applyEditProposal(d, p.id), true);
                            }}
                          >
                            {p.intent === "replace"
                              ? "Generate replacement"
                              : p.intent === "generate"
                                ? "Review preflight"
                                : "Apply plan"}
                          </Button>
                        </div>
                      ) : (
                        <span className="status green">{p.state}</span>
                      )}
                    </div>
                  </>
                );
                return p.state === "proposed" ? (
                  <div className="proposal">{content}</div>
                ) : (
                  <details className="proposal previous">
                    <summary>Previous proposal · {p.state}</summary>
                    {content}
                  </details>
                );
              })()}
          </div>
        ))}
        {busy && (
          <p className="muted" role="status">
            Preparing demo response…
          </p>
        )}
        <div ref={bottom} />
      </div>
      <div className="director-bottom">
        {!thread?.messages.some((m) => m.role === "user") && (
          <div className="suggestions">
            {(characterId
              ? [
                  "She is a Korean woman in her late twenties with shoulder-length black hair.",
                  "Create a summer outfit for this character.",
                  ...(lookId ? ["Give her a black jacket."] : []),
                ]
              : setup
                ? [
                    "Make this scene darker and more suspenseful.",
                    "Add Leo to this scene.",
                  ]
                : [
                    "Help me develop this episode.",
                    "Make this scene more suspenseful.",
                    "Generate the scenes that are ready.",
                  ]
            ).map((t) => (
              <button key={t} onClick={() => setInput(t)}>
                {t}
                <ArrowUp size={12} />
              </button>
            ))}
          </div>
        )}
        <div className="context-line">
          <span className="context-dot" />
          <span>
            {characterId
              ? `${d.characters[characterId]?.name} / ${characterTab ?? "identity"}`
              : episodeId
                ? `Episode ${d.projects[projectId]?.episodeIds.indexOf(episodeId) + 1}`
                : "Project"}
            {!wide && sceneId
              ? ` / Scene ${(d.episodes[episodeId ?? ""]?.sceneIds.indexOf(sceneId) ?? 0) + 1}`
              : ""}
            {!wide && selected
              ? ` / Shot ${(d.scenes[sceneId ?? ""]?.shotIds.indexOf(selected.id) ?? 0) + 1}`
              : ""}
          </span>
          {sceneId && !setup && (
            <button onClick={() => setWide(!wide)}>
              {wide ? "Use shot" : "Widen scope"}
            </button>
          )}
        </div>
        {scope.range && (
          <div className="context-range">
            Selected range · scene time: {timecode(scope.range[0] / 30)}–
            {timecode(scope.range[1] / 30)}{" "}
            <button aria-label="Remove range" onClick={() => setRange(false)}>
              <X size={11} />
            </button>
          </div>
        )}
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            ref={composer}
            aria-label="Message AI Director"
            placeholder="Describe the next version…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div>
            <span>Local demo · no real AI</span>
            {busy ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Stop response"
                onClick={() => abort.current?.abort()}
              >
                <Square size={13} />
              </Button>
            ) : (
              <Button
                variant="default"
                size="icon"
                aria-label="Send message"
                disabled={!input.trim()}
              >
                <ArrowUp size={17} />
              </Button>
            )}
          </div>
        </form>
        <p className="composer-note">
          You direct. dotori studio helps with the next step.
        </p>
      </div>
    </aside>
  );
}
