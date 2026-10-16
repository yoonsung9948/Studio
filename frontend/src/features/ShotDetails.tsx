import { useStore } from "../stores/store";
import { Button } from "../components/ui/button";
import { useActions } from "../components/Actions";
import { approveTake } from "../domain/commands";
import { stage } from "../domain/selectors";
export function ShotDetails({ sceneId }: { sceneId: string }) {
  const d = useStore((s) => s.data),
    ui = useStore((s) => s.ui),
    mutate = useStore((s) => s.mutate),
    modal = useActions();
  const selected =
    d.shots[ui.selectedShots[sceneId] ?? d.scenes[sceneId]?.shotIds[0]];
  return (
    <>
      {" "}
      {selected && (
        <div className="shot-details">
          <h3>
            {selected.title}{" "}
            <span className="status">{stage(d, selected)}</span>
          </h3>
          <p>{selected.action}</p>
          <p>{selected.dialogue}</p>
          <p className="muted">
            Characters:{" "}
            {selected.characters
              .map((id) => d.characters[id]?.name)
              .join(", ") || "None"}{" "}
            · Target {selected.targetFrames / 30}s
          </p>
          {selected.dependsOn && (
            <p className="notice-inline">
              Continues {d.shots[selected.dependsOn].title}. Its selected
              approved source take must stay available.
            </p>
          )}
          <div className="row-actions">
            <Button
              onClick={() => modal({ kind: "review", ids: [selected.id] })}
            >
              Review takes
            </Button>
            <Button
              onClick={() =>
                modal({
                  kind: "generate",
                  ids: [selected.id],
                  replacement: !!selected.currentTakeId,
                })
              }
            >
              Generate replacement
            </Button>
            <select
              aria-label="Take history"
              value={selected.currentTakeId ?? ""}
              onChange={(e) =>
                mutate((d) => approveTake(d, selected.id, e.target.value), true)
              }
            >
              <option value="" disabled>
                Choose approved take
              </option>
              {Object.values(d.takes)
                .filter(
                  (t) =>
                    t.shotId === selected.id &&
                    t.kind === "video" &&
                    t.approved,
                )
                .map((t, i) => (
                  <option key={t.id} value={t.id}>
                    Take {i + 1} · revision {t.revision}
                  </option>
                ))}
            </select>
          </div>
        </div>
      )}
      {!selected && (
        <p>
          Select a scene shot to inspect its action, continuity, and take
          history.
        </p>
      )}
    </>
  );
}
