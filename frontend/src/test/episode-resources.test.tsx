import { chooseScope } from "./choose-scope";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../app/App";
import { useStore } from "../stores/store";
import { useSelection, useStudio } from "../studio/selection";
import { installDirectorProject } from "../mocks/director-project";
import { installHomeProductions } from "../mocks/home-productions";
import {
  attachEpisodeMedia,
  episodeContinuity,
  episodeMediaAssetIds,
} from "../domain/episode-resources";
import { dataSchema } from "../domain/schemas";
import { validateRelations } from "../domain/validation";
const projectId = "last-letter",
  episodeId = "last-letter-ep3",
  base = `/projects/${projectId}/episodes/${episodeId}`;
let sibling = "";
beforeEach(() => {
  useStore.getState().reset();
  useStore.getState().mutate((data) => {
    installDirectorProject(data);
    installHomeProductions(data);
    sibling = data.projects[projectId].episodeIds[0];
    data.assets["sibling-only"] = {
      id: "sibling-only",
      projectId,
      title: "Sibling-only media",
      kind: "image",
      url: "/sibling.png",
      provenance: "Test",
    };
    attachEpisodeMedia(data, sibling, "sibling-only");
  });
  useSelection.getState().replace([]);
  useStudio.getState().set({
    view: "board",
    activity: false,
    settings: false,
    account: false,
    palette: false,
  });
});
const mount = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
it("opens the global character Assets workspace from Home with no project browser", () => {
  mount("/projects?mode=demo");
  fireEvent.click(screen.getByRole("button", { name: "Assets" }));
  expect(screen.getByLabelText("Assets page")).toHaveTextContent(
    "reusable characters",
  );
  expect(
    screen.getByRole("button", { name: "Open Maya views" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Projects" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Assets" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});
it("lists only reference assignments from the selected episode", () => {
  const data = useStore.getState().data;
  expect(
    episodeContinuity(data, episodeId).cast.map((entry) => entry.id),
  ).toContain("letter-maya");
  expect(episodeContinuity(data, sibling).cast).toHaveLength(0);
  mount(`${base}/references`);
  const refs = within(
    screen.getByRole("region", { name: "Episode references" }),
  );
  expect(
    refs.getByRole("button", { name: "Open Maya views" }),
  ).toBeInTheDocument();
  chooseScope("Episode", sibling);
  expect(
    screen.getByRole("heading", { name: "References" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Open Maya views" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("No characters linked yet")).toBeInTheDocument();
});
it("isolates media including same-project imports from sibling episodes", () => {
  const data = useStore.getState().data;
  expect(episodeMediaAssetIds(data, episodeId).has("sibling-only")).toBe(false);
  mount(`${base}/media`);
  expect(
    screen.queryByRole("article", { name: "Media Sibling-only media" }),
  ).not.toBeInTheDocument();
  chooseScope("Episode", sibling);
  expect(screen.getByRole("heading", { name: "Media" })).toBeInTheDocument();
  expect(screen.getByText("Sibling-only media")).toBeInTheDocument();
  expect(
    screen.queryByText("Maya close-up · Frame 01"),
  ).not.toBeInTheDocument();
});
it("keeps episode filters on media type changes and blocks foreign episode routes", () => {
  mount(`${base}/media`);
  fireEvent.click(
    within(screen.getByRole("navigation", { name: "Media filters" })).getByRole(
      "button",
      { name: "Video" },
    ),
  );
  expect(screen.getByLabelText("Episode")).toHaveValue(episodeId);
  expect(screen.queryByText("Sibling-only media")).not.toBeInTheDocument();
});
it("rejects invalid episode ownership rather than showing all project media", () => {
  mount(`/projects/night-shift/episodes/${episodeId}/media`);
  expect(screen.getByText("Episode unavailable.")).toBeInTheDocument();
  expect(
    screen.queryByRole("group", { name: "Library cards" }),
  ).not.toBeInTheDocument();
});
it("persists episode upload membership without moving or copying the shared asset", () => {
  const data = structuredClone(useStore.getState().data);
  attachEpisodeMedia(data, episodeId, "sibling-only");
  expect(episodeMediaAssetIds(data, episodeId).has("sibling-only")).toBe(true);
  expect(episodeMediaAssetIds(data, sibling).has("sibling-only")).toBe(true);
  expect(data.assets["sibling-only"].projectId).toBe(projectId);
  expect(dataSchema.parse(data).episodes[episodeId].mediaAssetIds).toContain(
    "sibling-only",
  );
  expect(() => validateRelations(data)).not.toThrow();
  const foreign = Object.values(data.assets).find(
    (asset) => asset.projectId !== projectId,
  )!;
  expect(() => attachEpisodeMedia(data, episodeId, foreign.id)).toThrow(
    /episode's production/,
  );
  data.episodes[episodeId].mediaAssetIds = [foreign.id];
  expect(() => validateRelations(data)).toThrow(/relationships/);
});
it("associates uploaded media with the current episode only", () => {
  const createURL = vi
    .spyOn(URL, "createObjectURL")
    .mockReturnValue("blob:episode-upload");
  const view = mount(`${base}/media`);
  const input = view.container.querySelector('input[type="file"]')!;
  fireEvent.change(input, {
    target: {
      files: [new File(["image"], "Episode upload.png", { type: "image/png" })],
    },
  });
  const data = useStore.getState().data;
  const asset = Object.values(data.assets).find(
    (asset) => asset.title === "Episode upload.png",
  )!;
  expect(data.episodes[episodeId].mediaAssetIds).toContain(asset.id);
  expect(episodeMediaAssetIds(data, sibling).has(asset.id)).toBe(false);
  expect(screen.getByText("Episode upload.png")).toBeInTheDocument();
  createURL.mockRestore();
});

afterEach(() => vi.restoreAllMocks());

it.each(["/projects/last-letter/library?mode=demo", `${base}/media?mode=demo`])(
  "does not open Activity automatically on desktop media entry: %s",
  (path) => {
    const original = window.matchMedia;
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      ...original(query),
      matches: query === "(min-width: 1100px)",
    }));
    mount(path);
    expect(useStudio.getState().activity).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Activity" }));
    expect(useStudio.getState().activity).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Close activity" }));
    expect(useStudio.getState().activity).toBe(false);
  },
);

it("keeps Activity closed when navigating from References into Media", () => {
  const original = window.matchMedia;
  vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
    ...original(query),
    matches: query === "(min-width: 1100px)",
  }));
  mount(`${base}/references?mode=demo`);
  fireEvent.click(screen.getByRole("button", { name: "Media" }));
  expect(screen.getByRole("heading", { name: "Media" })).toBeInTheDocument();
  expect(useStudio.getState().activity).toBe(false);
});

it("removes the Style tab and makes old style links fall back to Characters", () => {
  mount(`${base}/references?kind=style`);
  const tabs = within(
    screen.getByRole("navigation", { name: "Episode reference categories" }),
  );
  expect(
    tabs.getAllByRole("button").map((button) => button.textContent),
  ).toEqual(["Characters", "Places", "Props"]);
  expect(tabs.getByRole("button", { name: "Characters" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.queryByText("Episode style")).not.toBeInTheDocument();
});

it("removes the unused Styles tab from Assets", () => {
  mount("/assets?kind=styles");
  const tabs = within(
    screen.getByRole("navigation", { name: "Asset categories" }),
  );
  expect(
    tabs.getAllByRole("button").map((button) => button.textContent),
  ).toEqual(["Characters", "Places", "Props"]);
});
