import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
afterEach(cleanup);
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});
Element.prototype.scrollIntoView = () => {};

class TestResizeObserver { observe() {} unobserve() {} disconnect() {} }
Object.defineProperty(window, "ResizeObserver", { writable: true, value: TestResizeObserver });
Object.defineProperty(globalThis, "ResizeObserver", { writable: true, value: TestResizeObserver });
