import { beforeEach, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../app/App";
import { useStore } from "../stores/store";
import { useSelection, useStudio } from "../studio/selection";
beforeEach(() => {
  useStore.getState().reset();
  useSelection.getState().replace([]);
  useStudio
    .getState()
    .set({
      view: "board",
      inspector: true,
      inspectorTab: "properties",
      activity: false,
    });
});
function mount(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}
it("lands on the whole episode board with visible shots", () => {
  mount("/projects/midnight/episodes/ep1");
  expect(screen.getByRole("button", { name: "Board" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getAllByRole("article").length).toBe(12);
  expect(screen.queryByLabelText("Toggle AI Director")).not.toBeInTheDocument();
});
it("keeps the screenplay mounted while opening the inspector Director", () => {
  mount("/projects/midnight/episodes/ep1?view=script");
  const script = screen.getByLabelText("Episode screenplay"),
    original = useStore.getState().data.episodes.ep1.script;
  fireEvent.click(screen.getByRole("button", { name: "AI Director" }));
  expect(
    screen.getByRole("heading", { name: "AI Director" }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Episode screenplay")).toBe(script);
  expect(useStore.getState().data.episodes.ep1.script).toBe(original);
});
it("redirects legacy scene links into the same episode workspace with scene selection", async () => {
  mount("/projects/midnight/episodes/ep1/scenes/ep1-s1");
  await waitFor(() =>
    expect(screen.getByLabelText("Scene title")).toHaveValue("The Arrival"),
  );
  expect(screen.getByRole("button", { name: "Board" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
it("honors legacy script and edit links as workspace views", () => {
  mount("/projects/midnight/episodes/ep1?tab=edit");
  expect(screen.getByLabelText("Episode timeline")).toBeInTheDocument();
});
