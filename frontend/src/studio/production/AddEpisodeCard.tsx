import { Plus } from "lucide-react";

export function AddEpisodeCard({ onAdd }: { onAdd(): void }) {
  return (
    <button
      type="button"
      aria-label="Add episode"
      className="production-add-episode"
      onClick={onAdd}
    >
      <Plus size={31} strokeWidth={1.5} aria-hidden="true" />
      <strong>Add episode</strong>
      <small>Start the next chapter</small>
    </button>
  );
}
