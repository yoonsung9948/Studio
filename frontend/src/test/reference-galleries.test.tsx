import { chooseScope } from "./choose-scope";
import { beforeEach, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../app/App";
import { useStore } from "../stores/store";
import { useSelection, useStudio } from "../studio/selection";
import { installDirectorProject } from "../mocks/director-project";
import { installHomeProductions } from "../mocks/home-productions";
import { createEpisodeLook } from "../domain/episode-characters";
import { locationImages } from "../studio/references/reference-media";

const episodeId = "last-letter-ep3";
const base = `/projects/last-letter/episodes/${episodeId}/references`;
let siblingId = "";
beforeEach(() => {
  useStore.getState().reset();
  useStore.getState().mutate((data) => {
    installDirectorProject(data);
    installHomeProductions(data);
    siblingId = data.projects["last-letter"].episodeIds[0];
  });
  useSelection.getState().replace([]);
  useStudio
    .getState()
    .set({ activity: false, settings: false, account: false, palette: false });
});
const mount = (query = "") =>
  render(
    <MemoryRouter initialEntries={[base + query]}>
      <App />
    </MemoryRouter>,
  );

it("opens episode look Views directly from cards and excludes sibling looks", () => {
  let ownLook = "";
  useStore.getState().mutate((data) => {
    ownLook = createEpisodeLook(data, episodeId, "letter-maya", "Evening coat");
    data.episodes[siblingId].characterIds = ["letter-maya"];
    createEpisodeLook(data, siblingId, "letter-maya", "Sibling-only wardrobe");
  });
  mount();
  expect(screen.queryByText("Sibling-only wardrobe")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Evening coat" }));
  expect(
    screen.getByRole("form", { name: "Generate views" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Maya / Evening coat" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: /Back to References/ }),
  ).toHaveAttribute("href", base + "?kind=characters");
  expect(useStore.getState().data.studio.looks[ownLook].episodeId).toBe(
    episodeId,
  );
});

it("opens a character's Views without changing episode references", () => {
  mount();
  const before = structuredClone(useStore.getState().data.episodes[episodeId]);
  fireEvent.click(screen.getByRole("button", { name: "Open Jun views" }));
  expect(
    screen.getByRole("form", { name: "Generate views" }),
  ).toBeInTheDocument();
  expect(useStore.getState().data.episodes[episodeId]).toEqual(before);
});

it("builds contact sheets from distinct available saved location images, and previews the selected angle", () => {
  useStore.getState().mutate((data) => {
    const original = data.assets["letter-cafe"];
    for (const [id, changes] of [
      ["window-view", { title: "Window table", url: "/window-view.png" }],
      ["cafe-duplicate", {}],
      ["cafe-missing", { missing: true, url: "/missing.png" }],
      ["cafe-archived", { archived: true, url: "/archived.png" }],
      ["foreign-view", { projectId: "midnight", url: "/foreign.png" }],
      ["cafe-video", { kind: "video" as const, url: "/video.mp4" }],
    ] as const)
      data.assets[id] = { ...original, ...changes, id };
    data.studio.locations["letter-cafe"].referenceAssetIds = [
      "window-view",
      "cafe-duplicate",
      "cafe-missing",
      "cafe-archived",
      "foreign-view",
      "cafe-video",
    ];
  });
  const data = useStore.getState().data;
  expect(
    locationImages(data, data.studio.locations["letter-cafe"]).map(
      (image) => image.id,
    ),
  ).toEqual(["letter-cafe", "window-view"]);
  mount("?kind=places");
  const card = screen.getByRole("button", { name: "Open Cafe at dusk views" });
  expect(card.querySelectorAll("img")).toHaveLength(2);
  fireEvent.click(card);
  expect(
    screen.getByRole("form", { name: "Generate views" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: /Back to References/ }),
  ).toHaveAttribute("href", base + "?kind=places");
  expect(
    screen.queryByRole("heading", { name: "Scene assignments" }),
  ).not.toBeInTheDocument();
});

it("opens episode prop Views and leaves sibling episodes empty", () => {
  mount("?kind=props");
  fireEvent.click(
    screen.getByRole("button", { name: "Open Sealed letter views" }),
  );
  expect(
    screen.getByRole("heading", { name: "Sealed letter" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("form", { name: "Generate views" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("link", { name: /Back to References/ }));
  chooseScope("Episode", siblingId);
  fireEvent.click(screen.getByRole("button", { name: "Props" }));
  expect(
    screen.queryByRole("button", { name: "Open Sealed letter views" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("No props yet")).toBeInTheDocument();
});
