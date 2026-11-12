import { beforeEach, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../app/App";
import { useStore } from "../stores/store";
import { useStudio } from "../studio/selection";
import { installDirectorProject } from "../mocks/director-project";
import {
  generationInputs,
  generationInputSnapshot,
} from "../domain/generation-inputs";
import { dataSchema } from "../domain/schemas";
const sceneId = "letter-reunion",
  shotId = "letter-reunion-q1";
beforeEach(() => {
  useStore.getState().reset();
  useStore.getState().mutate(installDirectorProject);
  useStudio
    .getState()
    .set({ activity: false, settings: false, account: false, palette: false });
});
function mount() {
  render(
    <MemoryRouter
      initialEntries={[
        `/projects/last-letter/episodes/last-letter-ep3?stage=plan&scene=${sceneId}&shot=${shotId}&mode=demo`,
      ]}
    >
      <App />
    </MemoryRouter>,
  );
}
it("allows renaming the scene directly from its outline card", () => {
  mount();
  fireEvent.click(
    screen.getByRole("button", { name: "Edit scene title The reunion" }),
  );
  fireEvent.change(screen.getByLabelText("Scene title for The reunion"), {
    target: { value: "The return" },
  });
  fireEvent.blur(screen.getByLabelText("Scene title for The reunion"));
  expect(useStore.getState().data.scenes[sceneId].title).toBe("The return");
  expect(
    screen.getByRole("button", { name: "Edit scene title The return" }),
  ).toBeVisible();
});
it("persists shot direction and carries it from planning into Takes and the video prompt", () => {
  mount();
  const panel = within(
    screen.getByRole("region", { name: "Shot plan details" }),
  );
  fireEvent.click(panel.getByText("Camera & motion"));
  fireEvent.change(panel.getByLabelText("Camera movement"), {
    target: { value: "Push in" },
  });
  fireEvent.change(panel.getByLabelText("Camera speed"), {
    target: { value: "Slow and gentle" },
  });
  fireEvent.change(panel.getByLabelText("Take duration"), {
    target: { value: "8" },
  });
  fireEvent.change(panel.getByLabelText("Action timing"), {
    target: { value: "Slow and deliberate" },
  });
  fireEvent.click(panel.getByText("Performance & background"));
  fireEvent.change(panel.getByLabelText("Performance tone"), {
    target: { value: "Tense and guarded" },
  });
  fireEvent.change(panel.getByLabelText("Gaze direction"), {
    target: { value: "At the other character" },
  });
  fireEvent.change(panel.getByLabelText("Background motion"), {
    target: { value: "Rain rolls down the window." },
  });
  fireEvent.blur(panel.getByLabelText("Background motion"));
  fireEvent.change(panel.getByLabelText("Ending beat"), {
    target: { value: "Hold on her reaction." },
  });
  fireEvent.blur(panel.getByLabelText("Ending beat"));
  const data = useStore.getState().data;
  const restored = dataSchema.parse(data);
  expect(generationInputs(restored, sceneId, shotId).craft).toMatchObject({
    cameraSpeed: "Slow and gentle",
    actionTiming: "Slow and deliberate",
    performanceTone: "Tense and guarded",
    gazeDirection: "At the other character",
    environmentMotion: "Rain rolls down the window.",
    endingBeat: "Hold on her reaction.",
  });
  expect(generationInputs(restored, sceneId).craft.endingBeat).toBeUndefined();
  const prompt = generationInputSnapshot(
    restored,
    shotId,
    "video",
  ).instructions;
  for (const text of [
    "Video duration: 8 seconds",
    "Camera movement: Push in, slow and gentle",
    "Action timing: Slow and deliberate",
    "Performance: Tense and guarded",
    "Gaze: At the other character",
    "Background motion: Rain rolls down the window.",
    "End of take: Hold on her reaction.",
  ])
    expect(prompt).toContain(text);
  const frame = generationInputSnapshot(restored, shotId, "image").instructions;
  expect(frame).not.toContain("End of take:");
  expect(frame).not.toContain("Camera movement:");
  fireEvent.click(
    within(
      screen.getByRole("navigation", { name: "Production stages" }),
    ).getByRole("button", { name: "Takes" }),
  );
  expect(screen.getByLabelText("Camera movement")).toHaveValue("Push in");
  expect(screen.getByLabelText("Take duration")).toHaveValue("8");
  expect(
    generationInputs(useStore.getState().data, sceneId, shotId).craft,
  ).toMatchObject({
    performanceTone: "Tense and guarded",
    endingBeat: "Hold on her reaction.",
  });
});
it("keeps references accessible from the planning inspector", () => {
  mount();
  const panel = within(
    screen.getByRole("complementary", { name: "Scene planning inspector" }),
  );
  expect(
    panel.getByRole("heading", { name: "Characters" }),
  ).toBeInTheDocument();
  expect(panel.getByRole("heading", { name: "Location" })).toBeInTheDocument();
  expect(
    panel.getByRole("button", { name: "Create starting frames" }),
  ).toBeEnabled();
});
