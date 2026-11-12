import { ShotMotionFields } from "./ShotMotionFields";
import { useState } from "react";
import {
  generationInputs,
  saveGenerationInputs,
} from "../../domain/generation-inputs";
import { changeShotCamera, changeShot } from "../../domain/workspace";
import { DraftField } from "../design/Primitives";
import { commit } from "../generation";
import type { CraftSettings } from "../../domain/types";
import type { ProduceContext } from "./useProduce";
type Props = {
  context: ProduceContext;
  craft: CraftSettings;
  onCraft(fields: Partial<CraftSettings>): void;
};
export function CameraControls({ context, craft, onCraft }: Props) {
  const { shot, scene, data } = context;
  if (!shot || !scene) return null;
  const inputs = generationInputs(data, scene.id, shot.id);
  return (
    <>
      <label>
        Framing
        <select
          aria-label="Shot framing"
          value={shot.framing || "Medium"}
          onChange={(e) =>
            commit(
              (d) => changeShotCamera(d, shot.id, { framing: e.target.value }),
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
          ].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      <label>
        Lens
        <select
          aria-label="Lens"
          value={craft.lens}
          onChange={(e) => onCraft({ lens: e.target.value })}
        >
          {["24 mm", "35 mm", "50 mm", "85 mm"].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      <label>
        Aspect ratio
        <select
          aria-label="Aspect ratio"
          value={inputs.aspectRatio}
          onChange={(e) =>
            commit(
              (d) =>
                saveGenerationInputs(
                  d,
                  scene.id,
                  { aspectRatio: e.target.value as typeof inputs.aspectRatio },
                  shot.id,
                ),
              "Aspect ratio saved",
            )
          }
        >
          {["16:9", "9:16", "1:1"].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      <details>
        <summary>Advanced</summary>
        <label>
          Angle
          <select
            value={craft.angle}
            aria-label="Camera angle"
            onChange={(e) => onCraft({ angle: e.target.value })}
          >
            {["Eye level", "Low angle", "High angle"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Lighting
          <select
            value={craft.lighting}
            aria-label="Lighting"
            onChange={(e) => onCraft({ lighting: e.target.value })}
          >
            {[
              "Warm practical",
              "Cool window",
              "Soft daylight",
              "Hard sidelight",
            ].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Focus
          <select
            value={craft.focus}
            aria-label="Focus"
            onChange={(e) => onCraft({ focus: e.target.value })}
          >
            <option>Shallow</option>
            <option>Deep</option>
          </select>
        </label>
        <label>
          Seed
          <input
            aria-label="Seed"
            type="number"
            min={0}
            max={2147483647}
            placeholder="Random"
            value={craft.seed ?? ""}
            onChange={(e) =>
              onCraft({
                seed: e.target.value ? Number(e.target.value) : undefined,
              })
            }
          />
        </label>
        <label>
          Avoid
          <DraftField
            label="Negative prompt"
            multiline
            rows={2}
            value={craft.negativePrompt}
            onSave={(negativePrompt) => onCraft({ negativePrompt })}
          />
        </label>
      </details>
    </>
  );
}
export function TakeControls({ context, craft, onCraft }: Props) {
  const { shot, scene, data } = context;
  const [tab, setTab] = useState("Motion");
  if (!shot || !scene) return null;
  return (
    <aside className="produce-panel produce-take-inspector">
      <nav className="produce-tabs" aria-label="Take controls">
        {["Motion", "Performance", "Dialogue"].map((name) => (
          <button
            key={name}
            aria-pressed={name === tab}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </nav>
      {tab === "Motion" && (
        <ShotMotionFields
          context={context}
          craft={craft}
          onCraft={onCraft}
          showPlanningOptions={false}
        />
      )}
      {tab !== "Dialogue" && (
        <label>
          Performance direction
          <DraftField
            multiline
            rows={4}
            label="Performance direction"
            value={shot.action}
            onSave={(action) =>
              commit(
                (d) => changeShot(d, shot.id, { action }),
                "Performance saved",
              )
            }
          />
        </label>
      )}
      <details open={tab === "Dialogue"}>
        <summary>Dialogue & voice</summary>
        <label>
          Dialogue
          <DraftField
            multiline
            rows={3}
            label="Take dialogue"
            value={shot.dialogue}
            onSave={(dialogue) =>
              commit(
                (d) => changeShot(d, shot.id, { dialogue }),
                "Dialogue saved",
              )
            }
          />
        </label>
        <p className="produce-hint">
          Voice and lip-sync tools will be available when a voice provider is
          connected. Existing take audio is preserved.
        </p>
      </details>
      <details>
        <summary>Sound</summary>
        <p>
          {data.studio.setups[scene.id]?.soundNotes ||
            "Use the take’s original audio."}
        </p>
        <p className="produce-hint">Add and mix audio in Final video.</p>
      </details>
      <details>
        <summary>Advanced</summary>
        <label>
          Easing
          <select
            aria-label="Motion easing"
            value={craft.easing}
            onChange={(e) => onCraft({ easing: e.target.value })}
          >
            {["Linear", "Ease in", "Ease out", "Ease in / out"].map((v) => (
              <option key={v}>{v}</option>
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
            onSave={(negativePrompt) => onCraft({ negativePrompt })}
          />
        </label>
      </details>
    </aside>
  );
}
