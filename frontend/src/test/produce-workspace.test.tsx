import { beforeEach, expect, it } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../app/App";
import { useStore } from "../stores/store";
import { useStudio } from "../studio/selection";
import { createWorkspaceEpisode } from "../domain/workspace";
import { completeJob } from "../domain/commands";

let episodeId = "",
  shotId = "";
beforeEach(() => {
  useStore.getState().reset();
  useStudio
    .getState()
    .set({ activity: false, palette: false, account: false, settings: false });
  useStore.getState().mutate((data) => {
    episodeId = createWorkspaceEpisode(
      data,
      "midnight",
      "INT. CAFE — DUSK\nTwo friends exchange a letter.",
      5,
    );
    shotId = data.scenes[data.episodes[episodeId].sceneIds[0]].shotIds[0];
  });
});
function mount(query = "stage=plan") {
  return render(
    <MemoryRouter
      initialEntries={[`/projects/midnight/episodes/${episodeId}?${query}`]}
    >
      <App />
    </MemoryRouter>,
  );
}
it("presents one four-stage pipeline with planning and foundations, without legacy tabs or linking", () => {
  mount();
  const nav = within(
    screen.getByRole("navigation", { name: "Production stages" }),
  );
  expect(nav.getAllByRole("button")).toHaveLength(4);
  expect(screen.getByLabelText("Scene screenplay")).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Scene foundations" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("navigation", { name: "Workspace views" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("Link to shot")).not.toBeInTheDocument();
  expect(screen.getAllByText("Sample preview").length).toBeGreaterThan(0);
});
it("generates frames, chooses a frame, generates alternatives, then hands off a chosen take to the final cut", () => {
  mount();
  fireEvent.click(
    screen.getByRole("button", { name: "Create starting frames" }),
  );
  const generate = screen
    .getAllByRole("button", { name: /Generate.*frames/ })
    .at(-1)!;
  fireEvent.click(generate);
  act(() =>
    useStore.getState().mutate((data) => {
      const job = Object.values(data.jobs).find(
        (item) => item.shotId === shotId,
      )!;
      job.state = "running";
      completeJob(data, job.id);
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: /Use frame/ }));
  fireEvent.click(screen.getByRole("button", { name: "Direct video" }));
  expect(
    screen.getByRole("navigation", { name: "Take controls" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Generate.*more takes/ }));
  act(() =>
    useStore.getState().mutate((data) => {
      const job = Object.values(data.jobs).find(
        (item) => item.shotId === shotId && item.state === "queued",
      )!;
      job.state = "running";
      completeJob(data, job.id);
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: /Use take/ }));
  fireEvent.click(
    screen.getByRole("button", { name: "Continue to Final video" }),
  );
  expect(
    screen.getByRole("region", { name: "Final cut timeline" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Render final video" }),
  ).toBeEnabled();
});
it("flushes script edits on stage changes and returns to the same selected scene", () => {
  mount();
  fireEvent.change(screen.getByLabelText("Scene screenplay"), {
    target: { value: "INT. CAFE — DUSK\nMaya waits in silence." },
  });
  fireEvent.click(
    within(
      screen.getByRole("navigation", { name: "Production stages" }),
    ).getByRole("button", { name: "Shots" }),
  );
  fireEvent.click(
    within(
      screen.getByRole("navigation", { name: "Production stages" }),
    ).getByRole("button", { name: "Scene plan" }),
  );
  expect(screen.getByLabelText("Scene screenplay")).toHaveValue(
    "INT. CAFE — DUSK\nMaya waits in silence.",
  );
});

it("previews editable suggested shots, then confirms them without replacing existing coverage", () => {
  mount();
  const before = structuredClone(useStore.getState().data);
  const sceneId = before.shots[shotId].sceneId;
  fireEvent.click(screen.getByRole("button", { name: "Suggest shots" }));
  const preview = within(
    screen.getByRole("region", { name: "Suggested shot plan" }),
  );
  expect(
    preview.getAllByRole("button", { name: /Preview suggested shot/ }),
  ).toHaveLength(3);
  expect(useStore.getState().data).toEqual(before);
  fireEvent.change(preview.getByLabelText("Suggested shot title"), {
    target: { value: "Rainy arrival" },
  });
  fireEvent.change(preview.getByLabelText("Suggested shot duration"), {
    target: { value: "6" },
  });
  fireEvent.click(preview.getByRole("button", { name: "Confirm shots" }));
  const after = useStore.getState().data;
  expect(after.scenes[sceneId].shotIds).toHaveLength(
    before.scenes[sceneId].shotIds.length + 3,
  );
  expect(after.shots[shotId]).toEqual(before.shots[shotId]);
  const first =
    after.scenes[sceneId].shotIds[before.scenes[sceneId].shotIds.length];
  expect(after.shots[first]).toMatchObject({
    title: "Rainy arrival",
    targetFrames: 180,
  });
  expect(screen.getByLabelText("Shot title")).toHaveValue("Rainy arrival");
  expect(
    screen.queryByRole("region", { name: "Suggested shot plan" }),
  ).not.toBeInTheDocument();
});

it("discards suggested shots without changing saved scenes, shots or results", () => {
  mount();
  const before = structuredClone(useStore.getState().data);
  fireEvent.click(screen.getByRole("button", { name: "Suggest shots" }));
  fireEvent.change(screen.getByLabelText("Suggested shot action"), {
    target: { value: "Discard this draft" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Discard" }));
  expect(useStore.getState().data).toEqual(before);
  expect(
    screen.queryByRole("region", { name: "Suggested shot plan" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Suggest shots" })).toBeEnabled();
});

it("requires fresh suggestions if the scene changes before confirmation", () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Suggest shots" }));
  const sceneId = useStore.getState().data.shots[shotId].sceneId;
  const count = useStore.getState().data.scenes[sceneId].shotIds.length;
  act(() =>
    useStore.getState().mutate((data) => {
      data.scenes[sceneId].planRevision =
        (data.scenes[sceneId].planRevision ?? 1) + 1;
    }),
  );
  expect(screen.getByRole("button", { name: "Confirm shots" })).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent("This scene changed");
  expect(useStore.getState().data.scenes[sceneId].shotIds).toHaveLength(count);
});
