import { useEffect, useState } from "react";
import { FloatingPromptForm } from "../FloatingPromptForm";
import { HomeInterpretationReply } from "../InterpretationHome";
import { interpretationWorkflow } from "../../services/interpretation";
import { interpretationPending } from "../../domain/interpretation";
import { useStore } from "../../stores/store";
import { CreationKindPicker, type CreationKind } from "./CreationKind";

/** Connected project creation uses the authenticated request service and its existing job observer. */
export function ProjectCreationPanel({
  projectId,
  title,
  initialKind = "scene",
}: {
  projectId: string;
  title: string;
  initialKind?: CreationKind;
}) {
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState<CreationKind>(initialKind);
  const [error, setError] = useState("");
  const [replyOpen, setReplyOpen] = useState(true);
  const request = useStore((state) => state.data.backend?.request);
  const busy = interpretationPending(request);
  useEffect(() => interpretationWorkflow.observePage(), []);
  const submit = async () => {
    if (!prompt.trim() || busy) return;
    setError("");
    setReplyOpen(true);
    try {
      await interpretationWorkflow.start({
        prompt,
        projectId,
        title,
        creationKind: kind,
      });
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not start this request. Please try again.",
      );
    }
  };
  return (
    <section
      className="dd-project-creation"
      aria-label="Create in this project"
    >
      <h2>What happens next?</h2>
      <p>Develop a new scene or shot inside {title}.</p>
      <CreationKindPicker value={kind} onChange={setKind} />
      <FloatingPromptForm
        id="project-idea"
        label="Project idea"
        formLabel="Create in this project"
        value={prompt}
        onChange={setPrompt}
        onSubmit={() => void submit()}
        busy={busy}
      />
      {error && <p role="alert">{error}</p>}
      {request?.projectId === projectId && replyOpen && (
        <HomeInterpretationReply
          request={request}
          onClose={() => {
            setReplyOpen(false);
          }}
        />
      )}
    </section>
  );
}
