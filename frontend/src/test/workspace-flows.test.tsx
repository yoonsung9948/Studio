// Removed-screen UI checks are replaced by produce-workspace and produce-navigation coverage.
import { beforeEach, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../app/App";
import { useStore } from "../stores/store";
import { useStudio, useSelection } from "../studio/selection";

import { tick } from "../domain/commands";
import { characterReady } from "../domain/studio-selectors";
beforeEach(() => {
  useStore.getState().reset();
  useSelection.getState().replace([]);
  useStudio.getState().set({
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

function finish() {
  act(() => {
    useStore.getState().mutate((d) => {
      for (let i = 0; i < 45; i++) tick(d);
    });
  });
}









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
  expect(
    screen.queryByRole("heading", { name: "Angles" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("group", { name: "Look cards" })).toBeInTheDocument();
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
