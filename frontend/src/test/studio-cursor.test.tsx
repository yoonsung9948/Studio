import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { ApplicationCursor as Cursor } from "../app/ApplicationCursor";
class Pointer extends MouseEvent {
  pointerId: number;
  pointerType: string;
  isPrimary: boolean;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? "mouse";
    this.isPrimary = init.isPrimary ?? true;
  }
}
afterEach(() => vi.unstubAllGlobals());
it("uses the bright cursor only while pressed and resets on cancel, blur and unmount", () => {
  vi.stubGlobal("PointerEvent", Pointer);
  const { unmount } = render(<Cursor />);
  const pressed = () => document.body.classList.contains("st-cursor-pressed");
  fireEvent.pointerDown(document.body, { button: 0 });
  expect(pressed()).toBe(true);
  fireEvent.pointerUp(document.body);
  expect(pressed()).toBe(false);
  fireEvent.pointerDown(document.body, { button: 0 });
  fireEvent.pointerCancel(document.body);
  expect(pressed()).toBe(false);
  fireEvent.pointerDown(document.body, { button: 0 });
  fireEvent.blur(window);
  expect(pressed()).toBe(false);
  fireEvent.pointerDown(document.body, { button: 0 });
  unmount();
  expect(pressed()).toBe(false);
});
it("ignores touch, secondary buttons and unrelated pointer releases", () => {
  vi.stubGlobal("PointerEvent", Pointer);
  render(<Cursor />);
  fireEvent.pointerDown(document.body, { button: 0, pointerType: "touch" });
  fireEvent.pointerDown(document.body, { button: 2 });
  expect(document.body).not.toHaveClass("st-cursor-pressed");
  fireEvent.pointerDown(document.body, { button: 0, pointerId: 1 });
  fireEvent.pointerUp(document.body, { pointerId: 2 });
  expect(document.body).toHaveClass("st-cursor-pressed");
  fireEvent.pointerUp(document.body, { pointerId: 1 });
  expect(document.body).not.toHaveClass("st-cursor-pressed");
});
