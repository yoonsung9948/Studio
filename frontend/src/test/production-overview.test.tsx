import { beforeEach, expect, it } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { App } from "../app/App";
import { useStore } from "../stores/store";
import { useSelection, useStudio } from "../studio/selection";
import { installDirectorProject } from "../mocks/director-project";
import { dataSchema } from "../domain/schemas";
import { createWorkspaceEpisode } from "../domain/workspace";
import { episodeContinuity } from "../studio/production/episode-continuity";
import {
  episodeProgress,
  productionFacts,
  productionEvents,
} from "../studio/production/production-data";

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
    <MemoryRouter initialEntries={["/projects/last-letter/episodes?mode=demo"]}>
      <App />
    </MemoryRouter>,
  );

it("renders the overview, episode cards, and linked continuity from production data", () => {
  mount();
  const overview = within(
    screen.getByRole("region", { name: "Project overview" }),
  );
  expect(overview.getByText("Short-form drama")).toBeInTheDocument();
  expect(overview.getByText("1 episode")).toBeInTheDocument();
  expect(overview.getByText("16:9")).toBeInTheDocument();
  expect(overview.getByText("Naturalistic")).toBeInTheDocument();
  expect(screen.getByText("Saved")).toBeInTheDocument();
  const card = within(
    screen.getByRole("group", { name: "Episode cards" }),
  ).getByRole("article", { name: "Episode The reunion" });
  expect(card).toHaveClass("is-selected");
  expect(within(card).getByText("In progress")).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Open episode continuity" }),
  ).toHaveAttribute(
    "href",
    "/projects/last-letter/episodes/last-letter-ep3?view=board",
  );
  const continuity = within(
    screen.getByRole("region", { name: "Episode continuity" }),
  );
  expect(continuity.getByText("Episode 01 · The reunion")).toBeInTheDocument();
  expect(
    continuity.getByRole("link", { name: /Sealed letter/ }),
  ).toHaveAttribute(
    "href",
    "/projects/last-letter/episodes/last-letter-ep3/shots/letter-arrival-q1?stage=scene",
  );
});

it("saves production notes and shares them with the story bible", () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Production notes" }));
  const dialog = within(screen.getByRole("dialog"));
  fireEvent.change(dialog.getByLabelText("Production notes"), {
    target: { value: "The letter stays sealed until the final scene." },
  });
  fireEvent.click(dialog.getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: "Story bible" }));
  expect(screen.getByLabelText("Story bible")).toHaveValue(
    "The letter stays sealed until the final scene.",
  );
  fireEvent.change(screen.getByLabelText("Story bible"), {
    target: { value: "Maya always wears burgundy." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Episodes" }));
  expect(useStore.getState().data.projects["last-letter"].bible).toBe(
    "Maya always wears burgundy.",
  );
  expect(dataSchema.safeParse(useStore.getState().data).success).toBe(true);
});

it("persists production settings and uses the saved duration for a new episode", () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Production settings" }));
  fireEvent.change(screen.getByLabelText("Production format"), {
    target: { value: "Drama series" },
  });
  fireEvent.blur(screen.getByLabelText("Production format"));
  fireEvent.change(screen.getByLabelText("Default episode duration"), {
    target: { value: "45" },
  });
  fireEvent.blur(screen.getByLabelText("Default episode duration"));
  fireEvent.click(
    screen.getByRole("switch", {
      name: "Require script and scene plan approvals",
    }),
  );
  expect(
    dataSchema.parse(useStore.getState().data).projects["last-letter"],
  ).toMatchObject({
    format: "Drama series",
    defaultDuration: 45,
    strictApprovals: true,
  });
  const before = Object.keys(useStore.getState().data.episodes);
  fireEvent.click(screen.getByRole("button", { name: "Episodes" }));
  fireEvent.click(screen.getByRole("button", { name: "Add episode" }));
  const newEpisode = Object.values(useStore.getState().data.episodes).find(
    (episode) => !before.includes(episode.id),
  );
  expect(newEpisode?.targetSeconds).toBe(45);
});

it("rejects an invalid duration without changing saved defaults", () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Production settings" }));
  fireEvent.change(screen.getByLabelText("Default episode duration"), {
    target: { value: "0" },
  });
  fireEvent.blur(screen.getByLabelText("Default episode duration"));
  expect(screen.getByLabelText("Default episode duration")).toHaveValue("30");
  expect(useStore.getState().data.projects["last-letter"].defaultDuration).toBe(
    30,
  );
});

it("duplicates and archives episodes through the card menu", async () => {
  const user = userEvent.setup();
  mount();
  await user.click(
    screen.getByRole("button", { name: "Options for The reunion" }),
  );
  await user.click(screen.getByRole("menuitem", { name: "Duplicate episode" }));
  const duplicate = Object.values(useStore.getState().data.episodes).find(
    (episode) =>
      episode.projectId === "last-letter" && episode.id !== "last-letter-ep3",
  )!;
  expect(duplicate).toBeTruthy();
  await user.click(
    screen.getByRole("button", { name: `Options for ${duplicate.title}` }),
  );
  await user.click(screen.getByRole("menuitem", { name: "Archive episode" }));
  expect(useStore.getState().data.episodes[duplicate.id].archived).toBe(true);
  expect(
    screen.queryByRole("article", { name: `Episode ${duplicate.title}` }),
  ).not.toBeInTheDocument();
  act(() => useStore.getState().undo());
  expect(
    screen.getByRole("article", { name: `Episode ${duplicate.title}` }),
  ).toBeInTheDocument();
});

it("opens a full activity list and links approval records to the correct editor", () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "View all" }));
  const activity = within(screen.getByRole("dialog"));
  expect(activity.getAllByRole("link").length).toBeGreaterThan(5);
  expect(
    activity.getByRole("link", { name: /Script approved/ }),
  ).toHaveAttribute(
    "href",
    "/projects/last-letter/episodes/last-letter-ep3?view=script",
  );
});

it("does not count stale, missing, or unapproved video as ready, or invent take approval dates", () => {
  const data = structuredClone(useStore.getState().data);
  const shot = data.shots["letter-reunion-q1"];
  const take = data.takes[shot.imageTakeId!];
  shot.currentTakeId = take.id;
  expect(episodeProgress(data, "last-letter-ep3").ready).toBe(0);
  data.takes["test-video"] = { ...take, id: "test-video", kind: "video" };
  shot.currentTakeId = "test-video";
  expect(episodeProgress(data, "last-letter-ep3").ready).toBe(1);
  shot.stale = true;
  expect(episodeProgress(data, "last-letter-ep3").ready).toBe(0);
  shot.stale = false;
  data.assets[take.assetId].missing = true;
  expect(episodeProgress(data, "last-letter-ep3").ready).toBe(0);
  expect(
    productionEvents(data, "last-letter")
      .filter((event) => event.title === "Frame approved")
      .every((event) => event.occurredAt === undefined),
  ).toBe(true);
  data.episodes["last-letter-ep3"].archived = true;
  expect(productionFacts(data, "last-letter")[1].value).toBe("0 episodes");
  expect(productionEvents(data, "last-letter")).toHaveLength(0);
});

it("switches the continuity preview when an episode card is selected, without leaking production references", () => {
  let emptyId = "";
  useStore.getState().mutate((data) => {
    emptyId = createWorkspaceEpisode(data, "last-letter", "");
    data.episodes[emptyId].title = "Unassigned episode";
  });
  mount();
  const continuity = within(
    screen.getByRole("region", { name: "Episode continuity" }),
  );
  expect(
    continuity.getByText("Episode 02 · Unassigned episode"),
  ).toBeInTheDocument();
  expect(
    continuity.getByText("No cast assigned to this episode."),
  ).toBeInTheDocument();
  expect(continuity.queryByText("Maya")).not.toBeInTheDocument();
  expect(continuity.queryByText("Cafe at dusk")).not.toBeInTheDocument();
  expect(continuity.queryByText("Sealed letter")).not.toBeInTheDocument();

  const reunion = screen.getByRole("article", { name: "Episode The reunion" });
  fireEvent.click(reunion);
  expect(reunion).toHaveClass("is-selected");
  expect(continuity.getByText("Episode 01 · The reunion")).toBeInTheDocument();
  expect(continuity.getByText("Maya")).toBeInTheDocument();
  expect(continuity.getByText("Jun")).toBeInTheDocument();
  expect(continuity.getByText("Cafe at dusk")).toBeInTheDocument();
  expect(continuity.getByText("Sealed letter")).toBeInTheDocument();

  fireEvent.keyDown(
    screen.getByRole("article", { name: "Episode Unassigned episode" }),
    { key: " " },
  );
  expect(
    continuity.getByText("No cast assigned to this episode."),
  ).toBeInTheDocument();
  expect(
    continuity.getByRole("link", { name: "Open episode continuity" }),
  ).toHaveAttribute(
    "href",
    `/projects/last-letter/episodes/${emptyId}?view=board`,
  );
  act(() =>
    useStore.getState().mutate((data) => {
      data.episodes[emptyId].archived = true;
    }),
  );
  expect(continuity.getByText("Episode 01 · The reunion")).toBeInTheDocument();
  expect(reunion).toHaveClass("is-selected");
});

it("collects all active episode assignments, respects shot overrides, and excludes archived or unrelated references", () => {
  const data = structuredClone(useStore.getState().data);
  const episode = data.episodes["last-letter-ep3"];
  const scene = data.scenes[episode.sceneIds[0]];
  episode.sceneIds = [scene.id];
  const first = data.shots[scene.shotIds[0]];
  const second = data.shots[scene.shotIds[1]];
  data.studio.looks["maya-coat"] = {
    id: "maya-coat",
    characterId: "letter-maya",
    name: "Burgundy coat",
    description: "",
    styling: "",
    notes: "",
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
  };
  first.castOverride = [{ characterId: "letter-maya", lookId: "maya-coat" }];
  second.castOverride = [{ characterId: "letter-jun" }];
  data.studio.locations["second-location"] = {
    ...data.studio.locations["letter-cafe"],
    id: "second-location",
    name: "Station",
  };
  second.generationOverride = {
    ...data.studio.setups[scene.id].generation!,
    locationId: "second-location",
    locationMode: "selected",
  };
  const selected = episodeContinuity(data, episode.id);
  expect(selected.cast.map((entry) => entry.id)).toEqual([
    "letter-maya",
    "letter-jun",
  ]);
  expect(selected.cast[0].lookIds).toEqual(["maya-coat"]);
  expect(selected.locations.map((entry) => entry.id)).toEqual([
    "letter-cafe",
    "second-location",
  ]);
  expect(selected.props.map((entry) => entry.id)).toEqual([
    "letter-sealed-prop",
  ]);
  expect(selected.notes).toEqual([
    { sceneId: scene.id, text: "Keep the letter sealed." },
  ]);

  second.archived = true;
  first.worldElementIds = [];
  const active = episodeContinuity(data, episode.id);
  expect(active.cast.map((entry) => entry.id)).toEqual(["letter-maya"]);
  expect(active.locations.map((entry) => entry.id)).toEqual(["letter-cafe"]);
  expect(active.props).toEqual([]);
  data.scenes[scene.id].archived = true;
  expect(episodeContinuity(data, episode.id)).toEqual({
    cast: [],
    locations: [],
    props: [],
    notes: [],
  });
});

it("offers episode creation as a card in the episode grid", () => {
  mount();
  expect(
    screen.queryByRole("button", { name: "New episode" }),
  ).not.toBeInTheDocument();
  const grid = within(screen.getByRole("group", { name: "Episode cards" }));
  expect(grid.getByRole("button", { name: "Add episode" })).toHaveClass(
    "production-add-episode",
  );
  const before =
    useStore.getState().data.projects["last-letter"].episodeIds.length;
  fireEvent.click(grid.getByRole("button", { name: "Add episode" }));
  expect(
    useStore.getState().data.projects["last-letter"].episodeIds,
  ).toHaveLength(before + 1);
});
