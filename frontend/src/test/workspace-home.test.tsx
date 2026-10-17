import { beforeEach, expect, it } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../app/App";
import { useStore } from "../stores/store";
import { useStudio, useSelection } from "../studio/selection";
beforeEach(() => {
  useStore.getState().reset();
  useSelection.getState().replace([]);
  useStudio.getState().set({
    view: "board",
    inspector: true,
    inspectorTab: "properties",
    activity: false,
    navigation: false,
    outline: true,
    account: false,
  });
});
it("turns an idea into a populated board without spending credits", () => {
  const credits = useStore.getState().data.credits;
  render(
    <MemoryRouter initialEntries={["/projects"]}>
      <App />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText("Story idea"), {
    target: { value: "A stranger leaves a recording in an empty apartment." },
  });
  fireEvent.click(screen.getByRole("button", { name: /Create board · 0 cr/ }));
  expect(screen.getByRole("button", { name: "Board" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getAllByRole("article").length).toBeGreaterThan(0);
  expect(useStore.getState().data.credits).toBe(credits);
});
it("selects project cards before opening an explicit project hierarchy", () => {
  render(
    <MemoryRouter initialEntries={["/projects"]}>
      <App />
    </MemoryRouter>,
  );
  expect(
    screen.queryByRole("button", { name: "All work" }),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText("Home project filter")).toHaveValue("all");
  expect(
    screen.queryByRole("button", { name: "World" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Projects" }));
  const project = screen.getByRole("article", {
    name: "Project Midnight Secrets",
  });
  fireEvent.click(project);
  expect(project).toHaveClass("is-selected");
  expect(screen.queryByLabelText("Project name")).not.toBeInTheDocument();
  fireEvent.doubleClick(project);
  expect(useStudio.getState().navigation).toBe(false);
  expect(
    screen.getByRole("button", { name: "Expand navigation" }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Project name")).toHaveValue("Midnight Secrets");
  const hierarchy = screen.getByRole("navigation", {
    name: "Midnight Secrets navigation",
  });
  expect(
    within(hierarchy).getByRole("button", { name: "Episodes" }),
  ).toHaveAttribute("aria-current", "page");
  expect(
    screen.queryByRole("navigation", { name: "Project views" }),
  ).not.toBeInTheDocument();
  fireEvent.click(within(hierarchy).getByRole("button", { name: "World" }));
  expect(
    screen.getByRole("article", { name: "Character Maya Chen" }),
  ).toBeInTheDocument();
  expect(
    within(hierarchy).getByRole("button", { name: "World" }),
  ).toHaveAttribute("aria-current", "page");
  const rail = screen.getByRole("complementary", { name: "Studio navigation" });
  expect(within(rail).getAllByRole("button", { current: "page" })).toHaveLength(
    1,
  );
  fireEvent.click(screen.getByRole("button", { name: "Expand navigation" }));
  expect(within(rail).getAllByRole("button", { current: "page" })).toHaveLength(
    1,
  );
  expect(within(rail).getByRole("button", { name: "World" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});
it("expands navigation locally and leaves only account controls in the top banner", () => {
  render(
    <MemoryRouter initialEntries={["/projects"]}>
      <App />
    </MemoryRouter>,
  );
  const banner = screen.getByRole("banner", { name: "Account and credits" });
  expect(
    within(banner).getByRole("button", { name: "Account" }),
  ).toBeInTheDocument();
  expect(within(banner).getAllByRole("button")).toHaveLength(1);
  expect(
    within(banner).getByLabelText(/credits remaining/),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Expand navigation" }));
  expect(screen.getByRole("button", { name: "Projects" })).toBeInTheDocument();
  expect(
    screen.queryByRole("navigation", { name: "Project hierarchy" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "World" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Collapse navigation" }));
  expect(
    screen.queryByRole("navigation", { name: "Project hierarchy" }),
  ).not.toBeInTheDocument();
});
it("keeps the same profile actions after moving account to the top bar", () => {
  render(
    <MemoryRouter initialEntries={["/projects"]}>
      <App />
    </MemoryRouter>,
  );
  fireEvent.pointerDown(screen.getByRole("button", { name: "Account" }), {
    button: 0,
    ctrlKey: false,
  });
  expect(
    screen.getByRole("menuitem", { name: "Recharge credits" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("menuitem", { name: "Account settings" }));
  expect(screen.getByRole("dialog", { name: "Account" })).toBeInTheDocument();
});
it("creates one unfiled shot and finds it again in All work without spending credits", () => {
  const credits = useStore.getState().data.credits;
  render(
    <MemoryRouter initialEntries={["/projects"]}>
      <App />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText("Creation type"), {
    target: { value: "shot" },
  });
  fireEvent.change(screen.getByLabelText("Story idea"), {
    target: { value: "A red umbrella in the rain" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Create shot · 0 cr/ }));
  const d = useStore.getState().data;
  const ep = Object.values(d.episodes).find((e) => e.creationKind === "shot")!;
  expect(d.projects[ep.projectId].unfiled).toBe(true);
  expect(ep.sceneIds).toHaveLength(1);
  expect(d.scenes[ep.sceneIds[0]].shotIds).toHaveLength(1);
  expect(d.shots[d.scenes[ep.sceneIds[0]].shotIds[0]].targetFrames).toBe(150);
  expect(d.credits).toBe(credits);
  const navigation = screen.getByRole("complementary", {
    name: "Studio navigation",
  });
  expect(
    within(navigation).getByRole("button", { name: "Home" }),
  ).toHaveAttribute("aria-current", "page");
  expect(
    within(navigation).queryByRole("button", { name: "Episodes" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Home" }));
  fireEvent.change(screen.getByLabelText("Home project filter"), {
    target: { value: "unfiled" },
  });
  fireEvent.click(
    screen.getByRole("button", {
      name: "Open shot A red umbrella in the rain",
    }),
  );
  expect(screen.getByLabelText("Shot title")).toHaveValue(
    "A red umbrella in the rain",
  );
});
it("lets the episode outline open and close from its own workspace", () => {
  render(
    <MemoryRouter initialEntries={["/projects/midnight/episodes/ep1"]}>
      <App />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Hide outline" }));
  expect(
    screen.queryByText("Outline", { exact: true }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Show outline" }));
  expect(screen.getByText("Outline", { exact: true })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Board" })).toBeInTheDocument();
  expect(
    screen.getAllByRole("button", { name: /Generate episode ·/ })[0],
  ).toBeInTheDocument();
});
