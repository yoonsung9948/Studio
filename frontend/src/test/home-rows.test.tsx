import { beforeEach, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../app/App";
import { createWorkspaceProject } from "../domain/workspace";
import { useStore } from "../stores/store";
import { useSelection, useStudio } from "../studio/selection";
beforeEach(() => {
  useStore.getState().reset();
  useSelection.getState().replace([]);
  useStudio.getState().set({
    activity: false,
    navigation: false,
    settings: false,
    account: false,
    palette: false,
  });
});
const mount = () =>
  render(
    <MemoryRouter initialEntries={["/work?mode=demo"]}>
      <App />
    </MemoryRouter>,
  );
it("caps both horizontal rows at twenty while retaining the full All work grid below", () => {
  useStore.getState().mutate((data) => {
    for (let i = 0; i < 23; i++) createWorkspaceProject(data, `Project ${i}`);
  });
  mount();
  const recent = screen.getByRole("region", { name: "Recent work" });
  const projects = screen.getByRole("region", { name: "Projects" });
  const all = screen.getByRole("group", { name: "All work" });
  expect(within(recent).getAllByRole("article")).toHaveLength(20);
  expect(within(projects).getAllByRole("article")).toHaveLength(20);
  expect(within(all).getAllByRole("article").length).toBeGreaterThan(20);
  expect(
    recent.compareDocumentPosition(projects) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    projects.compareDocumentPosition(all) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});
it("scrolls each row using its own side arrows and reflects the scroll boundaries", () => {
  mount();
  for (const label of ["Recent work", "Projects"]) {
    const root = screen.getByRole("group", { name: `${label} cards` });
    Object.defineProperties(root, {
      clientWidth: { configurable: true, value: 600 },
      scrollWidth: { configurable: true, value: 3000 },
    });
    const scrollBy = vi.fn();
    Object.defineProperty(root, "scrollBy", {
      configurable: true,
      value: scrollBy,
    });
    fireEvent.scroll(root);
    const left = screen.getByRole("button", { name: `Scroll ${label} left` });
    const right = screen.getByRole("button", { name: `Scroll ${label} right` });
    expect(left).toBeDisabled();
    expect(right).toBeEnabled();
    fireEvent.click(right);
    expect(scrollBy.mock.calls[0][0].left).toBeGreaterThan(0);
    root.scrollLeft = 1200;
    fireEvent.scroll(root);
    expect(left).toBeEnabled();
    fireEvent.click(left);
    expect(scrollBy.mock.calls[1][0].left).toBeLessThan(0);
    root.scrollLeft = 2400;
    fireEvent.scroll(root);
    expect(right).toBeDisabled();
  }
});
it("keeps duplicate work cards in sync and opens projects through the new row", () => {
  mount();
  const recent = screen.getByRole("group", { name: "Recent work cards" });
  const all = screen.getByRole("group", { name: "All work" });
  const card = within(recent).getAllByRole("article")[0];
  fireEvent.click(card);
  const key = card.getAttribute("data-selection-key");
  expect(all.querySelector(`[data-selection-key="${key}"]`)).toHaveClass(
    "is-selected",
  );
  const projects = screen.getByRole("group", { name: "Projects cards" });
  fireEvent.doubleClick(
    within(projects).getByRole("article", { name: "Project Midnight Secrets" }),
  );
  expect(screen.getByLabelText("Project name")).toHaveValue("Midnight Secrets");
});
