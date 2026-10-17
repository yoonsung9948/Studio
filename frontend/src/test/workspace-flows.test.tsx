import { beforeEach, expect, it } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../app/App";
import { useStore } from "../stores/store";
import { useStudio, useSelection } from "../studio/selection";
import { createWorkspaceEpisode } from "../domain/workspace";
import { tick } from "../domain/commands";
import { characterReady } from "../domain/studio-selectors";
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
      settings: false,
      palette: false,
    });
});
function mount(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}
function fresh() {
  let id = "";
  useStore.getState().mutate((d) => {
    id = createWorkspaceEpisode(
      d,
      "midnight",
      "INT. ROOM — NIGHT\nA phone rings.",
      15,
    );
  });
  return id;
}
function finish() {
  act(() => {
    useStore.getState().mutate(d=>{for (let i = 0; i < 45; i++) tick(d);});
  });
}
it("creates a still then video on the same board, preserves previous takes and uses a selected take in Review", () => {
  const id = fresh();
  mount(`/projects/midnight/episodes/${id}`);
  const card = screen.getAllByRole("article")[0];
  const credits = useStore.getState().data.credits;
  fireEvent.click(
    within(card).getByRole("button", { name: "Generate · 8 cr" }),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(useStore.getState().data.credits).toBe(credits - 8);
  finish();
  expect(within(card).getByText("Still")).toBeInTheDocument();
  fireEvent.click(
    within(card).getByRole("button", { name: "Animate · 24 cr" }),
  );
  finish();
  expect(within(card).getByText("Video")).toBeInTheDocument();
  expect(within(card).getByText("New take")).toBeInTheDocument();
  fireEvent.click(card);
  const inspector = screen.getByRole("complementary", { name: "Inspector" });
  const takes = within(inspector).getAllByRole("button", { name: "Use" });
  fireEvent.click(takes[0]);
  const d = useStore.getState().data,
    shot = d.shots[d.scenes[d.episodes[id].sceneIds[0]].shotIds[0]];
  expect(shot.currentTakeId).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Review" }));
  expect(
    screen.getByLabelText("Scene preview; Space toggles playback"),
  ).toBeInTheDocument();
});
it("supports multi-select and batch generation with exact cost and no extra confirmation below 100", () => {
  const id = fresh();
  mount(`/projects/midnight/episodes/${id}`);
  const cards = screen.getAllByRole("article");
  fireEvent.click(cards[0]);
  fireEvent.click(cards[1], { metaKey: true });
  expect(useSelection.getState().keys.length).toBe(2);
  fireEvent.keyDown(window, { key: "g" });
  const batch = screen.getByRole("complementary", { name: "Batch generation" });
  expect(batch).toHaveTextContent("16 cr");
  const credits = useStore.getState().data.credits;
  fireEvent.click(
    within(batch).getByRole("button", { name: "Generate stills · 16 cr" }),
  );
  expect(useStore.getState().data.credits).toBe(credits - 16);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("keeps the same selection across views and exposes advanced frame controls only on request", () => {
  mount("/projects/midnight/episodes/ep1");
  fireEvent.click(screen.getAllByRole("article")[0]);
  const selection = [...useSelection.getState().keys];
  expect(
    screen.queryByRole("region", { name: "Frame conditioning" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
  expect(
    screen.getByRole("region", { name: "Frame conditioning" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Timeline" }));
  expect(screen.getByLabelText("Episode timeline")).toBeInTheDocument();
  expect(useSelection.getState().keys).toEqual(selection);
});
it("strict approvals expose a reason and fix while defaults submit without approval gates", () => {
  const id = fresh();
  useStore.getState().mutate((d) => {
    d.projects.midnight.strictApprovals = true;
  });
  mount(`/projects/midnight/episodes/${id}`);
  fireEvent.click(
    within(screen.getAllByRole("article")[0]).getByRole("button", {
      name: "Generate · 8 cr",
    }),
  );
  const batch = screen.getByRole("complementary", { name: "Batch generation" });
  expect(batch).toHaveTextContent("Approve this scene plan");
  expect(
    within(batch).getByRole("button", { name: "Approve source" }),
  ).toBeInTheDocument();
});
it("confirms batches over 100 credits without spending on preview", () => {
  let id = "";
  useStore.getState().mutate((d) => {
    id = createWorkspaceEpisode(
      d,
      "midnight",
      "INT. ROOM — NIGHT\nA phone rings.",
      90,
    );
  });
  mount(`/projects/midnight/episodes/${id}`);
  fireEvent.click(
    screen.getAllByRole("button", { name: /Generate episode ·/ })[0],
  );
  const credits = useStore.getState().data.credits;
  const batch = screen.getByRole("complementary", { name: "Batch generation" });
  fireEvent.change(within(batch).getByLabelText("Batch operation"), {
    target: { value: "video" },
  });
  fireEvent.click(
    within(batch).getByRole("button", { name: "Animate · 216 cr" }),
  );
  expect(useStore.getState().data.credits).toBe(credits);
  fireEvent.click(screen.getByRole("button", { name: "Confirm · 216 cr" }));
  expect(useStore.getState().data.credits).toBe(credits - 216);
});

it("shows, cancels and retries work in the Activity tray", () => {
  const id = fresh();
  mount(`/projects/midnight/episodes/${id}`);
  fireEvent.click(
    within(screen.getAllByRole("article")[0]).getByRole("button", {
      name: "Generate · 8 cr",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Activity" }));
  const tray = screen.getByRole("region", { name: "Activity tray" });
  fireEvent.click(within(tray).getByRole("button", { name: "Cancel" }));
  expect(
    within(tray).getByRole("button", { name: "Retry · 8 cr" }),
  ).toBeInTheDocument();
  fireEvent.click(within(tray).getByRole("button", { name: "Retry · 8 cr" }));
  expect(
    within(tray).getByRole("button", { name: "Cancel" }),
  ).toBeInTheDocument();
});
it("creates a character and uses an identity image in one sheet", () => {
  mount("/projects/midnight/world");
  fireEvent.click(screen.getByRole("button", { name: "Add character" }));
  const appearance = screen.getByLabelText("Appearance");
  fireEvent.change(appearance, {
    target: { value: "Short dark hair, green jacket, thoughtful eyes." },
  });
  fireEvent.blur(appearance);
  fireEvent.click(
    screen.getByRole("button", { name: "Generate identity · 24 cr" }),
  );
  finish();
  fireEvent.click(screen.getAllByRole("button", { name: "Use image" })[0]);
  const character = Object.values(useStore.getState().data.characters).find(
    (c) => c.name === "Untitled character",
  )!;
  expect(characterReady(useStore.getState().data, character.id)).toBe(true);
  expect(screen.getByRole("heading", { name: "Looks" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Angles" })).toBeInTheDocument();
});
it("links World usage to shots and marks affected footage for update", () => {
  mount("/projects/midnight/world?id=maya&kind=character");
  expect(
    screen.getByRole("heading", { name: /Appears in/ }),
  ).toBeInTheDocument();
  const shot = useStore.getState().data.shots["ep1-s1-q1"],
    revision = shot.revision;
  fireEvent.click(
    screen.getByRole("button", { name: "Update affected shots" }),
  );
  expect(useStore.getState().data.shots[shot.id].revision).toBeGreaterThan(
    revision,
  );
});
