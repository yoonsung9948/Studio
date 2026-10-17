import {
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useSelection, type EntityKey } from "./selection";

type Rect = { left: number; top: number; right: number; bottom: number };
type Gesture = {
  pointerId: number;
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  active: boolean;
  additive: boolean;
  initial: EntityKey[];
  scrolls: { node: HTMLElement; left: number; top: number }[];
};
const interactive =
  'button,a,input,textarea,select,[contenteditable="true"],[role="button"],[role="slider"],[role="menuitem"],.drag-handle,[data-no-marquee]';
const intersects = (a: Rect, b: Rect) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/** Desktop box selection, isolated from editing fields and drag/resize handles. */
export function SelectionSurface({
  children,
  scrollRef,
  className = "",
  ...props
}: ComponentPropsWithoutRef<"div"> & {
  scrollRef?: RefObject<HTMLDivElement | null>;
}) {
  const surface = useRef<HTMLDivElement>(null),
    gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false),
    resetClick = useRef<number | undefined>(undefined);
  const [box, setBox] = useState<Rect | null>(null);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      const g = gesture.current,
        root = surface.current;
      if (!g?.active || !root) return;
      const x =
        g.x - g.scrolls.reduce((n, s) => n + s.node.scrollLeft - s.left, 0);
      const y =
        g.y - g.scrolls.reduce((n, s) => n + s.node.scrollTop - s.top, 0);
      const rect = {
        left: Math.min(x, g.lastX),
        top: Math.min(y, g.lastY),
        right: Math.max(x, g.lastX),
        bottom: Math.max(y, g.lastY),
      };
      const hits = Array.from(
        root.querySelectorAll<HTMLElement>("[data-selection-key]"),
      )
        .filter((node) => intersects(rect, node.getBoundingClientRect()))
        .map((node) => node.dataset.selectionKey as EntityKey);
      const keys = Array.from(
        new Set(g.additive ? [...g.initial, ...hits] : hits),
      );
      const current = useSelection.getState().keys;
      if (
        keys.length !== current.length ||
        keys.some((key, i) => key !== current[i])
      )
        useSelection.getState().replace(keys);
      const viewport = {
        left: 0,
        top: 0,
        right: window.innerWidth,
        bottom: window.innerHeight,
      };
      // Clip the overlay to the visible panel, including any scrolling ancestors.
      for (const node of [root, ...g.scrolls.map((s) => s.node)]) {
        const r = node.getBoundingClientRect();
        viewport.left = Math.max(viewport.left, r.left);
        viewport.top = Math.max(viewport.top, r.top);
        viewport.right = Math.min(viewport.right, r.right);
        viewport.bottom = Math.min(viewport.bottom, r.bottom);
      }
      const next = {
        left: Math.max(rect.left, viewport.left),
        top: Math.max(rect.top, viewport.top),
        right: Math.min(rect.right, viewport.right),
        bottom: Math.min(rect.bottom, viewport.bottom),
      };
      setBox((previous) =>
        previous &&
        Object.keys(next).every(
          (key) => previous[key as keyof Rect] === next[key as keyof Rect],
        )
          ? previous
          : next,
      );
    };
    const scroll = () => {
      const g = gesture.current;
      if (!g?.active) return;
      // Keep selecting when the pointer reaches a scrollable panel's edge.
      const speed = (p: number, min: number, max: number) =>
        p < min + 28
          ? -Math.ceil((min + 28 - p) / 4)
          : p > max - 28
            ? Math.ceil((p - max + 28) / 4)
            : 0;
      for (const s of g.scrolls) {
        const r = s.node.getBoundingClientRect();
        if (
          g.lastX < r.left - 28 ||
          g.lastX > r.right + 28 ||
          g.lastY < r.top - 28 ||
          g.lastY > r.bottom + 28
        )
          continue;
        const dx = speed(g.lastX, r.left, r.right),
          dy = speed(g.lastY, r.top, r.bottom);
        s.node.scrollLeft = Math.max(
          0,
          Math.min(
            s.node.scrollWidth - s.node.clientWidth,
            s.node.scrollLeft + dx,
          ),
        );
        s.node.scrollTop = Math.max(
          0,
          Math.min(
            s.node.scrollHeight - s.node.clientHeight,
            s.node.scrollTop + dy,
          ),
        );
      }
      update();
      frame = requestAnimationFrame(scroll);
    };
    const move = (event: PointerEvent) => {
      const g = gesture.current;
      if (!g || event.pointerId !== g.pointerId) return;
      g.lastX = event.clientX;
      g.lastY = event.clientY;
      if (!g.active && Math.hypot(g.lastX - g.x, g.lastY - g.y) >= 6) {
        g.active = true;
        surface.current?.setPointerCapture?.(g.pointerId);
        frame = requestAnimationFrame(scroll);
      }
      if (g.active) {
        event.preventDefault();
        update();
      }
    };
    const finish = (cancel = false) => {
      const g = gesture.current;
      if (!g) return;
      gesture.current = null;
      cancelAnimationFrame(frame);
      if (g.active) {
        suppressClick.current = true;
        window.clearTimeout(resetClick.current);
        resetClick.current = window.setTimeout(() => {
          suppressClick.current = false;
        }, 0);
        if (cancel) useSelection.getState().replace(g.initial);
        if (surface.current?.hasPointerCapture?.(g.pointerId))
          surface.current.releasePointerCapture(g.pointerId);
      }
      setBox(null);
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId === gesture.current?.pointerId) finish();
    };
    const cancel = () => finish(true);
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && gesture.current) {
        event.preventDefault();
        cancel();
      }
    };
    document.addEventListener("pointermove", move, { passive: false });
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", cancel);
    document.addEventListener("keydown", key);
    window.addEventListener("blur", cancel);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(resetClick.current);
      gesture.current = null;
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", cancel);
      document.removeEventListener("keydown", key);
      window.removeEventListener("blur", cancel);
    };
  }, []);
  return (
    <div
      {...props}
      ref={(node) => {
        surface.current = node;
        if (scrollRef) scrollRef.current = node;
      }}
      className={`st-selection-surface ${className}`}
      role={props.role ?? "group"}
      onPointerDownCapture={(event) => {
        if (
          event.button !== 0 ||
          event.pointerType === "touch" ||
          event.isPrimary === false ||
          !(event.target instanceof Element) ||
          !event.currentTarget.contains(event.target)
        )
          return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          (event.currentTarget.clientWidth > 0 &&
            event.clientX > bounds.left + event.currentTarget.clientWidth) ||
          (event.currentTarget.clientHeight > 0 &&
            event.clientY > bounds.top + event.currentTarget.clientHeight)
        )
          return;
        const target = event.target,
          item = target.closest("[data-selection-key]"),
          control = target.closest(interactive);
        if (
          (control && control !== item) ||
          target.closest('[draggable="true"]')
        )
          return;
        const scrolls: Gesture["scrolls"] = [];
        for (
          let node: HTMLElement | null = event.currentTarget;
          node;
          node = node.parentElement
        ) {
          const style = getComputedStyle(node);
          if (
            /auto|scroll/.test(
              style.overflow + style.overflowX + style.overflowY,
            ) &&
            (node.scrollHeight > node.clientHeight ||
              node.scrollWidth > node.clientWidth)
          )
            scrolls.push({ node, left: node.scrollLeft, top: node.scrollTop });
        }
        gesture.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          lastX: event.clientX,
          lastY: event.clientY,
          active: false,
          additive: event.metaKey || event.ctrlKey || event.shiftKey,
          initial: [...useSelection.getState().keys],
          scrolls,
        };
      }}
      onClickCapture={(event) => {
        if (suppressClick.current) {
          event.preventDefault();
          event.stopPropagation();
          suppressClick.current = false;
          return;
        }
        if (
          event.target instanceof Element &&
          event.currentTarget.contains(event.target) &&
          !event.target.closest("[data-selection-key]") &&
          !event.target.closest(interactive) &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey
        )
          useSelection.getState().replace([]);
      }}
      onDragStartCapture={(event) => {
        if (
          event.target instanceof Element &&
          !event.target.closest('[draggable="true"],.drag-handle')
        )
          event.preventDefault();
      }}
    >
      {children}
      {box &&
        box.right > box.left &&
        box.bottom > box.top &&
        createPortal(
          <div
            className="st-selection-marquee"
            aria-hidden="true"
            style={{
              left: box.left,
              top: box.top,
              width: box.right - box.left,
              height: box.bottom - box.top,
            }}
          />,
          document.body,
        )}
    </div>
  );
}
