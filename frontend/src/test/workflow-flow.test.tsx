import { beforeEach, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../app/App";
import { useStore } from "../stores/store";
import { useStudio, useSelection } from "../studio/selection";
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
function mount(path = "/projects/midnight/episodes/ep1") {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}
it("opens shot properties in place without a scene-page or approval chain", () => {
  mount();
  fireEvent.click(screen.getAllByRole("article")[0]);
  expect(screen.getByLabelText("Shot prompt")).toBeInTheDocument();
  expect(screen.getByLabelText("Look for Maya Chen")).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("builds a board from an edited screenplay without spending credits", () => {
  mount("/projects/midnight/episodes/ep3?view=script");
  const credits = useStore.getState().data.credits;
  const input = screen.getByLabelText("Episode screenplay");
  fireEvent.change(input, {
    target: { value: "INT. ROOM — NIGHT\nA phone rings." },
  });
  fireEvent.blur(input);
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh board from script · 0 cr" }),
  );
  expect(screen.getByRole("button", { name: "Board" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(useStore.getState().data.credits).toBe(credits);
});
it("invalidates footage after editing a prompt and allows undo without losing takes", () => {
  mount();
  fireEvent.click(screen.getAllByRole("article")[0]);
  const d = useStore.getState().data,
    shot = d.shots["ep1-s1-q1"],
    take = shot.currentTakeId,
    original = shot.action;
  const field = screen.getByLabelText("Shot prompt");
  fireEvent.change(field, {
    target: { value: "Maya quietly closes the door." },
  });
  fireEvent.blur(field);
  expect(useStore.getState().data.shots[shot.id].stale).toBe(true);
  fireEvent.keyDown(window, { key: "z", metaKey: true });
  expect(useStore.getState().data.shots[shot.id].action).toBe(original);
  expect(useStore.getState().data.shots[shot.id].currentTakeId).toBe(take);
});
it("shows ungenerated shots as timeline placeholders instead of blocking the editor", () => {
  mount("/projects/midnight/episodes/ep3?view=timeline");
  expect(screen.getByLabelText("Episode timeline")).toBeInTheDocument();
  expect(
    screen.getByLabelText("Timeline shot Establishing"),
  ).toBeInTheDocument();
  expect(
    screen.queryByText("Approve a result before editing this scene."),
  ).not.toBeInTheDocument();
});
it("opens a batch side panel with readiness fixes while keeping the board visible", () => {
  mount();
  fireEvent.click(
    screen.getAllByRole("button", { name: /Generate episode ·/ })[0],
  );
  expect(
    screen.getByRole("complementary", { name: "Batch generation" }),
  ).toHaveTextContent("Readiness");
  expect(screen.getAllByRole("article")).toHaveLength(12);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("shows every scene and shot without board pagination", () => {
  mount();
  expect(screen.getAllByRole("article")).toHaveLength(12);
  expect(screen.queryByLabelText("Scene pages")).not.toBeInTheDocument();
});
it("keeps legacy setup and edit deep links in the episode workspace", () => {
  mount("/projects/midnight/episodes/ep1/scenes/ep1-s2/edit");
  expect(screen.getByRole("button", { name: "Timeline" })).toBeInTheDocument();
});
it("shows generated media on shot cards and the inspector take stack", () => {
  mount();
  const cards = screen.getAllByRole("article");
  expect(
    within(cards[0]).getByAltText("Establishing thumbnail"),
  ).toHaveAttribute("src");
  fireEvent.click(cards[0]);
  expect(screen.getByAltText("Shot preview")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Use" }).length).toBeGreaterThan(
    0,
  );
});
