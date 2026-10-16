import { useState } from "react";
import { GenerationDialog } from "../features/generation/GenerationDialog";
import { beforeEach, it, expect } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ActionsProvider, useActions } from "../components/Actions";
import { useStore } from "../stores/store";
import { RightPanel } from "../features/RightPanel";
import { recover } from "../stores/store";
import { scenePreflight } from "../domain/scene-preflight";
import {
  generationInputs,
  saveGenerationInputs,
} from "../domain/generation-inputs";
import { enqueueGeneration, tick } from "../domain/commands";
import { seed } from "../mocks/seed";
beforeEach(() => useStore.getState().reset());
function Trigger({
  ids = ["ep1-s2-q1", "ep1-s2-q2", "ep1-s2-q3"],
  replacement = false,
}: {
  ids?: string[];
  replacement?: boolean;
}) {
  const open = useActions(),
    [visible, setVisible] = useState(false);
  const d = useStore((s) => s.data);
  const multiple = new Set(ids.map((id) => d.shots[id].sceneId)).size > 1;
  return (
    <>
      <button
        onClick={() =>
          multiple
            ? open({ kind: "generate", ids, replacement })
            : setVisible(true)
        }
      >
        Open generation
      </button>
      {visible && (
        <>
          <button aria-label="Close" onClick={() => setVisible(false)}>
            Close inputs
          </button>
          <GenerationDialog
            embedded
            ids={ids}
            replacement={replacement}
            close={() => setVisible(false)}
          />
        </>
      )}
    </>
  );
}
function mount(ids?: string[], replacement = false) {
  render(
    <MemoryRouter>
      <ActionsProvider>
        <Trigger ids={ids} replacement={replacement} />
      </ActionsProvider>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open generation" }));
}
it("assembles character, Look, setting and additional reference inputs and snapshots them in the queued request", () => {
  mount();
  fireEvent.click(
    screen.getByRole("button", { name: "Remove Leo Hart from inputs" }),
  );
  expect(
    screen.getByRole("heading", { name: "Generate scene" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Add character" }));
  fireEvent.click(
    within(screen.getByRole("region", { name: "Character library" })).getByRole(
      "button",
      { name: /Leo Hart/ },
    ),
  );
  fireEvent.change(screen.getByLabelText("Look for Leo Hart"), {
    target: { value: "leo-look-1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Change setting" }));
  fireEvent.click(
    within(screen.getByRole("region", { name: "Setting library" })).getByRole(
      "button",
      { name: /Apartment/ },
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Add reference" }));
  const asset = within(screen.getByRole("region", { name: "Asset library" }))
    .getAllByRole("button")
    .find((b) => b.textContent?.includes("Apartment · location reference"))!;
  fireEvent.click(asset);
  fireEvent.change(
    screen.getByLabelText("Purpose for Apartment · location reference"),
    { target: { value: "visual_style" } },
  );
  fireEvent.change(screen.getByLabelText("Generation aspect ratio"), {
    target: { value: "16:9" },
  });
  act(() =>
    useStore.getState().mutate((d) =>
      saveGenerationInputs(d, "ep1-s2", {
        instructions: "Maya hears a recording while Leo waits in the doorway.",
      }),
    ),
  );
  const balance = useStore.getState().data.credits;
  fireEvent.click(
    screen.getByRole("button", { name: /Generate 3 shots · 24 cr/ }),
  );
  const d = useStore.getState().data,
    j = Object.values(d.jobs).find((j) => j.shotId === "ep1-s2-q1")!;
  expect(j.inputs?.instructions).toContain("Maya hears a recording");
  expect(j.inputs?.aspectRatio).toBe("16:9");
  expect(j.inputs?.locationAssetId).toBe("apartment-image");
  expect(j.inputs?.referenceInputs).toEqual([
    { assetId: "apartment-image", purpose: "visual_style" },
  ]);
  expect(
    j.references?.find((r) => r.characterId === "leo")?.lookVersionId,
  ).toBe(d.studio.looks["leo-look-1"].primaryVersionId);
  expect(d.credits).toBe(balance - 24);
});
it("shows character blockers beside the selectors and remembers selections when reopened", () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Add character" }));
  fireEvent.click(
    within(screen.getByRole("region", { name: "Character library" })).getByRole(
      "button",
      { name: /Emma Wilson/ },
    ),
  );
  expect(
    screen.getByRole("button", { name: /Generate 0 shots/ }),
  ).toBeDisabled();
  expect(
    screen.getByText(/Emma Wilson needs an approved identity/),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: "Open generation" }));
  expect(screen.getByLabelText("Look for Emma Wilson")).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Remove Emma Wilson from inputs" }),
  );
  expect(
    screen.getByRole("button", { name: /Generate 3 shots/ }),
  ).toBeEnabled();
});
it("overrides only a selected shot, keeps siblings unchanged, and validates only the submitted shot cast", () => {
  mount(["ep1-s3-q1"]);
  fireEvent.click(
    screen.getByRole("button", { name: "Remove Maya Chen from inputs" }),
  );
  expect(useStore.getState().data.studio.setups["ep1-s3"].cast).toHaveLength(1);
  expect(useStore.getState().data.shots["ep1-s3-q1"].castOverride).toEqual([]);
  expect(
    useStore.getState().data.shots["ep1-s3-q2"].castOverride,
  ).toBeUndefined();
  expect(
    scenePreflight(useStore.getState().data, "ep1-s3", undefined, undefined, [
      "ep1-s3-q1",
    ]).ready,
  ).toBe(true);
  expect(scenePreflight(useStore.getState().data, "ep1-s3").ready).toBe(false);
});
it("lets batch users inspect a blocked scene and excludes it from submission", () => {
  mount(["ep1-s2-q1", "ep1-s4-q1"]);
  expect(
    screen.getByText(/Emma Wilson needs an approved identity/),
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: /Generate 1 shot · 24 cr/ }),
  );
  expect(
    Object.values(useStore.getState().data.jobs)
      .filter((j) => j.state === "queued")
      .map((j) => j.shotId),
  ).toEqual(["ep1-s2-q1"]);
});
it("restores the workspace right panel to Director only", () => {
  render(
    <MemoryRouter
      initialEntries={["/projects/midnight/episodes/ep1/scenes/ep1-s2"]}
    >
      <ActionsProvider>
        <RightPanel projectId="midnight" episodeId="ep1" sceneId="ep1-s2" />
      </ActionsProvider>
    </MemoryRouter>,
  );
  expect(
    screen.getByRole("heading", { name: "AI Director" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("navigation", { name: "Context panel" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Preflight" }),
  ).not.toBeInTheDocument();
});
it("persists input choices, blocks missing uploads, and retains immutable job and take snapshots", () => {
  const d = seed();
  d.assets["sound"] = {
    id: "sound",
    projectId: "midnight",
    kind: "audio",
    title: "Sound reference",
    url: "blob:fixture",
    sessionOnly: true,
    provenance: "Test upload",
  };
  saveGenerationInputs(d, "ep1-s2", {
    instructions: "Listen carefully.",
    referenceInputs: [{ assetId: "sound", purpose: "audio" }],
  });
  enqueueGeneration(d, ["ep1-s2-q1"]);
  const j = Object.values(d.jobs).find((j) => j.shotId === "ep1-s2-q1")!;
  const input = structuredClone(j.inputs);
  saveGenerationInputs(d, "ep1-s2", { instructions: "A different direction." });
  for (let i = 0; i < 30; i++) tick(d);
  expect(j.inputs).toEqual(input);
  expect(
    Object.values(d.takes).find((t) => t.shotId === j.shotId && t.inputs)
      ?.inputs,
  ).toEqual(input);
  const recovered = recover(
    JSON.stringify({ version: 2, data: d, ui: useStore.getState().ui }),
  );
  expect(recovered.notice).toBe("");
  expect(generationInputs(recovered.data, "ep1-s2").instructions).toBe(
    "A different direction.",
  );
  expect(
    scenePreflight(recovered.data, "ep1-s2").issues.some((i) =>
      i.message.includes("reference is missing"),
    ),
  ).toBe(true);
});
it("does not charge twice or bypass a required setting in a shot submission", () => {
  const d = seed();
  saveGenerationInputs(
    d,
    "ep1-s2",
    { locationMode: "required", locationId: undefined },
    "ep1-s2-q1",
  );
  const credits = d.credits;
  expect(() => enqueueGeneration(d, ["ep1-s2-q1"])).toThrow(/setting image/);
  expect(d.credits).toBe(credits);
  saveGenerationInputs(d, "ep1-s2", { locationMode: "none" }, "ep1-s2-q1");
  enqueueGeneration(d, ["ep1-s2-q1"]);
  const balance = d.credits;
  enqueueGeneration(d, ["ep1-s2-q1"]);
  expect(d.credits).toBe(balance);
});
it("creates and approves a generated setting inside the scene dialog before scene submission", () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Change setting" }));
  fireEvent.click(screen.getByRole("button", { name: "New setting" }));
  fireEvent.change(screen.getByLabelText("Setting name"), {
    target: { value: "Rooftop at dusk" },
  });
  fireEvent.change(screen.getByLabelText("Description"), {
    target: { value: "A quiet rooftop above the city." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create setting" }));
  expect(
    screen.getByRole("button", { name: /Generate 0 shots/ }),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", { name: "Generate setting image · 8 demo cr" }),
  );
  act(() => {
    for (let i = 0; i < 40; i++) useStore.getState().mutate(tick);
  });
  fireEvent.click(screen.getByRole("button", { name: "Approve selected" }));
  const d = useStore.getState().data,
    l = d.studio.locations[d.studio.setups["ep1-s2"].locationId!];
  expect(l.assetId).toBeTruthy();
  expect(l.name).toBe("Rooftop at dusk");
  expect(
    screen.getByRole("button", { name: /Generate 3 shots/ }),
  ).toBeEnabled();
});
it("offers replacement generation for an already approved scene in the same dialog", () => {
  mount(["ep1-s1-q1", "ep1-s1-q2", "ep1-s1-q3"]);
  expect(
    screen.getByRole("button", { name: /Generate 0 shots/ }),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Regenerate approved takes" }),
  );
  expect(
    screen.getByRole("button", { name: "Generate 3 shots · 72 cr" }),
  ).toBeEnabled();
});
