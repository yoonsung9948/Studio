import { useNavigate } from "react-router-dom";
import { backendActivity } from "../services/backend-activity";
import { interpretationWorkflow } from "../services/interpretation";
import { terminalBackendJob, type ObservedJob } from "../domain/backend-jobs";
import type { InterpretationRequest } from "../domain/interpretation";

export function backendActive(record: ObservedJob) {
  return (
    !terminalBackendJob(record.job?.status) &&
    !(record.observationError && !record.retryAt)
  );
}
export function backendFailed(record: ObservedJob) {
  return (
    record.job?.status === "failed" ||
    (!!record.observationError && !record.retryAt)
  );
}
export function BackendActivityRow({ record }: { record: ObservedJob }) {
  const navigate = useNavigate();
  const failed = record.job?.status === "failed";
  const active = backendActive(record);
  const canShow =
    record.operation === "interpret_request" &&
    (!!record.request ||
      typeof (record.job?.input as { prompt?: unknown } | undefined)?.prompt ===
        "string");
  const show = () => {
    if (backendActivity.show(record.id)) {
      navigate(`/projects?job=${record.id}`);
      window.dispatchEvent(new Event("dotori-home-show-reply"));
    }
  };
  return (
    <div role="group" aria-label={`Backend job ${record.id}`}>
      <span
        className={`st-job-dot ${failed || record.observationError ? "failed" : active ? "running" : "succeeded"}`}
      />
      <span title={record.request?.prompt || record.title}>
        {record.title || record.request?.prompt || "Backend job"}
      </span>
      <span>
        {record.operation === "interpret_request"
          ? "Interpretation"
          : record.operation.replaceAll("_", " ")}
      </span>
      <span>
        {failed
          ? "Failed"
          : record.job?.status === "succeeded"
            ? "Complete"
            : record.observationError
              ? record.retryAt
                ? "Reconnecting"
                : "Needs attention"
              : record.job?.status === "running"
                ? "Running"
                : "Queued"}
        {record.job?.step ? ` · ${record.job.step}` : ""}
      </span>
      {(record.observationError || record.job?.error) && (
        <span className="st-job-error">
          {record.observationError?.message || record.job?.error?.message}
        </span>
      )}
      <small>Backend</small>
      {record.observationError && !terminalBackendJob(record.job?.status) && (
        <button
          className="st-text-button"
          onClick={() => backendActivity.retryStatus(record.id)}
        >
          {record.retryAt ? "Check now" : "Retry status check"}
        </button>
      )}
      {failed && canShow && (
        <button
          className="st-text-button"
          onClick={() => void backendActivity.retryGeneration(record.id)}
        >
          Retry
        </button>
      )}
      {active && (
        <small title="The server does not expose a cancellation endpoint yet.">
          Cancel unavailable
        </small>
      )}
      {canShow ? (
        <button className="st-text-button" onClick={show}>
          Show
        </button>
      ) : (
        <small title="This operation does not have a destination in the studio yet.">
          Show unavailable
        </small>
      )}
    </div>
  );
}
export function PendingBackendActivityRow({
  request,
}: {
  request: InterpretationRequest;
}) {
  const navigate = useNavigate();
  return (
    <div role="group" aria-label="Backend submission">
      <span
        className={`st-job-dot ${request.phase === "failed" ? "failed" : "running"}`}
      />
      <span>{request.title}</span>
      <span>Interpretation</span>
      <span>
        {request.phase === "failed"
          ? "Needs attention"
          : request.phase === "creating"
            ? "Creating project"
            : "Submitting"}
      </span>
      {request.error && <span className="st-job-error">{request.error}</span>}
      <small>Backend</small>
      {request.phase === "failed" && (
        <button
          className="st-text-button"
          onClick={() => void interpretationWorkflow.retry()}
        >
          {request.projectId ? "Retry submission" : "Try again"}
        </button>
      )}
      <button
        className="st-text-button"
        onClick={() => {
          navigate("/projects");
          window.dispatchEvent(new Event("dotori-home-show-reply"));
        }}
      >
        Show
      </button>
    </div>
  );
}
