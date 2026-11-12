import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { MouseHistoryNavigation } from "../app/MouseHistoryNavigation";

function Location() {
  return <output>{useLocation().pathname}</output>;
}

function press(button: number) {
  fireEvent.mouseDown(window, { button });
  fireEvent.mouseUp(window, { button });
  fireEvent(window, new MouseEvent("auxclick", { button, cancelable: true }));
}

describe("mouse history navigation", () => {
  it("navigates back and forward exactly once per thumb-button press", () => {
    render(
      <MemoryRouter
        initialEntries={["/projects", "/projects/browse", "/library"]}
        initialIndex={2}
      >
        <MouseHistoryNavigation />
        <Location />
      </MemoryRouter>,
    );
    press(3);
    expect(screen.getByRole("status")).toHaveTextContent("/projects/browse");
    press(4);
    expect(screen.getByRole("status")).toHaveTextContent("/library");
    press(0);
    press(1);
    press(2);
    expect(screen.getByRole("status")).toHaveTextContent("/library");
  });

  it("cancels native history handling and removes listeners on unmount", () => {
    const view = render(
      <MemoryRouter>
        <MouseHistoryNavigation />
      </MemoryRouter>,
    );
    for (const type of ["mousedown", "mouseup", "auxclick"]) {
      const event = new MouseEvent(type, { button: 3, cancelable: true });
      fireEvent(window, event);
      expect(event.defaultPrevented).toBe(true);
    }
    const normal = new MouseEvent("auxclick", { button: 1, cancelable: true });
    fireEvent(window, normal);
    expect(normal.defaultPrevented).toBe(false);
    view.unmount();
    const after = new MouseEvent("mouseup", { button: 3, cancelable: true });
    fireEvent(window, after);
    expect(after.defaultPrevented).toBe(false);
  });
});
