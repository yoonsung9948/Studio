import {
  cameraMovements,
  cameraSpeeds,
  actionTimings,
  performanceTones,
  gazeDirections,
} from "../../domain/video-direction";
import type { CraftSettings } from "../../domain/types";
import { changeShotCamera, planShotDuration } from "../../domain/workspace";
import { DraftField } from "../design/Primitives";
import { commit } from "../generation";
import type { ProduceContext } from "./useProduce";

type Props = {
  context: ProduceContext;
  craft: CraftSettings;
  onCraft(fields: Partial<CraftSettings>): void;
  showPlanningOptions?: boolean;
  showDuration?: boolean;
};
function DirectionSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value?: string;
  options: readonly string[];
  onChange(value: string): void;
  disabled?: boolean;
}) {
  return (
    <label>
      {label}
      <select
        aria-label={label}
        value={value ?? ""}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Let the action guide it</option>
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}
export function ShotDurationField({ context }: { context: ProduceContext }) {
  const { shot } = context;
  if (!shot) return null;
  return (
    <label>
      Duration
      <select
        aria-label="Take duration"
        value={shot.targetFrames / 30}
        onChange={(event) =>
          commit(
            (d) => planShotDuration(d, shot.id, Number(event.target.value)),
            "Take duration saved",
          )
        }
      >
        {[3, 4, 5, 6, 8, 10, 15, 20, 30, shot.targetFrames / 30]
          .filter((value, index, all) => all.indexOf(value) === index)
          .sort((a, b) => a - b)
          .map((value) => (
            <option key={value} value={value}>
              {value} seconds
            </option>
          ))}
      </select>
    </label>
  );
}
export function ShotMotionFields({
  context,
  craft,
  onCraft,
  showPlanningOptions = true,
  showDuration = true,
}: Props) {
  const { shot } = context;
  if (!shot) return null;
  return (
    <>
      <label>
        Camera movement
        <select
          aria-label="Camera movement"
          value={shot.movement || "Static"}
          onChange={(event) =>
            commit(
              (d) =>
                changeShotCamera(d, shot.id, { movement: event.target.value }),
              "Camera movement saved",
            )
          }
        >
          {cameraMovements.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </label>
      {showPlanningOptions && (
        <DirectionSelect
          label="Camera speed"
          value={craft.cameraSpeed}
          options={cameraSpeeds}
          disabled={!shot.movement || shot.movement === "Static"}
          onChange={(cameraSpeed) =>
            onCraft({ cameraSpeed: cameraSpeed || undefined })
          }
        />
      )}

      {showDuration && <ShotDurationField context={context} />}
      <label>
        Motion intensity · {craft.motionStrength}%
        <input
          aria-label="Motion intensity"
          type="range"
          min={0}
          max={100}
          value={craft.motionStrength}
          onChange={(event) =>
            onCraft({ motionStrength: Number(event.target.value) })
          }
        />
      </label>
      {showPlanningOptions && (
        <DirectionSelect
          label="Action timing"
          value={craft.actionTiming}
          options={actionTimings}
          onChange={(actionTiming) =>
            onCraft({ actionTiming: actionTiming || undefined })
          }
        />
      )}
    </>
  );
}
export function ShotPerformanceFields({
  craft,
  onCraft,
}: Pick<Props, "craft" | "onCraft">) {
  return (
    <>
      <DirectionSelect
        label="Performance tone"
        value={craft.performanceTone}
        options={performanceTones}
        onChange={(performanceTone) =>
          onCraft({ performanceTone: performanceTone || undefined })
        }
      />
      <DirectionSelect
        label="Gaze direction"
        value={craft.gazeDirection}
        options={gazeDirections}
        onChange={(gazeDirection) =>
          onCraft({ gazeDirection: gazeDirection || undefined })
        }
      />
      <label>
        Background motion
        <DraftField
          label="Background motion"
          multiline
          rows={2}
          maxLength={1500}
          value={craft.environmentMotion ?? ""}
          placeholder="Rain runs down the window; the candle flickers gently."
          onSave={(environmentMotion) => onCraft({ environmentMotion })}
        />
      </label>
      <label>
        Ending beat
        <DraftField
          label="Ending beat"
          multiline
          rows={2}
          maxLength={1500}
          value={craft.endingBeat ?? ""}
          placeholder="Her hand settles on the sealed letter, then hold her gaze."
          onSave={(endingBeat) => onCraft({ endingBeat })}
        />
      </label>
    </>
  );
}
