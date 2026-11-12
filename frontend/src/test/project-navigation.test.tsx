import { chooseScope } from "./choose-scope";
import { beforeEach, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { StudioNavigation } from "../studio/shell/StudioNavigation";
import { useStore } from "../stores/store";
import { useStudio } from "../studio/selection";
import { installDirectorProject } from "../mocks/director-project";
import { installHomeProductions } from "../mocks/home-productions";
beforeEach(() => {
  useStore.getState().reset();
  useStore.getState().mutate((data) => {
    installDirectorProject(data);
    installHomeProductions(data);
  });
  useStudio.getState().set({ activity: false });
});
function Location() {
  const location = useLocation();
  return (
    <output aria-label="Route">
      {location.pathname}
      {location.search}
    </output>
  );
}
const mount = (
  url = "/projects/last-letter/episodes/last-letter-ep3?view=script",
) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <StudioNavigation />
      <Location />
    </MemoryRouter>,
  );
it("uses project navigation throughout production including episode review", () => {
  mount("/projects/last-letter/episodes/last-letter-ep3?view=review");
  expect(screen.getByLabelText("Project")).toHaveValue("last-letter");
  expect(screen.getByLabelText("Episode")).toHaveValue("last-letter-ep3");
  expect(screen.getByRole("button", { name: "Produce" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(
    screen.queryByRole("button", { name: "Reviews" }),
  ).not.toBeInTheDocument();
});
it("retains the episode across references and media and returns directly to production", () => {
  mount();
  const first = useStore.getState().data.projects["last-letter"].episodeIds[0];
  chooseScope("Episode", first);
  expect(screen.getByLabelText("Route")).toHaveTextContent(
    `/episodes/${first}?stage=plan`,
  );
  fireEvent.click(screen.getByRole("button", { name: "References" }));
  expect(screen.getByLabelText("Route")).toHaveTextContent(
    `/projects/last-letter/episodes/${first}/references`,
  );
  expect(screen.getByLabelText("Episode")).toHaveValue(first);
  fireEvent.click(screen.getByRole("button", { name: "Media" }));
  expect(screen.getByLabelText("Route")).toHaveTextContent(
    `/projects/last-letter/episodes/${first}/media`,
  );
  fireEvent.click(screen.getByRole("button", { name: "Produce" }));
  expect(screen.getByLabelText("Route")).toHaveTextContent(
    `/episodes/${first}?stage=plan`,
  );
});
it("switches projects without carrying a foreign episode or shot", () => {
  mount(
    "/projects/last-letter/episodes/last-letter-ep3/shots/letter-reunion-q1?stage=frame",
  );
  chooseScope("Project", "night-shift");
  const id = useStore.getState().data.projects["night-shift"].episodeIds[0];
  expect(screen.getByLabelText("Episode")).toHaveValue(id);
  expect(screen.getByLabelText("Route")).toHaveTextContent(
    `/projects/night-shift/episodes/${id}?stage=plan`,
  );
  expect(screen.getByLabelText("Route")).not.toHaveTextContent(
    "letter-reunion-q1",
  );
});
it("excludes archived episodes and handles an empty production", () => {
  useStore.getState().mutate((data) => {
    for (const id of data.projects["last-letter"].episodeIds)
      data.episodes[id].archived = true;
  });
  mount("/projects/last-letter/episodes");
  expect(screen.getByLabelText("Episode")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Produce" }));
  expect(screen.getByLabelText("Route")).toHaveTextContent(
    "/projects/last-letter/episodes",
  );
});
it("keeps Activity and Settings as the existing bottom tools", () => {
  mount();
  const tools = within(
    screen.getByRole("navigation", { name: "Studio tools" }),
  );
  expect(tools.getAllByRole("button")).toHaveLength(2);
  fireEvent.click(tools.getByRole("button", { name: "Activity" }));
  expect(useStudio.getState().activity).toBe(true);
  fireEvent.click(
    tools.getByRole("button", { name: "Settings & preferences" }),
  );
  expect(screen.getByLabelText("Route")).toHaveTextContent("/settings");
  expect(
    tools.getByRole("button", { name: "Settings & preferences" }),
  ).toHaveAttribute("aria-current", "page");
});
it("returns the production Home button to the current Home page", () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Home" }));
  expect(screen.getByLabelText("Route")).toHaveTextContent(/^\/projects$/);
  expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.queryByLabelText("Episode")).not.toBeInTheDocument();
});

it("rejects an episode from a different project or missing from its owner's episode list", () => {
  const data = structuredClone(useStore.getState().data);
  {
    const episode = data.episodes["last-letter-ep3"];
    data.episodes["orphan-episode"] = {
      ...episode,
      id: "orphan-episode",
      title: "Orphan episode",
      sceneIds: [],
    };
    data.projects["last-letter"].episodeIds.push(
      data.projects["night-shift"].episodeIds[0],
    );
  }
  useStore.setState({ data });
  mount("/projects/last-letter/episodes/orphan-episode");
  expect(screen.getByLabelText("Episode")).toHaveValue("last-letter-ep3");
  fireEvent.keyDown(screen.getByLabelText("Episode"), { key: "Enter" });
  const menu = within(screen.getByRole("menu", { name: "Episode" }));
  expect(
    menu.queryByRole("menuitemradio", { name: /Orphan episode/ }),
  ).not.toBeInTheDocument();
  const foreign =
    useStore.getState().data.projects["night-shift"].episodeIds[0];
  expect(
    menu
      .getAllByRole("menuitemradio")
      .some((item) => item.dataset.value === foreign),
  ).toBe(false);
});

it("remembers each project's selected episode independently", () => {
  mount();
  const first = useStore.getState().data.projects["last-letter"].episodeIds[0];
  chooseScope("Episode", first);
  chooseScope("Project", "night-shift");
  chooseScope("Project", "last-letter");
  expect(screen.getByLabelText("Episode")).toHaveValue(first);
});
