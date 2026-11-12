import { LoaderCircle, X } from "lucide-react";
import {
  interpretationPending,
  type InterpretationRequest,
} from "../domain/interpretation";
import { interpretationWorkflow } from "../services/interpretation";

/** A transient chat reply; the Home canvas and composer keep their original UI. */
export function HomeInterpretationReply({
  request,
  onClose,
}: {
  request: InterpretationRequest;
  onClose: () => void;
}) {
  const output = request.interpretation;
  const busy = interpretationPending(request);
  const decision = output && "action" in output ? output : undefined;
  const brief =
    output && "creativeBrief" in output ? output.creativeBrief : undefined;
  return (
    <section className="st-home-chat-reply" aria-label="Chat reply">
      <header>
        <b>
          {request.phase === "succeeded"
            ? "Your interpretation"
            : "Your request"}
        </b>
        <span
          role="status"
          aria-label="Interpretation status"
          aria-live="polite"
        >
          {busy && <LoaderCircle size={13} className="st-home-chat-spinner" />}
          {request.phase === "creating" || request.phase === "submitting"
            ? "Sending…"
            : request.phase === "polling"
              ? request.observationRetryAt
                ? "Reconnecting…"
                : request.jobStatus === "running"
                  ? "Interpreting…"
                  : "Queued…"
              : request.phase === "failed"
                ? "Needs attention"
                : request.phase === "paused"
                  ? "Paused"
                  : "Ready"}
        </span>
        <button className="st-icon" aria-label="Close reply" onClick={onClose}>
          <X size={14} />
        </button>
      </header>
      <div className="st-home-chat-reply-body st-panel-scroll">
        <p className="st-home-chat-prompt">{request.prompt}</p>
        {request.error && (
          <p className="st-home-chat-error" role="alert">
            {request.error}
          </p>
        )}
        {request.phase === "polling" && request.observationRetryAt && (
          <div>
            <p>
              Connection interrupted. Status checks will retry automatically.
            </p>
            <button
              className="st-button"
              onClick={() => void interpretationWorkflow.retry()}
            >
              Check now
            </button>
          </div>
        )}
        {request.phase === "failed" && (
          <button
            className="st-button"
            onClick={() => void interpretationWorkflow.retry()}
          >
            {request.jobStatus === "failed" ||
            (!request.projectId && !!request.sourceProjectId)
              ? "Try again"
              : request.jobId
                ? "Retry status check"
                : "Retry submission"}
          </button>
        )}
        {request.phase === "polling" && (
          <button
            className="st-text-button"
            onClick={() => interpretationWorkflow.stopChecking()}
          >
            Pause reply checks
          </button>
        )}
        {request.phase === "paused" && (
          <>
            <p>Reply checks are paused. Activity continues tracking the job.</p>
            <button
              className="st-button"
              onClick={() => void interpretationWorkflow.retry()}
            >
              Resume checking
            </button>
          </>
        )}
        {decision?.action === "propose_operation" && (
          <div>
            <h3>Proposed action</h3>
            <p>
              {decision.operation === "generate_video"
                ? "Generate video"
                : decision.operation}
            </p>
            <dl>
              {Object.entries(decision.input).map(([name, value]) => (
                <div key={name}>
                  <dt>
                    {(
                      {
                        prompt: "Prompt",
                        durationSeconds: "Duration (seconds)",
                        resolution: "Resolution",
                      } as Record<string, string>
                    )[name] ?? name}
                  </dt>
                  <dd>
                    {typeof value === "string" ? value : JSON.stringify(value)}
                  </dd>
                </div>
              ))}
            </dl>
            <small>Proposal only. Nothing has been generated.</small>
          </div>
        )}
        {brief && (
          <div>
            <h3>Creative brief</h3>
            <p>{brief.premise}</p>
            <dl>
              <dt>Characters</dt>
              <dd>
                {brief.characters.length
                  ? brief.characters.join(", ")
                  : "Not specified"}
              </dd>
              <dt>Setting</dt>
              <dd>{brief.setting || "Not specified"}</dd>
              <dt>Style</dt>
              <dd>{brief.style || "Not specified"}</dd>
            </dl>
          </div>
        )}
        {!!output?.assumptions.length && (
          <div>
            <h3>Assumptions</h3>
            <ul>
              {output.assumptions.map((text, i) => (
                <li key={i}>{text}</li>
              ))}
            </ul>
          </div>
        )}
        {!!output?.questions.length && (
          <div>
            <h3>Questions</h3>
            <ul>
              {output.questions.map((text, i) => (
                <li key={i}>{text}</li>
              ))}
            </ul>
          </div>
        )}
        {request.phase === "succeeded" && (
          <small>
            {decision?.action === "clarification_needed"
              ? "More detail is needed before choosing an action."
              : decision
                ? "Interpretation complete."
                : "Saved brief."}
          </small>
        )}
      </div>
    </section>
  );
}
