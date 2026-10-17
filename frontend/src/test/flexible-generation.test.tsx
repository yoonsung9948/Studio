import { beforeEach, expect, it } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../app/App";
import { useStore } from "../stores/store";
import { useStudio, useSelection } from "../studio/selection";
import { createWorkspaceEpisode } from "../domain/workspace";
import { prepareVideoGeneration } from "../domain/video-workflow";
import { enqueueGeneration, tick, updateScript } from "../domain/commands";
import {
  generationInputs,
  saveGenerationInputs,
} from "../domain/generation-inputs";
import { shotsOfEpisode } from "../domain/selectors";
import { scenePreflight } from "../domain/scene-preflight";
import { scriptApproved, scenePlanApproved } from "../domain/workflow";
beforeEach(() => {
  useStore.getState().reset();
  useSelection.getState().replace([]);
  useStudio
    .getState()
    .set({
      view: "board",
      activity: false,
      inspector: true,
      inspectorTab: "properties",
      palette: false,
      settings: false,
    });
});
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
function mountFresh() {
  let id = "";
  useStore.getState().mutate((d) => {
    id = createWorkspaceEpisode(
      d,
      "midnight",
      "INT. ROOM — NIGHT\nMaya opens the door.",
      15,
    );
  });
  render(
    <MemoryRouter initialEntries={[`/projects/midnight/episodes/${id}`]}>
      <App />
    </MemoryRouter>,
  );
  return id;
}
function openFrames() {
  fireEvent.click(screen.getAllByRole("article")[0]);
  fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
  fireEvent.click(
    within(
      screen.getByRole("region", { name: "Frame conditioning" }),
    ).getAllByRole("button")[0],
  );
  fireEvent.click(
    screen.getAllByRole("button", { name: "Create image with AI" })[0],
  );
}
it("allows direct video from the batch operation without requiring stills", () => {
  const id = mountFresh();
  const credits = useStore.getState().data.credits;
  fireEvent.click(
    screen.getAllByRole("button", { name: /Generate episode ·/ })[0],
  );
  const batch = screen.getByRole("complementary", { name: "Batch generation" });
  fireEvent.change(within(batch).getByLabelText("Batch operation"), {
    target: { value: "video" },
  });
  fireEvent.click(
    within(batch).getByRole("button", { name: "Animate · 72 cr" }),
  );
  const jobs = Object.values(useStore.getState().data.jobs).filter(
    (j) => j.episodeId === id,
  );
  expect(jobs).toHaveLength(3);
  expect(jobs.every((j) => j.operation === "video")).toBe(true);
  expect(useStore.getState().data.credits).toBe(credits - 72);
});
it("preserves shot inputs through image creation and attaches only to the selected shot", () => {
  const id = mountFresh();
  openFrames();
  const credits = useStore.getState().data.credits;
  fireEvent.change(screen.getByLabelText("Image direction"), {
    target: { value: "Close-up beside the doorway." },
  });
  fireEvent.click(
    screen
      .getAllByRole("button", { name: /Generate image · 8 demo cr/ })
      .at(-1)!,
  );
  act(() => {
    useStore.getState().mutate(d=>{for (let i = 0; i < 45; i++) tick(d);});
  });
  expect(useStore.getState().data.credits).toBe(credits - 8);
  fireEvent.click(
    screen.getByRole("button", { name: "Use as starting frame" }),
  );
  const d = useStore.getState().data,
    shots = shotsOfEpisode(d, id);
  expect(
    generationInputs(d, shots[0].sceneId, shots[0].id).startingFrameAssetId,
  ).toBeTruthy();
  expect(
    shots
      .slice(1)
      .every((s) => !generationInputs(d, s.sceneId, s.id).startingFrameAssetId),
  ).toBe(true);
  expect(screen.getByLabelText("Shot prompt")).toBeInTheDocument();
});
it("returning from image creation leaves conditioning unchanged", () => {
  const id = mountFresh();
  openFrames();
  fireEvent.click(screen.getByRole("button", { name: "Back to video" }));
  const d = useStore.getState().data;
  expect(
    shotsOfEpisode(d, id).every(
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
