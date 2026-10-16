import { beforeEach, expect, it } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ActionsProvider } from "../components/Actions";
import { EpisodePage } from "../features/Episode";
import { useStore } from "../stores/store";
import { prepareVideoGeneration } from "../domain/video-workflow";
import { enqueueGeneration, tick } from "../domain/commands";
import {
  generationInputs,
  saveGenerationInputs,
} from "../domain/generation-inputs";
import { shotsOfEpisode } from "../domain/selectors";
import { scenePreflight } from "../domain/scene-preflight";
import { updateScript } from "../domain/commands";
import { scriptApproved, scenePlanApproved } from "../domain/workflow";
import { generationInputSchema } from "../domain/studio-schemas";

beforeEach(() => useStore.getState().reset());
function freshEpisode() {
  useStore.getState().mutate((d) => {
    d.episodes.fresh = {
      ...d.episodes.ep1,
      id: "fresh",
      title: "A doorway",
      script: "INT. ROOM — NIGHT\nMaya opens the door.",
      scriptRevision: 1,
      scriptApprovedRevision: undefined,
      scriptHistory: [],
      sceneIds: [],
      targetSeconds: 15,
    };
    d.projects.midnight.episodeIds.push("fresh");
  });
}
function mount(id = "fresh") {
  render(
    <MemoryRouter
      initialEntries={[`/projects/midnight/episodes/${id}?tab=script`]}
    >
      <ActionsProvider>
        <Routes>
          <Route
            path="/projects/:projectId/episodes/:episodeId"
            element={<EpisodePage />}
          />
        </Routes>
      </ActionsProvider>
    </MemoryRouter>,
  );
}
it("creates an internal breakdown and queues videos directly from a script without image jobs", () => {
  freshEpisode();
  const credits = useStore.getState().data.credits;
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Generate episode" }));
  expect(useStore.getState().data.credits).toBe(credits);
  expect(
    useStore.getState().data.episodes.fresh.sceneIds.length,
  ).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: /Generate video ·/ }));
  const jobs = Object.values(useStore.getState().data.jobs).filter(
    (j) => j.episodeId === "fresh",
  );
  expect(jobs.length).toBeGreaterThan(0);
  expect(jobs.every((j) => j.operation === "video")).toBe(true);
  expect(credits - useStore.getState().data.credits).toBe(
    jobs.reduce((n, j) => n + j.cost, 0),
  );
  expect(
    screen.getByRole("heading", { name: "Scene plans" }),
  ).toBeInTheDocument();
});
it("preserves video selections through AI image creation, charges only for a requested image, and applies it per shot", () => {
  freshEpisode();
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Generate episode" }));
  const instructions = screen.getByLabelText("Generation instructions");
  fireEvent.change(instructions, { target: { value: "Hold the tension." } });
  fireEvent.blur(instructions);
  const frames = screen.getByRole("region", { name: "Frame conditioning" });
  fireEvent.click(within(frames).getAllByRole("button")[0]);
  fireEvent.click(
    screen.getAllByRole("button", { name: "Create image with AI" })[0],
  );
  expect(
    screen.getByRole("heading", { name: "AI Director" }),
  ).toBeInTheDocument();
  const credits = useStore.getState().data.credits;
  fireEvent.change(screen.getByLabelText("Image direction"), {
    target: { value: "A tight portrait beside the door." },
  });
  fireEvent.click(
    screen
      .getAllByRole("button", { name: /Generate image · 8 demo cr/ })
      .at(-1)!,
  );
  expect(useStore.getState().data.credits).toBe(credits - 8);
  act(() => {
    for (let i = 0; i < 50; i++) useStore.getState().mutate(tick);
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Use as starting frame" }),
  );
  expect(screen.getByLabelText("Generation instructions")).toHaveValue(
    "Hold the tension.",
  );
  const d = useStore.getState().data,
    shots = shotsOfEpisode(d, "fresh"),
    first = shots[0];
  const inputs = generationInputs(d, first.sceneId, first.id);
  expect(inputs.startingFrameAssetId).toBeTruthy();
  expect(
    shots
      .slice(1)
      .every((s) => !generationInputs(d, s.sceneId, s.id).startingFrameAssetId),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: /Generate video ·/ }));
  const job = Object.values(useStore.getState().data.jobs).find(
    (j) => j.shotId === first.id && j.operation === "video",
  )!;
  expect(generationInputSchema.parse(job.inputs).startingFrameAssetId).toBe(
    inputs.startingFrameAssetId,
  );
});
it("returning from image creation leaves conditioning unchanged", () => {
  freshEpisode();
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Generate episode" }));
  fireEvent.click(
    within(
      screen.getByRole("region", { name: "Frame conditioning" }),
    ).getAllByRole("button")[0],
  );
  fireEvent.click(
    screen.getAllByRole("button", { name: "Create image with AI" })[0],
  );
  fireEvent.click(screen.getByRole("button", { name: "Back to video" }));
  const d = useStore.getState().data;
  expect(
    shotsOfEpisode(d, "fresh").every(
      (s) => !generationInputs(d, s.sceneId, s.id).startingFrameAssetId,
    ),
  ).toBe(true);
});
it("rejects missing or cross-project conditioning without charging and snapshots valid start/end frames", () => {
  freshEpisode();
  useStore.getState().mutate((d) => prepareVideoGeneration(d, "fresh"));
  const d = structuredClone(useStore.getState().data),
    shot = shotsOfEpisode(d, "fresh")[0];
  const asset = Object.values(d.assets).find(
    (a) => a.kind === "image" && a.projectId === "midnight" && a.url,
  )!;
  expect(() =>
    saveGenerationInputs(
      d,
      shot.sceneId,
      { endingFrameAssetId: asset.id },
      shot.id,
    ),
  ).toThrow(/starting frame/);
  saveGenerationInputs(
    d,
    shot.sceneId,
    { startingFrameAssetId: asset.id, endingFrameAssetId: asset.id },
    shot.id,
  );
  const credits = d.credits;
  d.assets[asset.id].missing = true;
  expect(scenePreflight(d, shot.sceneId).ready).toBe(false);
  expect(() => enqueueGeneration(d, [shot.id])).toThrow(/conditioning frame/);
  expect(d.credits).toBe(credits);
});

it("uses a revised script directly while retaining scene IDs and existing footage", () => {
  const d = structuredClone(useStore.getState().data);
  const ids = [...d.episodes.ep1.sceneIds];
  const takeId = d.shots["ep1-s1-q1"].currentTakeId;
  updateScript(d, "ep1", "INT. APARTMENT — NIGHT\nMaya hears a new recording.");
  prepareVideoGeneration(d, "ep1", undefined, true);
  expect(scriptApproved(d.episodes.ep1)).toBe(true);
  expect(d.episodes.ep1.sceneIds).toEqual(ids);
  expect(ids.every((id) => scenePlanApproved(d, id))).toBe(true);
  expect(d.shots["ep1-s1-q1"].currentTakeId).toBe(takeId);
});
