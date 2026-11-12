import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export function HomeCardRow({
  label,
  count,
  empty,
  children,
}: {
  label: string;
  count: number;
  empty: string;
  children: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const measure = () => {
    const el = scroller.current;
    if (!el) return;
    const next = {
      left: el.scrollLeft > 1,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
    };
    setEdges((old) =>
      old.left === next.left && old.right === next.right ? old : next,
    );
  };
  useLayoutEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (scroller.current) observer.observe(scroller.current);
    return () => observer.disconnect();
  }, [children]);
  const scroll = (direction: number) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollBy({
      left: direction * Math.max(244, el.clientWidth * 0.85),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  };
  return (
    <section className="st-home-card-section" aria-label={label}>
      <div className="st-section-heading">
        <h2>{label}</h2>
        <span>{count}</span>
      </div>
      {count ? (
        <div className="st-home-card-row">
          <button
            className="st-icon st-home-row-arrow"
            aria-label={`Scroll ${label} left`}
            title={edges.left ? "Scroll left" : "At the first card"}
            disabled={!edges.left}
            onClick={() => scroll(-1)}
          >
            <ChevronLeft size={18} />
          </button>
          <div
            role="group"
            className="st-home-row-cards"
            aria-label={`${label} cards`}
            ref={scroller}
            onScroll={measure}
          >
            {children}
          </div>
          <button
            className="st-icon st-home-row-arrow"
            aria-label={`Scroll ${label} right`}
            title={
              edges.right
                ? "Scroll right"
                : "All cards are visible or you are at the last card"
            }
            disabled={!edges.right}
            onClick={() => scroll(1)}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      ) : (
        <p className="st-muted st-home-row-empty">{empty}</p>
      )}
    </section>
  );
}
