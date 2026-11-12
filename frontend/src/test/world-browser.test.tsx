import { beforeEach, expect, it } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../app/App";
import { useStore } from "../stores/store";
import { useSelection, useStudio } from "../studio/selection";
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

it("opens look cards and submits a look generation without changing the approved identity", () => {
  mount("/projects/midnight/world?kind=character&id=maya");
  const looks = screen.getByRole("region", { name: "Character looks" });
  expect(
    screen.queryByRole("heading", { name: "Angles" }),
  ).not.toBeInTheDocument();
  const card = within(looks).getByRole("article", {
    name: "Look Summer Casual",
  });
  expect(within(card).getByText("Front portrait")).toBeInTheDocument();
  fireEvent.click(card);
  expect(card).toHaveClass("is-selected");
  expect(screen.getByLabelText("Appearance")).toBeInTheDocument();
  fireEvent.doubleClick(card);
  expect(
    screen.getByLabelText("Look generation workspace"),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Looks" }),
  ).not.toBeInTheDocument();
  const prompt = screen.getByLabelText("Look prompt");
  const jobs = Object.keys(useStore.getState().data.jobs);
  const credits = useStore.getState().data.credits;
  fireEvent.change(prompt, {
    target: { value: "A linen jacket in warm light" },
  });
  expect(prompt).toHaveValue("A linen jacket in warm light");
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  const data = useStore.getState().data;
  expect(Object.keys(data.jobs)).toHaveLength(jobs.length + 1);
  expect(Object.values(data.jobs).at(-1)?.operation).toBe("look");
  expect(
    Object.values(data.studio.looks).find(
      (look) => look.name === "Summer Casual",
    )?.description,
  ).toBe("A linen jacket in warm light");
  expect(data.credits).toBeLessThan(credits);
  fireEvent.click(screen.getByRole("button", { name: "Go back" }));
  expect(
    screen.getByRole("article", { name: "Look Summer Casual" }),
  ).toBeInTheDocument();
});
it("adds an editable draft look card without an explicit angle card", () => {
  mount("/projects/midnight/world?kind=character&id=maya");
  fireEvent.click(screen.getByRole("button", { name: "Add Look" }));
  const card = screen.getByRole("article", { name: "Look Untitled Look" });
  expect(within(card).getByText("Front portrait")).toBeInTheDocument();
  expect(within(card).getByText("Draft")).toBeInTheDocument();
  const name = within(card).getByLabelText("Look name Untitled Look");
  fireEvent.change(name, { target: { value: "Travel" } });
  fireEvent.blur(name);
  expect(
    screen.getByRole("article", { name: "Look Travel" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Add angle" }),
  ).not.toBeInTheDocument();
});
it("does not open another character's look through a mismatched direct link", () => {
  mount("/projects/midnight/world/characters/leo/looks/maya-look-0");
  expect(screen.getByText("Look unavailable")).toBeInTheDocument();
  expect(screen.queryByLabelText("Look prompt")).not.toBeInTheDocument();
});
