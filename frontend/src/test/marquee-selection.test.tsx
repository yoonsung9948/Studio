import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SelectionSurface } from "../studio/SelectionSurface";
import { useSelection } from "../studio/selection";
class Pointer extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly isPrimary: boolean;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? "mouse";
    this.isPrimary = init.isPrimary ?? true;
  }
}
const rect = (x: number, y: number, w: number, h: number) => ({
  x,
  y,
  left: x,
  top: y,
  right: x + w,
  bottom: y + h,
  width: w,
  height: h,
  toJSON() {
    return {};
  },
});
beforeEach(() => {
  useSelection.getState().replace([]);
  vi.stubGlobal("PointerEvent", Pointer);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());
function board() {
  render(
    <SelectionSurface aria-label="Test board">
      <article
        data-selection-key="shot:a"
        onClick={() => useSelection.getState().replace(["shot:a"])}
      >
        <p>Alpha</p>
      </article>
      <article data-selection-key="shot:b">Beta</article>
      <article data-selection-key="shot:c">Gamma</article>
      <input aria-label="Prompt" defaultValue="Editable text" />
      <button className="drag-handle">Reorder</button>
      <button data-no-marquee>Resize</button>
    </SelectionSurface>,
  );
  const root = screen.getByRole("group", { name: "Test board" }),
    items = screen.getAllByRole("article");
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue(rect(0, 0, 400, 250));
  items.forEach((item, i) =>
    vi
      .spyOn(item, "getBoundingClientRect")
      .mockReturnValue(rect(10 + i * 120, 20, 100, 100)),
  );
  return root;
}
const down = (node: Element, extra: PointerEventInit = {}) =>
  fireEvent.pointerDown(node, {
    button: 0,
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    ...extra,
  });
const move = (x: number, y: number) =>
  fireEvent.pointerMove(document, { pointerId: 1, clientX: x, clientY: y });
it("drags from card text to select intersecting cards and keeps the ending click from replacing the selection", () => {
  board();
  down(screen.getByText("Alpha"), { clientX: 20, clientY: 30 });
  move(230, 140);
  expect(useSelection.getState().keys).toEqual(["shot:a", "shot:b"]);
  expect(document.querySelector(".st-selection-marquee")).toBeInTheDocument();
  fireEvent.pointerUp(document, { pointerId: 1 });
  fireEvent.click(screen.getByText("Alpha"));
  expect(useSelection.getState().keys).toEqual(["shot:a", "shot:b"]);
  expect(
    document.querySelector(".st-selection-marquee"),
  ).not.toBeInTheDocument();
});
it("adds to the existing selection with modifiers and restores it when Escape cancels", () => {
  const root = board();
  useSelection.getState().replace(["shot:c"]);
  down(root, { shiftKey: true });
  move(240, 140);
  expect(useSelection.getState().keys).toEqual(["shot:c", "shot:a", "shot:b"]);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(useSelection.getState().keys).toEqual(["shot:c"]);
  expect(
    document.querySelector(".st-selection-marquee"),
  ).not.toBeInTheDocument();
});
it("keeps a normal click below the drag threshold and allows blank-area deselection", () => {
  const root = board();
  down(screen.getByText("Alpha"), { clientX: 20, clientY: 30 });
  move(22, 32);
  fireEvent.pointerUp(document, { pointerId: 1 });
  fireEvent.click(screen.getByText("Alpha"));
  expect(useSelection.getState().keys).toEqual(["shot:a"]);
  expect(
    document.querySelector(".st-selection-marquee"),
  ).not.toBeInTheDocument();
  fireEvent.click(root);
  expect(useSelection.getState().keys).toEqual([]);
});
it("leaves text fields, reorder handles, resize controls, and touch scrolling out of box selection", () => {
  const root = board();
  useSelection.getState().replace(["shot:c"]);
  for (const target of [
    screen.getByLabelText("Prompt"),
    screen.getByRole("button", { name: "Reorder" }),
    screen.getByRole("button", { name: "Resize" }),
  ]) {
    down(target);
    move(240, 140);
    fireEvent.pointerUp(document, { pointerId: 1 });
  }
  down(root, { pointerType: "touch" });
  move(240, 140);
  fireEvent.pointerUp(document, { pointerId: 1 });
  expect(useSelection.getState().keys).toEqual(["shot:c"]);
  expect(
    document.querySelector(".st-selection-marquee"),
  ).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Prompt"), {
    target: { value: "Still editable" },
  });
  expect(screen.getByLabelText("Prompt")).toHaveValue("Still editable");
});
it("scrolls the panel near its edge while selecting and stops when the pointer is released", () => {
  const root = board();
  root.style.overflow = "auto";
  Object.defineProperties(root, {
    clientHeight: { value: 250 },
    scrollHeight: { value: 600 },
    clientWidth: { value: 400 },
    scrollWidth: { value: 400 },
  });
  let next: FrameRequestCallback | undefined;
  vi.mocked(requestAnimationFrame).mockImplementation((callback) => {
    next = callback;
    return 1;
  });
  down(root);
  move(200, 245);
  fireEvent.pointerMove(document, { pointerId: 1, clientX: 200, clientY: 245 });
  next?.(0);
  expect(root.scrollTop).toBeGreaterThan(0);
  fireEvent.pointerUp(document, { pointerId: 1 });
  expect(cancelAnimationFrame).toHaveBeenCalled();
});
