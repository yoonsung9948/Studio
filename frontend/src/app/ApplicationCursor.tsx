import { useEffect } from "react";

/** Native cursor artwork, with a pressed state that also covers portalled UI. */
export function ApplicationCursor() {
  useEffect(() => {
    let pointer: number | null = null;
    const reset = () => {
      pointer = null;
      document.body.classList.remove("st-cursor-pressed");
    };
    const down = (event: PointerEvent) => {
      if (
        event.button !== 0 ||
        event.pointerType === "touch" ||
        event.isPrimary === false
      )
        return;
      pointer = event.pointerId;
      document.body.classList.add("st-cursor-pressed");
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId === pointer) reset();
    };
    const visibility = () => {
      if (document.hidden) reset();
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", up, true);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("blur", reset);
    return () => {
      reset();
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", up, true);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("blur", reset);
    };
  }, []);
  return null;
}
