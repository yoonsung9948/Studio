import { ArrowUp } from "lucide-react";

export function FloatingPromptForm({
  id,
  label,
  formLabel,
  value,
  onChange,
  onSubmit,
  busy = false,
  placeholder = "Describe a story, scene or shot…",
}: {
  id: string;
  label: string;
  formLabel: string;
  value: string;
  onChange(value: string): void;
  onSubmit(): void;
  busy?: boolean;
  placeholder?: string;
}) {
  return (
    <form
      className="st-home-composer"
      aria-label={formLabel}
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <textarea
        id={id}
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            onSubmit();
          }
        }}
      />
      <div className="st-composer-controls">
        <button
          type="submit"
          className="st-button st-primary st-composer-send"
          aria-label="Send message"
          aria-disabled={busy}
          title={busy ? "Interpreting your request…" : "Send message (⌘+Enter)"}
        >
          <ArrowUp size={16} aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}
