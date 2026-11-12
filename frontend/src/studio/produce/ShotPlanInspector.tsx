import { useState } from "react";
import {
  generationInputs,
  saveGenerationInputs,
} from "../../domain/generation-inputs";
import type { CraftSettings } from "../../domain/types";
import { changeShot, changeShotCamera } from "../../domain/workspace";
import { DraftField } from "../design/Primitives";
import { commit } from "../generation";
import {
  ShotMotionFields,
  ShotPerformanceFields,
  ShotDurationField,
} from "./ShotMotionFields";
import type { ProduceContext } from "./useProduce";

export function ShotPlanInspector({ context }: { context: ProduceContext }) {
  const { data, scene, shot } = context;
  const [expanded, setExpanded] = useState<string | null>(null);
  const toggleSection = (name: string) =>
    setExpanded((current) => (current === name ? null : name));
  if (!scene || !shot)
    return (
      <p className="produce-hint">
        Add a shot to direct its camera, action and timing.
      </p>
    );
  const craft = generationInputs(data, scene.id, shot.id).craft;
  const saveCraft = (fields: Partial<CraftSettings>) =>
    commit(
      (d) =>
        saveGenerationInputs(
          d,
          scene.id,
          {
            craft: {
              ...generationInputs(d, scene.id, shot.id).craft,
              ...fields,
            },
          },
          shot.id,
        ),
      "Shot direction saved",
    );
  return (
    <fieldset className="produce-plan-inspector" disabled={shot.locked}>
      <legend>
        Selected shot ·{" "}
        {String(scene.shotIds.indexOf(shot.id) + 1).padStart(2, "0")}
      </legend>
      {shot.locked && (
        <p className="produce-hint">
          Unlock this shot to change its direction.
        </p>
      )}
      <label>
        Shot title
        <DraftField
          label="Shot title"
          value={shot.title}
          normalize={(value) => value.trim() || shot.title}
          onSave={(title) =>
            commit((d) => changeShot(d, shot.id, { title }), "Shot renamed")
          }
        />
      </label>
      <label>
        Action & performance
        <DraftField
          label="Shot action"
          multiline
          rows={3}
          value={shot.action}
          placeholder="One clear action, followed by a reaction."
          onSave={(action) =>
            commit(
              (d) => changeShot(d, shot.id, { action }),
              "Shot action saved",
            )
          }
        />
      </label>
      <label>
        Framing
        <select
          aria-label="Shot framing"
          value={shot.framing || "Medium"}
          onChange={(event) =>
            commit(
              (d) =>
                changeShotCamera(d, shot.id, { framing: event.target.value }),
              "Framing saved",
            )
          }
        >
          {[
            "Wide",
            "Medium",
            "Close-up",
            "Extreme close-up",
            "Over the shoulder",
          ].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </label>
      <ShotDurationField context={context} />
      <details open={expanded === "camera"}>
        <summary
          onClick={(event) => {
            event.preventDefault();
            toggleSection("camera");
          }}
        >
          Camera & motion
        </summary>
        <ShotMotionFields
          context={context}
          craft={craft}
          onCraft={saveCraft}
          showDuration={false}
        />
      </details>
      <details open={expanded === "performance"}>
        <summary
          onClick={(event) => {
            event.preventDefault();
            toggleSection("performance");
          }}
        >
          Performance & background
        </summary>
        <ShotPerformanceFields craft={craft} onCraft={saveCraft} />
      </details>
      <details open={expanded === "advanced"}>
        <summary
          onClick={(event) => {
            event.preventDefault();
            toggleSection("advanced");
          }}
        >
          Dialogue & advanced
        </summary>
        <label>
          Dialogue
          <DraftField
            label="Shot dialogue"
            multiline
            rows={2}
            value={shot.dialogue}
            onSave={(dialogue) =>
              commit(
                (d) => changeShot(d, shot.id, { dialogue }),
                "Dialogue saved",
              )
            }
          />
        </label>
        <label>
          Motion easing
          <select
            aria-label="Motion easing"
            value={craft.easing}
            onChange={(event) => saveCraft({ easing: event.target.value })}
          >
            {["Linear", "Ease in", "Ease out", "Ease in / out"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Avoid
          <DraftField
            label="Motion negative prompt"
            multiline
            rows={2}
            value={craft.negativePrompt}
            placeholder="Flicker, distorted hands, abrupt camera changes"
            onSave={(negativePrompt) => saveCraft({ negativePrompt })}
          />
        </label>
      </details>
      <p className="produce-hint">
        These settings carry into Takes. Describe movement and timing; your
        starting frame supplies the visual setup.
      </p>
    </fieldset>
  );
}
