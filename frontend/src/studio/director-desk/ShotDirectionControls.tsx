import { useState } from "react";
import { RotateCw, Sparkles } from "lucide-react";
import { useStore } from "../../stores/store";
import {
  changeShot,
  changeShotCamera,
  setShotDuration,
} from "../../domain/workspace";
import {
  generationInputs,
  saveGenerationInputs,
  defaultCraft,
} from "../../domain/generation-inputs";
import { updateDirection } from "../../domain/studio-commands";
import type { CraftSettings } from "../../domain/types";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../../components/ui/dialog";
import { Field } from "../inspector";
import { DraftField } from "../design/Primitives";
import { commit } from "../generation";
import { CountedField } from "./CountedField";
import { ControlGroup, SelectControl } from "./controls";

export function ShotDirectionControls({
  shotId,
  stage,
}: {
  shotId: string;
  stage: "frame" | "motion";
}) {
  const data = useStore((state) => state.data),
    shot = data.shots[shotId];
  const inputs = generationInputs(data, shot.sceneId, shotId),
    craft = { ...defaultCraft, ...inputs.craft };
  const [enhance, setEnhance] = useState(false);
  const [proposal, setProposal] = useState("");
  const [original, setOriginal] = useState("");
  const saveInputs = (patch: Parameters<typeof saveGenerationInputs>[2]) =>
    commit(
      (d) => saveGenerationInputs(d, shot.sceneId, patch, shotId),
      "Shot inputs saved",
    );
  const saveCraft = (patch: Partial<CraftSettings>) =>
    saveInputs({ craft: { ...craft, ...patch } });
  return (
    <>
      <ControlGroup
        title={stage === "frame" ? "Composition" : "Camera & motion"}
      >
        <SelectControl
          label="Shot size"
          value={shot.framing ?? "Medium"}
          options={["Wide", "Full body", "Medium", "Close-up", "Detail"]}
          onChange={(framing) =>
            commit(
              (d) => changeShotCamera(d, shotId, { framing }),
              "Framing saved",
            )
          }
        />
        {stage === "frame" ? (
          <>
            <SelectControl
              label="Angle"
              value={craft.angle}
              options={["Eye level", "Low angle", "High angle"]}
              onChange={(angle) => saveCraft({ angle })}
            />
            <SelectControl
              label="Lens look"
              value={craft.lens}
              options={["24 mm", "35 mm", "50 mm", "85 mm"]}
              onChange={(lens) => saveCraft({ lens })}
            />
            <SelectControl
              label="Aspect ratio"
              value={inputs.aspectRatio}
              options={["16:9", "9:16", "1:1"]}
              onChange={(aspectRatio) =>
                saveInputs({
                  aspectRatio: aspectRatio as typeof inputs.aspectRatio,
                })
              }
            />
          </>
        ) : (
          <>
            <SelectControl
              label="Camera movement"
              value={shot.movement ?? "Static"}
              options={["Static", "Pan", "Tracking", "Push in", "Handheld"]}
              onChange={(movement) =>
                commit(
                  (d) => changeShotCamera(d, shotId, { movement }),
                  "Camera direction saved",
                )
              }
            />
            <label className="dd-select-control">
              <span>Duration</span>
              <input
                aria-label="Duration seconds"
                type="number"
                min={1}
                max={30}
                step={0.1}
                key={shot.targetFrames}
                defaultValue={shot.targetFrames / 30}
                onBlur={(e) => {
                  if (
                    Number(e.target.value) !== shot.targetFrames / 30 &&
                    !commit(
                      (d) => setShotDuration(d, shotId, Number(e.target.value)),
                      "Duration saved",
                    )
                  )
                    e.target.value = String(shot.targetFrames / 30);
                }}
              />
            </label>
          </>
        )}
      </ControlGroup>
      {stage === "frame" ? (
        <ControlGroup title="Light & focus">
          <SelectControl
            label="Lighting style"
            value={craft.lighting}
            options={[
              "Warm practical",
              "Cool window",
              "Soft daylight",
              "Hard sidelight",
            ]}
            onChange={(lighting) => saveCraft({ lighting })}
          />
          <SelectControl
            label="Focus"
            value={craft.focus}
            options={["Shallow", "Deep"]}
            onChange={(focus) => saveCraft({ focus })}
          />
        </ControlGroup>
      ) : (
        <ControlGroup title="Motion character">
          <label className="dd-range-control">
            <span>
              Intensity<b>{craft.motionStrength}%</b>
            </span>
            <input
              aria-label="Motion intensity"
              type="range"
              min={0}
              max={100}
              step={5}
              value={craft.motionStrength}
              onChange={(e) =>
                saveCraft({ motionStrength: Number(e.target.value) })
              }
            />
          </label>
          <SelectControl
            label="Easing"
            value={craft.easing}
            options={["Linear", "Ease in", "Ease out", "Ease in / out"]}
            onChange={(easing) => saveCraft({ easing })}
          />
        </ControlGroup>
      )}
      {stage === "frame" ? (
        <section className="dd-control-group">
          <header className="dd-section-heading">
            <h3>Prompt</h3>
            <button
              className="ds-button ds-ai ds-small"
              onClick={() => {
                setOriginal(inputs.instructions || shot.action);
                setProposal(
                  `${inputs.instructions || shot.action}\n\nKeep the approved identity and setting. Use clear composition and consistent lighting, with one readable focal point.`,
                );
                setEnhance(true);
              }}
            >
              <Sparkles size={14} />
              Enhance prompt
            </button>
          </header>
          <CountedField
            label="Generation instructions"
            maxLength={4000}
            rows={2}
            value={inputs.instructions}
            placeholder="Describe the frame you want to create…"
            multiline
            onSave={(instructions) => saveInputs({ instructions })}
          />
        </section>
      ) : (
        <ControlGroup title="Dialogue & continuity">
          <label className="ds-field">
            Dialogue
            <CountedField
              label="Dialogue"
              value={shot.dialogue}
              multiline
              rows={3}
              maxLength={2000}
              onSave={(dialogue) =>
                commit((d) => {
                  d.shots[shotId].dialogue = dialogue;
                  changeShotCamera(d, shotId, {});
                }, "Dialogue saved")
              }
            />
          </label>
          <label className="ds-field">
            Continuity
            <CountedField
              label="Continuity"
              value={data.studio.setups[shot.sceneId]?.direction.notes || ""}
              multiline
              rows={3}
              maxLength={2000}
              onSave={(notes) =>
                commit(
                  (d) => updateDirection(d, shot.sceneId, { notes }),
                  "Continuity saved",
                )
              }
            />
          </label>
        </ControlGroup>
      )}
      <details
        className="dd-advanced"
        open={stage === "frame" ? true : undefined}
      >
        <summary>
          {stage === "frame" ? "Advanced" : "Advanced direction"}
        </summary>
        {stage === "motion" && (
          <label className="ds-field">
            Additional instructions
            <DraftField
              label="Generation instructions"
              value={inputs.instructions}
              multiline
              rows={3}
              onSave={(instructions) => saveInputs({ instructions })}
            />
          </label>
        )}
        <details className="dd-rename-shot">
          <summary>Rename shot</summary>
          <label className="ds-field">
            Shot title
            <DraftField
              label="Shot title"
              value={shot.title}
              onSave={(title) =>
                commit((d) => changeShot(d, shotId, { title }), "Shot renamed")
              }
            />
          </label>
        </details>
        <div className="dd-seed-row">
          <Field
            label="Seed (optional)"
            type="number"
            value={craft.seed ?? ""}
            onSave={(seed) =>
              saveCraft({ seed: seed.trim() ? Number(seed) : undefined })
            }
          />
          <button
            className="ds-icon"
            aria-label="Randomize seed"
            onClick={() =>
              saveCraft({ seed: Math.floor(Math.random() * 2147483647) })
            }
          >
            <RotateCw size={16} />
          </button>
        </div>
        <Field
          label="Avoid in this shot"
          multiline
          value={craft.negativePrompt}
          onSave={(negativePrompt) => saveCraft({ negativePrompt })}
        />
        <p className="ds-muted">
          Saved with each generated take. Available controls depend on the
          generation model.
        </p>
      </details>
      <Dialog open={enhance} onOpenChange={setEnhance}>
        <DialogContent className="st-dialog ds-prompt-proposal">
          <DialogTitle>Enhance frame prompt</DialogTitle>
          <DialogDescription>
            Review this local demo suggestion before applying it.
          </DialogDescription>
          <h3>Original</h3>
          <pre>{original}</pre>
          <h3 className="ds-amber">Proposed revision</h3>
          <textarea
            aria-label="Proposed frame prompt"
            value={proposal}
            rows={6}
            onChange={(e) => setProposal(e.target.value)}
          />
          <button
            className="ds-button ds-primary"
            disabled={
              shot.locked ||
              !proposal.trim() ||
              original !== (inputs.instructions || shot.action)
            }
            onClick={() => {
              if (saveInputs({ instructions: proposal })) setEnhance(false);
            }}
          >
            Apply enhancement
          </button>
          {original !== (inputs.instructions || shot.action) && (
            <p role="status">
              The prompt changed. Close this proposal and enhance the current
              prompt again.
            </p>
          )}
          <button className="ds-button" onClick={() => setEnhance(false)}>
            Keep original
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}
