// Removed-screen UI checks are replaced by produce-workspace and produce-navigation coverage.
import { beforeEach, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../app/App";
import { useStore } from "../stores/store";
import { useSelection, useStudio } from "../studio/selection";
import { installDirectorProject } from "../mocks/director-project";
import {
  applySceneSuggestion,
  proposeSceneAssistance,
} from "../domain/scene-assistance";
import { dataSchema } from "../domain/schemas";

import { changeScene } from "../domain/workspace";

beforeEach(() => {
  useStore.getState().reset();
  useStore.getState().mutate(installDirectorProject);
  useSelection.getState().replace([]);
  useStudio.getState().set({
    activity: false,
    settings: false,
    account: false,
    palette: false,
    view: "board",
    inspector: false,
  });
});
function mount(
  path = "/projects/last-letter/episodes/last-letter-ep3/shots/letter-reunion-q1?stage=scene",
) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

it("adds suggested coverage while preserving locked shots and approved takes", () => {
  const data = structuredClone(useStore.getState().data);
  data.shots["letter-reunion-q1"].locked = true;
  const before = structuredClone(data.shots["letter-reunion-q1"]);
  const take = structuredClone(data.takes[before.imageTakeId!]);
  const proposal = proposeSceneAssistance(data, "letter-reunion");
  applySceneSuggestion(data, proposal, "shots");
  expect(data.scenes["letter-reunion"].shotIds).toHaveLength(
    3 + proposal.shots.length,
  );
  expect(data.shots[before.id]).toEqual(before);
  expect(data.takes[take.id]).toEqual(take);
  expect(dataSchema.safeParse(data).success).toBe(true);
});

it("rejects an AI proposal when the source scene changed during review", () => {
  const data = structuredClone(useStore.getState().data);
  const proposal = proposeSceneAssistance(data, "letter-reunion");
  changeScene(data, "letter-reunion", { description: "A revised scene." });
  expect(() => applySceneSuggestion(data, proposal, "enhance")).toThrow(
    /scene changed/,
  );
  expect(data.scenes["letter-reunion"].screenplay).not.toContain(
    "VISUAL DIRECTION",
  );
});

it("keeps the shared shell while editing persistent workspace preferences", () => {
  mount();
  const header = screen.getByRole("banner", { name: "Account and credits" });
  fireEvent.click(
    screen.getByRole("button", { name: "Settings & preferences" }),
  );
  expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
  expect(screen.getByRole("banner", { name: "Account and credits" })).toBe(
    header,
  );
  fireEvent.click(screen.getByRole("button", { name: "Light" }));
  fireEvent.click(screen.getByRole("switch", { name: "Reduce motion" }));
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(document.documentElement.dataset.reducedMotion).toBe("true");
  expect(useStore.getState().ui).toMatchObject({
    theme: "light",
    reducedMotion: true,
  });
  expect(screen.getByLabelText("Policy production")).toHaveValue("last-letter");
  fireEvent.click(
    screen.getByRole("switch", { name: "Strict script and plan approvals" }),
  );
  expect(useStore.getState().data.projects["last-letter"].strictApprovals).toBe(
    true,
  );
});

it("opens the global library with real assets and a production filter", () => {
  mount("/library");
  const cards = screen.getByRole("group", { name: "Library cards" });
  expect(within(cards).getAllByRole("article").length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: "Upload" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Library production"), {
    target: { value: "last-letter" },
  });
  expect(screen.getByRole("button", { name: "Upload" })).toBeEnabled();
  for (const card of within(cards).getAllByRole("article")) {
    const id = card.getAttribute("data-selection-key")!.slice(6);
    expect(useStore.getState().data.assets[id].projectId).toBe("last-letter");
  }
});

it("requires review of an idea before creating a production", () => {
  mount("/projects?mode=demo");
  const before = Object.keys(useStore.getState().data.projects);
  fireEvent.change(screen.getByLabelText("Story idea"), {
    target: { value: "A late train brings two friends together." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Start a film" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("Review your film");
  expect(Object.keys(useStore.getState().data.projects)).toEqual(before);
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByLabelText("Story idea")).toHaveValue(
    "A late train brings two friends together.",
  );
});
