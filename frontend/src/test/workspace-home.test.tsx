// Removed-screen UI checks are replaced by produce-workspace and produce-navigation coverage.

import { beforeEach, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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



it("keeps the same profile actions after moving account to the top bar", () => {
  render(
    <MemoryRouter initialEntries={["/work?mode=demo"]}>
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




