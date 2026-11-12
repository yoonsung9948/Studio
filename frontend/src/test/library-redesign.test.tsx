import { beforeEach, expect, it } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { App } from "../app/App";
import { useStore } from "../stores/store";
import { useSelection, useStudio } from "../studio/selection";
import { installDirectorProject } from "../mocks/director-project";
import { describeLibraryAsset } from "../studio/library-media";
import { enqueueFrameImage } from "../domain/commands";

beforeEach(() => {
  useStore.getState().reset();
  useStore.getState().mutate(installDirectorProject);
  useSelection.getState().replace([]);
  useStudio
    .getState()
    .set({ activity: false, settings: false, account: false, palette: false });
});
const mount = () =>
  render(
    <MemoryRouter initialEntries={["/projects/last-letter/library?mode=demo"]}>
      <App />
    </MemoryRouter>,
  );
const gallery = () =>
  within(screen.getByRole("group", { name: "Library cards" }));

it("uses production records for media categories and never invents approvals", () => {
  const data = useStore.getState().data;
  expect(
    describeLibraryAsset(data, data.assets["letter-maya-identity"]),
  ).toEqual({ category: "Reference", approval: "approved" });
  expect(describeLibraryAsset(data, data.assets["letter-cafe"])).toEqual({
    category: "Location",
    approval: undefined,
  });
  expect(describeLibraryAsset(data, data.assets["letter-prop"])).toEqual({
    category: "Prop",
    approval: undefined,
  });
  mount();
  expect(
    within(
      gallery().getByRole("article", { name: "Media Sealed letter" }),
    ).queryByText("Approved"),
  ).not.toBeInTheDocument();
});

it("filters the gallery and reads the real resolution after media loads", () => {
  mount();
  fireEvent.change(screen.getByLabelText("Search library"), {
    target: { value: "SEALED" },
  });
  const card = gallery().getByRole("article", { name: "Media Sealed letter" });
  expect(gallery().getAllByRole("article")).toHaveLength(1);
  const image = card.querySelector("img")!;
  Object.defineProperties(image, {
    naturalWidth: { value: 1672 },
    naturalHeight: { value: 941 },
  });
  fireEvent.load(image);
  expect(
    within(card).getByText("Prop · Image · 1672 × 941"),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Video" }));
  expect(gallery().queryByRole("article")).not.toBeInTheDocument();
  expect(gallery().getByText("No matching media")).toBeInTheDocument();
});

it("selects cards, opens media details, and archives and restores through the card menu", async () => {
  const user = userEvent.setup();
  mount();
  const card = gallery().getByRole("article", { name: "Media Sealed letter" });
  fireEvent.click(card);
  expect(card).toHaveClass("is-selected");
  expect(within(card).getByLabelText("Selected")).toBeInTheDocument();
  fireEvent.doubleClick(card);
  expect(screen.getByRole("dialog")).toHaveTextContent("Sealed letter");
  expect(screen.getByLabelText("Media title")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Close" }));
  await user.click(
    within(card).getByRole("button", { name: "Options for Sealed letter" }),
  );
  await user.click(screen.getByRole("menuitem", { name: "Archive media" }));
  expect(useStore.getState().data.assets["letter-prop"].archived).toBe(true);
  expect(
    gallery().queryByRole("article", { name: "Media Sealed letter" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Archived" }));
  const archived = gallery().getByRole("article", {
    name: "Media Sealed letter",
  });
  await user.click(
    within(archived).getByRole("button", { name: "Options for Sealed letter" }),
  );
  await user.click(screen.getByRole("menuitem", { name: "Restore media" }));
  expect(useStore.getState().data.assets["letter-prop"].archived).toBe(false);
  expect(gallery().queryByRole("article")).not.toBeInTheDocument();
});

it("filters real job cards and cancels a running generation", () => {
  useStore.getState().mutate((data) => {
    enqueueFrameImage(
      data,
      "letter-reunion-q1",
      "A closer view of Maya at the cafe.",
    );
    const job = Object.values(data.jobs).at(-1)!;
    job.state = "running";
    job.progress = 42;
  });
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
  const tray = within(screen.getByRole("region", { name: "Activity tray" }));
  expect(
    tray.getByRole("progressbar", { name: "Progress for Maya close-up" }),
  ).toHaveAttribute("value", "42");
  fireEvent.click(tray.getByRole("button", { name: "Completed" }));
  expect(tray.queryByRole("article")).not.toBeInTheDocument();
  expect(tray.getByText("No completed jobs yet")).toBeInTheDocument();
  fireEvent.click(tray.getByRole("button", { name: "Generating" }));
  fireEvent.click(tray.getByRole("button", { name: "Cancel" }));
  expect(tray.queryByRole("article")).not.toBeInTheDocument();
  expect(tray.getByText("No jobs generating")).toBeInTheDocument();
  fireEvent.click(tray.getByRole("button", { name: "All" }));
  expect(tray.getByText("Canceled")).toBeInTheDocument();
  expect(
    tray.getByRole("button", { name: "Retry · 8 cr" }),
  ).toBeInTheDocument();
  act(() => useStudio.getState().set({ activity: false }));
});
