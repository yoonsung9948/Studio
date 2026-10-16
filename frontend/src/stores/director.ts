import { create } from "zustand";
import { useStore } from "./store";

// One-shot composer requests are transient, never saved with project data.
export const useDirectorRequest = create<{ prompt: string | null }>(() => ({
  prompt: null,
}));
export function openDirector(prompt: string) {
  useDirectorRequest.setState({ prompt });
  useStore.getState().setUI({ aiOpen: true });
  window.dispatchEvent(new Event("dotori-studio-open-panel"));
}
