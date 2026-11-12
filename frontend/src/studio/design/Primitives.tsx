import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { Check, Film, Pencil } from "lucide-react";
import { useStore } from "../../stores/store";
import { usePendingEdits } from "./SavingState";

export function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "amber" | "error";
}) {
  return (
    <span className={`ds-badge ds-badge-${tone}`}>
      {tone === "success" && <Check size={12} />}
      {children}
    </span>
  );
}

/** Save on blur or a brief pause. Flush drafts before navigation unmounts the editor. */
export function DraftField({
  value,
  onSave,
  label,
  multiline = false,
  className = "",
  placeholder,
  maxLength = 10000,
  rows = 4,
  disabled = false,
  normalize,
}: {
  value: string;
  onSave(value: string): void | boolean;
  label: string;
  multiline?: boolean;
  className?: string;
  placeholder?: string;
  maxLength?: number;
  rows?: number;
  disabled?: boolean;
  normalize?(value: string): string;
}) {
  const autosave = useStore((state) => state.ui.autosave !== false);
  const [draft, setDraft] = useState(value);
  const id = useId();
  const latest = useRef({
    draft: value,
    saved: value,
    save: onSave,
    normalize,
  });
  latest.current.save = onSave;
  latest.current.normalize = normalize;
  const mark = (pending: boolean) =>
    usePendingEdits.getState().mark(id, pending);
  useEffect(() => {
    latest.current.saved = value;
    latest.current.draft = value;
    setDraft(value);
    mark(false);
  }, [value]);
  const flush = (updateInput = true) => {
    const state = latest.current;
    const next = state.normalize?.(state.draft) ?? state.draft;
    if (next !== state.draft) {
      state.draft = next;
      if (updateInput) setDraft(next);
    }
    if (next !== state.saved) {
      const previous = state.saved;
      state.saved = next;
      if (state.save(next) === false) {
        state.saved = previous;
        state.draft = previous;
        if (updateInput) setDraft(previous);
      }
    }
    mark(false);
  };
  useEffect(() => {
    if (!autosave) return;
    const timer = window.setTimeout(flush, 700);
    return () => window.clearTimeout(timer);
  }, [draft, autosave]);
  useEffect(() => () => flush(false), []);
  const props = {
    "aria-label": label,
    value: draft,
    placeholder,
    maxLength,
    disabled,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      latest.current.draft = event.target.value;
      setDraft(event.target.value);
      mark(event.target.value !== latest.current.saved);
    },
    onBlur: () => flush(),
  };
  return multiline ? (
    <textarea {...props} rows={rows} className={className} />
  ) : (
    <input {...props} className={className} />
  );
}

export function EditableHeading({
  value,
  label,
  onSave,
}: {
  value: string;
  label: string;
  onSave(value: string): void | boolean;
}) {
  return (
    <h1 className="ds-editable-heading" aria-label={value}>
      <DraftField
        value={value}
        label={label}
        onSave={onSave}
        normalize={(next) => next.trim() || value}
      />
      <Pencil size={16} aria-hidden="true" />
    </h1>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="ds-empty">
      <Film size={32} strokeWidth={1.3} />
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
