import { beforeEach, expect, it } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../app/App";
import { useStore } from "../stores/store";
import { useStudio } from "../studio/selection";
beforeEach(() => {
  useStore.getState().reset();
  useStudio.getState().set({ activity: false, settings: false, account: false, palette: false });
});
const base = "/projects/midnight/episodes/ep1";
const mount = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
it.each([
  ["/projects?mode=demo", "Home"], ["/assets", "Assets"],
  [`${base}?stage=plan`, "Produce"], [`${base}?stage=shots`, "Produce"],
  [`${base}?stage=takes`, "Produce"], [`${base}?stage=final`, "Produce"],
  [`${base}/references`, "References"], [`${base}/media`, "Media"],
])("preserves shared chrome and active navigation at %s", (path, active) => {
  mount(path);
  const sidebar = screen.getByRole("complementary", { name: "Studio navigation" });
  for (const name of ["Home", "Activity", "Settings & preferences"])
    expect(within(sidebar).getByRole("button", { name })).toBeInTheDocument();
  const header = screen.getByRole("banner", { name: "Account and credits" });
  for (const name of ["Notifications", "Account"])
    expect(within(header).getByRole("button", { name })).toBeInTheDocument();
  expect(within(header).getByRole("button", { name: /credits remaining/ })).toBeInTheDocument();
  expect(within(sidebar).getByRole("button", { name: active })).toHaveAttribute("aria-current", "page");
});
it("keeps the same header and sidebar across all Produce stages", () => {
  mount(base);
  const header = screen.getByRole("banner", { name: "Account and credits" });
  const sidebar = screen.getByRole("complementary", { name: "Studio navigation" });
  const stages = screen.getByRole("navigation", { name: "Production stages" });
  for (const name of ["Shots", "Takes", "Final video", "Scene plan"]) {
    fireEvent.click(within(stages).getByRole("button", { name }));
    expect(screen.getByRole("banner", { name: "Account and credits" })).toBe(header);
    expect(screen.getByRole("complementary", { name: "Studio navigation" })).toBe(sidebar);
  }
});
it("keeps Activity open across navigation without opening it on Media entry", () => {
  mount(`${base}?mode=demo&stage=plan`);
  fireEvent.click(screen.getByRole("button", { name: /^Media$/ }));
  expect(useStudio.getState().activity).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
  const tray = screen.getByRole("region", { name: "Activity tray" });
  fireEvent.click(screen.getByRole("button", { name: /^Produce$/ }));
  expect(screen.getByRole("region", { name: "Activity tray" })).toBe(tray);
  fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
  expect(useStudio.getState().activity).toBe(false);
});
