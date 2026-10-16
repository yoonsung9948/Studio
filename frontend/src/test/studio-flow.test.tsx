import { beforeEach, it, expect } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ActionsProvider } from "../components/Actions";
import { CharacterLibrary } from "../features/characters/CharacterLibrary";
import { CharacterDetail } from "../features/characters/CharacterDetail";
import { useStore } from "../stores/store";
import { tick } from "../domain/commands";
import { characterReady } from "../domain/studio-selectors";
beforeEach(() => useStore.getState().reset());
it("creates, describes, generates, selects and approves a new character through the workspace", () => {
  render(
    <MemoryRouter initialEntries={["/projects/midnight/characters"]}>
      <ActionsProvider>
        <Routes>
          <Route
            path="/projects/:projectId/characters"
            element={<CharacterLibrary />}
          />
          <Route
            path="/projects/:projectId/characters/:characterId"
            element={<CharacterDetail />}
          />
        </Routes>
      </ActionsProvider>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Create Character" }));
  expect(
    screen.getByRole("heading", { name: "Untitled character" }),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Physical appearance"), {
    target: { value: "A reserved woman with shoulder-length black hair" },
  });
  fireEvent.blur(screen.getByLabelText("Physical appearance"));
  fireEvent.click(screen.getByRole("button", { name: "Generate Identity" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm · 24 demo credits" }),
  );
  act(() => {
    for (let i = 0; i < 40; i++) useStore.getState().mutate(tick);
  });
  expect(screen.getAllByRole("radio")).toHaveLength(3);
  fireEvent.click(screen.getByRole("radio", { name: "Select candidate 2" }));
  fireEvent.click(screen.getByRole("button", { name: "Approve selected" }));
  const d = useStore.getState().data,
    c = Object.values(d.characters).find(
      (c) => c.name === "Untitled character",
    )!;
  expect(characterReady(d, c.id)).toBe(true);
  expect(screen.getByText("Ready for scenes")).toBeInTheDocument();
});
