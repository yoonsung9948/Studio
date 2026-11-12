import {
  useProductionSave,
  productionSync,
} from "../../services/production-sync";
import { create } from "zustand";
import { useStore } from "../../stores/store";

export const usePendingEdits = create<{
  ids: Set<string>;
  mark(id: string, pending: boolean): void;
}>((set) => ({
  ids: new Set(),
  mark: (id, pending) =>
    set((state) => {
      if (state.ids.has(id) === pending) return state;
      const ids = new Set(state.ids);
      if (pending) ids.add(id);
      else ids.delete(id);
      return { ids };
    }),
}));
export function SaveStatus({ compact = false }: { compact?: boolean }) {
  const localSaving = usePendingEdits((state) => state.ids.size > 0);
  const server = useProductionSave();
  const saving = localSaving || (!!productionSync() && server.pending);
  const autosave = useStore((state) => state.ui.autosave !== false);
  const localFailed = useStore((state) => state.storageFailed);
  const failed = productionSync() ? !!server.error : localFailed;
  return (
    <span
      role="status"
      className={failed ? "ds-error" : saving ? "ds-saving" : undefined}
    >
      {failed
        ? "Save failed · session only"
        : saving
          ? autosave
            ? "Saving…"
            : "Unsaved changes"
          : compact || !autosave
            ? "Saved"
            : "Saved automatically"}
    </span>
  );
}
