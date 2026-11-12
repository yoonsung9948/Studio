import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../app/App";
import { useStore } from "../stores/store";
import { useSelection, useStudio } from "../studio/selection";
class Pointer extends MouseEvent {
  pointerId = 1;
  pointerType = "mouse";
  isPrimary = true;
}
const rect = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
  x: left,
  y: top,
  toJSON: () => ({}),
});
beforeEach(() => {
  useStore.getState().reset();
  useSelection.getState().replace([]);
  useStudio.getState().set({
    navigation: false,
    activity: false,
    settings: false,
    account: false,
    palette: false,
  });
  vi.stubGlobal("PointerEvent", Pointer);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());
it.each([
  ["/work?mode=demo", "All work"],
  ["/projects/browse", "Project cards"],
  ["/projects/midnight/episodes", "Episode cards"],
  ["/projects/midnight/world", "World cards"],
  ["/projects/midnight/library", "Library cards"],
])("box-selects cards in %s without navigating", (route, name) => {
  render(
    <MemoryRouter initialEntries={[route]}>
      <App />
    </MemoryRouter>,
  );
  const root = screen.getByRole("group", { name });
  const cards = Array.from(
    root.querySelectorAll<HTMLElement>("[data-selection-key]"),
  );
  expect(cards.length).toBeGreaterThan(0);
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue(rect(0, 0, 600, 400));
  cards.forEach((card, i) =>
    vi
      .spyOn(card, "getBoundingClientRect")
      .mockReturnValue(rect(10 + i * 120, 20, 100, 100)),
  );
  fireEvent.pointerDown(cards[0], { button: 0, clientX: 20, clientY: 30 });
  fireEvent.pointerMove(document, { clientX: 235, clientY: 140 });
  expect(useSelection.getState().keys).toEqual(
    cards.slice(0, 2).map((c) => c.dataset.selectionKey),
  );
  fireEvent.pointerUp(document);
  fireEvent.click(cards[0]);
  expect(screen.getByRole("group", { name })).toBe(root);
  expect(useSelection.getState().keys).toHaveLength(Math.min(2, cards.length));
  expect(cards[0]).toHaveClass("is-selected");
});
it("keeps reference dragging on the dedicated World handle", () => {
  render(
    <MemoryRouter initialEntries={["/projects/midnight/world"]}>
      <App />
    </MemoryRouter>,
  );
  const card = screen.getByRole("article", { name: "Character Maya Chen" });
  expect(card).not.toHaveAttribute("draggable");
  const handle = within(card).getByRole("button", {
    name: "Drag Maya Chen as reference",
  });
  const setData = vi.fn();
  fireEvent.dragStart(handle, { dataTransfer: { setData } });
  expect(setData).toHaveBeenCalledWith(
    "application/dotori-world",
    expect.stringContaining('"kind":"character"'),
  );
  fireEvent.pointerDown(handle, { button: 0, clientX: 20, clientY: 30 });
  fireEvent.pointerMove(document, { clientX: 235, clientY: 140 });
  fireEvent.pointerUp(document);
  expect(useSelection.getState().keys).toEqual([]);
});

it("selects across the whole Home body without selecting clipped row cards", () => {
  render(
    <MemoryRouter initialEntries={["/work?mode=demo"]}>
      <App />
    </MemoryRouter>,
  );
  const body = screen.getByRole("group", { name: "Home content" });
  const recent = screen.getByRole("group", { name: "Recent work cards" });
  const projects = screen.getByRole("group", { name: "Projects cards" });
  const all = screen.getByRole("group", { name: "All work" });
  expect(body.querySelectorAll(".st-selection-surface")).toHaveLength(0);
  vi.spyOn(body, "getBoundingClientRect").mockReturnValue(rect(0, 0, 600, 400));
  const recentCard = within(recent).getAllByRole("article")[0];
  const [projectCard, hiddenCard] = within(projects).getAllByRole("article");
  const allCard = within(all).getAllByRole("article")[1];
  vi.spyOn(recentCard, "getBoundingClientRect").mockReturnValue(
    rect(20, 40, 100, 80),
  );
  vi.spyOn(projectCard, "getBoundingClientRect").mockReturnValue(
    rect(20, 160, 100, 80),
  );
  vi.spyOn(hiddenCard, "getBoundingClientRect").mockReturnValue(
    rect(350, 160, 100, 80),
  );
  vi.spyOn(allCard, "getBoundingClientRect").mockReturnValue(
    rect(20, 280, 100, 60),
  );
  projects.style.overflowX = "auto";
  Object.defineProperty(projects, "clientWidth", {
    configurable: true,
    value: 300,
  });
  vi.spyOn(projects, "getBoundingClientRect").mockReturnValue(
    rect(0, 160, 300, 80),
  );
  fireEvent.pointerDown(body, { button: 0, clientX: 5, clientY: 5 });
  fireEvent.pointerMove(document, { clientX: 500, clientY: 350 });
  expect(useSelection.getState().keys).toEqual([
    recentCard.dataset.selectionKey,
    projectCard.dataset.selectionKey,
    allCard.dataset.selectionKey,
  ]);
  expect(document.querySelectorAll(".st-selection-marquee")).toHaveLength(1);
  // The overlay must share the composer's studio stacking context, not cover it from body.
  expect(document.querySelector(".st-selection-marquee")?.parentElement).toBe(
    document.querySelector(".studio-shell"),
  );
  fireEvent.pointerUp(document);
  expect(document.querySelector(".st-selection-marquee")).toBeNull();
});
