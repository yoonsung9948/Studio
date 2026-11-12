import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useStore } from "../stores/store";
import { StudioNotice, NOTICE_DURATION_MS } from "../studio/shell/StudioNotice";

beforeEach(() => {
  useStore.getState().reset();
  useStore.getState().setNotice("");
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});
it("automatically dismisses notifications after 3.5 seconds", () => {
  render(<StudioNotice />);
  act(() => useStore.getState().setNotice("Scene saved"));
  expect(screen.getByRole("status")).toHaveTextContent("Scene saved");
  act(() => vi.advanceTimersByTime(NOTICE_DURATION_MS - 1));
  expect(screen.getByRole("status")).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(1));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
it("gives repeated identical notifications a fresh lifetime", () => {
  render(<StudioNotice />);
  act(() => useStore.getState().setNotice("Scene saved"));
  act(() => vi.advanceTimersByTime(3000));
  act(() => useStore.getState().setNotice("Scene saved"));
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByRole("status")).toHaveTextContent("Scene saved");
  act(() => vi.advanceTimersByTime(2500));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
it("does not let an older timeout dismiss a newer notification and still permits manual dismissal", () => {
  render(<StudioNotice />);
  act(() => useStore.getState().setNotice("First message"));
  act(() => vi.advanceTimersByTime(3000));
  act(() => useStore.getState().setNotice("Second message"));
  act(() => vi.advanceTimersByTime(500));
  expect(screen.getByRole("status")).toHaveTextContent("Second message");
  fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
