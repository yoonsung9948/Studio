import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ThumbnailDropdown } from "../studio/shell/ThumbnailDropdown";

const options = [
  { id: "letter", label: "The Last Letter", image: "/letter-cover.png" },
  { id: "night", label: "Night Shift", image: "/night-cover.png" },
];
it("renders corresponding thumbnails in the trigger and every option, with text in a separate element", () => {
  render(
    <ThumbnailDropdown
      label="Project"
      value="letter"
      options={options}
      onSelect={vi.fn()}
    />,
  );
  const trigger = screen.getByRole("button", { name: "Project" });
  expect(trigger.querySelector("img")).toHaveAttribute(
    "src",
    "/letter-cover.png",
  );
  expect(trigger.querySelector(".studio-scope-trigger-text")).toHaveTextContent(
    "The Last Letter",
  );
  fireEvent.keyDown(trigger, { key: "Enter" });
  for (const option of options) {
    const row = screen.getByRole("menuitemradio", { name: option.label });
    expect(row.querySelector("img")).toHaveAttribute("src", option.image);
    expect(row.querySelector(".studio-scope-option-text")).toHaveTextContent(
      option.label,
    );
  }
  expect(
    screen.getByRole("menuitemradio", { name: "The Last Letter" }),
  ).toHaveAttribute("aria-checked", "true");
});
it("supports keyboard selection, Escape dismissal, and returning focus to the trigger", async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  render(
    <ThumbnailDropdown
      label="Project"
      value="letter"
      options={options}
      onSelect={onSelect}
    />,
  );
  const trigger = screen.getByRole("button", { name: "Project" });
  await user.tab();
  await user.keyboard("{Enter}");
  expect(screen.getByRole("menu")).toBeInTheDocument();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  expect(onSelect).not.toHaveBeenCalled();
  await user.keyboard("{Enter}{ArrowDown}{Enter}");
  expect(onSelect).toHaveBeenCalledWith("night");
});
it("handles missing and broken thumbnails without affecting labels, and disables empty episode pickers", () => {
  const { rerender } = render(
    <ThumbnailDropdown
      label="Project"
      value="letter"
      options={options}
      onSelect={vi.fn()}
    />,
  );
  const trigger = screen.getByRole("button", { name: "Project" });
  fireEvent.error(trigger.querySelector("img")!);
  expect(trigger.querySelector("img")).toBeNull();
  expect(trigger).toHaveTextContent("The Last Letter");
  rerender(
    <ThumbnailDropdown label="Episode" options={[]} onSelect={vi.fn()} />,
  );
  expect(screen.getByRole("button", { name: "Episode" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Episode" })).toHaveTextContent(
    "No episodes yet",
  );
});
it("keeps the project menu open when requesting another page of projects", () => {
  const onLoadMore = vi.fn();
  render(
    <ThumbnailDropdown
      label="Project"
      value="letter"
      options={options}
      onSelect={vi.fn()}
      onLoadMore={onLoadMore}
    />,
  );
  fireEvent.keyDown(screen.getByRole("button", { name: "Project" }), {
    key: "Enter",
  });
  fireEvent.click(
    within(screen.getByRole("menu")).getByRole("menuitem", {
      name: "Load more projects…",
    }),
  );
  expect(onLoadMore).toHaveBeenCalledOnce();
  expect(screen.getByRole("menu")).toBeInTheDocument();
});
