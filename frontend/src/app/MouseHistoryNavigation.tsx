import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

/** Handle mouse thumb buttons even in standalone app windows. */
export function MouseHistoryNavigation() {
  const navigate = useNavigate();

  useEffect(() => {
    const isHistoryButton = (event: MouseEvent) =>
      event.button === 3 || event.button === 4;
    const suppressNativeNavigation = (event: MouseEvent) => {
      if (!isHistoryButton(event)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const release = (event: MouseEvent) => {
      if (!isHistoryButton(event)) return;
      suppressNativeNavigation(event);
      navigate(event.button === 3 ? -1 : 1);
    };

    // Suppress the browser default so a single press cannot navigate twice.
    window.addEventListener("mousedown", suppressNativeNavigation, true);
    window.addEventListener("mouseup", release, true);
    window.addEventListener("auxclick", suppressNativeNavigation, true);
    return () => {
      window.removeEventListener("mousedown", suppressNativeNavigation, true);
      window.removeEventListener("mouseup", release, true);
      window.removeEventListener("auxclick", suppressNativeNavigation, true);
    };
  }, [navigate]);

  return null;
}
