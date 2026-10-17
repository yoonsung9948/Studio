import { beforeEach, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../app/App";
import { useStore } from "../stores/store";
import { useStudio } from "../studio/selection";
beforeEach(() => {
  useStore.getState().reset();
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
it("suppresses browser context menus, including in portals, while preserving app menus and cleans up on exit", () => {
  const { unmount } = render(
    <MemoryRouter initialEntries={["/projects/browse"]}>
      <App />
    </MemoryRouter>,
  );
  const blank = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
  });
  fireEvent(document.body, blank);
  expect(blank.defaultPrevented).toBe(true);
  fireEvent.contextMenu(
    screen.getByRole("article", { name: "Project Midnight Secrets" }),
  );
  expect(
    screen.getByRole("menuitem", { name: "Open Midnight Secrets" }),
  ).toBeInTheDocument();
  const menu = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
  });
  fireEvent(
    screen.getByRole("menuitem", { name: "Open Midnight Secrets" }),
    menu,
  );
  expect(menu.defaultPrevented).toBe(true);
  unmount();
  const outside = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
  });
  fireEvent(document.body, outside);
  expect(outside.defaultPrevented).toBe(false);
  expect(document.body).not.toHaveClass("studio-active");
});
