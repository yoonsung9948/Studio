import { beforeEach, expect, it } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
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
      navigation: false,
      activity: false,
      settings: false,
      account: false,
      palette: false,
    });
});
const mount = (url = "/projects/midnight/world") =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <App />
    </MemoryRouter>,
  );
it("selects visual cards, opens the full sheet, and returns to a filtered grid", () => {
  mount();
  expect(
    screen.getByRole("navigation", { name: "World categories" }),
  ).toHaveTextContent("Characters3Places1Props0Notes1");
  fireEvent.change(screen.getByLabelText("Search characters"), {
    target: { value: "Maya" },
  });
  const card = screen.getByRole("article", { name: "Character Maya Chen" });
  expect(within(card).getByText(/looks ·/)).toBeInTheDocument();
  fireEvent.click(card);
  expect(
    screen.getByRole("heading", { name: /Appears in/ }),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText("Appearance")).not.toBeInTheDocument();
  fireEvent.doubleClick(card);
  expect(screen.getByLabelText("Appearance")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Looks" })).toBeInTheDocument();
  const name = screen.getByLabelText("Name");
  fireEvent.change(name, { target: { value: "Maya Chen — lead" } });
  fireEvent.blur(name);
  fireEvent.click(screen.getByRole("button", { name: "Back to Characters" }));
  expect(screen.getByLabelText("Search characters")).toHaveValue("Maya");
  expect(
    screen.getByRole("article", { name: "Character Maya Chen — lead" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("article", { name: "Character Leo Hart" }),
  ).not.toBeInTheDocument();
});
it("keeps modifier selections and lets a selected card open through its explicit action", () => {
  mount();
  fireEvent.click(screen.getByRole("article", { name: "Character Maya Chen" }));
  fireEvent.click(
    screen.getByRole("article", { name: "Character Emma Wilson" }),
    { shiftKey: true },
  );
  expect(useSelection.getState().keys).toHaveLength(3);
  fireEvent.click(screen.getByRole("article", { name: "Character Leo Hart" }), {
    metaKey: true,
  });
  expect(useSelection.getState().keys).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Open Maya Chen" }));
  expect(screen.getByLabelText("Name")).toHaveValue("Maya Chen");
});
it("uses category-specific Add actions for places, props and notes", () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: /^Places/ }));
  expect(
    screen.getByRole("article", { name: "Place Apartment" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add place" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /^Props/ }));
  fireEvent.click(screen.getAllByRole("button", { name: "Add prop" })[0]);
  const name = screen.getByLabelText("Name");
  fireEvent.change(name, { target: { value: "Cassette recorder" } });
  fireEvent.blur(name);
  fireEvent.click(screen.getByRole("button", { name: "Back to Props" }));
  expect(
    screen.getByRole("article", { name: "Prop Cassette recorder" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /^Notes/ }));
  expect(
    screen.getByRole("article", { name: "Note Story notes" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Add note" }));
  expect(screen.getByLabelText("Name")).toHaveValue("Untitled note");
  expect(screen.getByLabelText("Description")).toBeInTheDocument();
});
it("keeps legacy character links opening the same editing sheet", () => {
  mount("/projects/midnight/characters/maya");
  expect(screen.getByLabelText("Name")).toHaveValue("Maya Chen");
  fireEvent.click(screen.getByRole("button", { name: "Back to Characters" }));
  expect(
    screen.getByRole("article", { name: "Character Maya Chen" }),
  ).toBeInTheDocument();
});
