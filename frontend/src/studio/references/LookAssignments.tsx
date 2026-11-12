import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../components/ui/dialog";
import { useStore } from "../../stores/store";
import { assignEpisodeLook } from "../../domain/episode-characters";
import { commit } from "../generation";

export function LookAssignments({
  episodeId,
  lookId,
  onClose,
}: {
  episodeId: string;
  lookId: string;
  onClose(): void;
}) {
  const data = useStore((state) => state.data);
  const [selected, setSelected] = useState<string[]>([]),
    [error, setError] = useState("");
  const scenes = data.episodes[episodeId].sceneIds
    .map((id) => data.scenes[id])
    .filter(
      (scene) => scene && !scene.archived && scene.episodeId === episodeId,
    );
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="st-dialog er-assign-dialog">
        <DialogTitle>
          Assign {data.studio.looks[lookId].name} to scenes
        </DialogTitle>
        <DialogDescription>
          Selected scenes inherit this look. Existing shot overrides stay
          unchanged.
        </DialogDescription>
        <div className="er-assignment-list">
          {scenes.map((scene) => (
            <label key={scene.id}>
              <input
                type="checkbox"
                checked={selected.includes(scene.id)}
                onChange={(event) =>
                  setSelected((ids) =>
                    event.target.checked
                      ? [...ids, scene.id]
                      : ids.filter((id) => id !== scene.id),
                  )
                }
              />
              <span>
                {scene.title}
                <small>
                  {
                    scene.shotIds.filter((id) => !data.shots[id]?.archived)
                      .length
                  }{" "}
                  shots
                </small>
              </span>
            </label>
          ))}
        </div>
        {!scenes.length && <p>Add a scene to this episode first.</p>}
        {error && (
          <p role="alert" className="ac-error">
            {error}
          </p>
        )}
        <button
          className="ds-button ds-primary"
          disabled={!selected.length}
          onClick={() => {
            if (
              commit(
                (next) => assignEpisodeLook(next, episodeId, lookId, selected),
                "Look assigned to scenes",
              )
            )
              onClose();
            else
              setError(
                "Could not assign this look. Unlock the selected scene's shots and try again.",
              );
          }}
        >
          Assign to {selected.length}{" "}
          {selected.length === 1 ? "scene" : "scenes"}
        </button>
      </DialogContent>
    </Dialog>
  );
}
