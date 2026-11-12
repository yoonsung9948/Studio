import { useEffect } from "react";
import { X } from "lucide-react";
import { useStore } from "../../stores/store";
import { CommandButton } from "../commands";

export const NOTICE_DURATION_MS = 3500;

/** Each notification gets its own lifetime, even when its text repeats. */
export function StudioNotice() {
  const notice = useStore((state) => state.notice);
  const noticeId = useStore((state) => state.noticeId);
  const canUndo = useStore((state) => state.past.length > 0);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => {
      const current = useStore.getState();
      if (current.noticeId === noticeId && current.notice === notice)
        current.setNotice("");
    }, NOTICE_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [notice, noticeId]);
  if (!notice) return null;
  return (
    <div className="st-toast" role="status" aria-live="polite">
      <span>{notice}</span>
      {canUndo && <CommandButton id="undo">Undo</CommandButton>}
      <button
        className="st-icon"
        aria-label="Dismiss notification"
        onClick={() => useStore.getState().setNotice("")}
      >
        <X size={13} />
      </button>
    </div>
  );
}
