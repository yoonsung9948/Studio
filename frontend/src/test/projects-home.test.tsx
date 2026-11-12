import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  within,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../app/App";
import { useStore } from "../stores/store";
import { useStudio } from "../studio/selection";
import { installDirectorProject } from "../mocks/director-project";
import { installHomeProductions } from "../mocks/home-productions";
import { dataSchema } from "../domain/schemas";
import { interpretationWorkflow } from "../services/interpretation";
import { acceptedRequest, backendJob, jsonResponse } from "./fixtures/backend";

beforeEach(() => {
  useStore.getState().reset();
  useStore.getState().mutate((data) => {
    installDirectorProject(data);
    installHomeProductions(data);
  });
  useStudio.getState().set({
    activity: false,
    account: false,
    settings: false,
    palette: false,
    navigation: false,
  });
});
afterEach(() => {
  interpretationWorkflow.dispose();
  vi.unstubAllGlobals();
});
const mount = (path = "/projects?mode=demo") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
it("renders the reference layout with a scoped production hero and working production links", () => {
  mount();
  expect(
    screen.getByRole("heading", { name: "Back to your stories." }),
  ).toBeInTheDocument();
  const hero = screen.getByRole("region", { name: "Continue production" });
  expect(
    within(hero).getByText("Episode 03 · The reunion"),
  ).toBeInTheDocument();
  expect(
    within(hero).getByRole("link", { name: "Continue editing" }),
  ).toHaveAttribute("href", "/projects/last-letter/episodes/last-letter-ep3");
  const productions = screen.getByRole("region", { name: "Your productions" });
  expect(
    within(productions).getByRole("link", { name: "Open Night Shift" }),
  ).toHaveAttribute("href", "/projects/night-shift/episodes");
  expect(
    within(productions).getByRole("link", { name: "Open Paper Planets" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByLabelText("Home project filter"),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("region", { name: "Recent work" }),
  ).not.toBeInTheDocument();
});
it.each(["An idea", "A script"])(
  "creates an editable production from %s without charging credits",
  (mode) => {
    const credits = useStore.getState().data.credits;
    mount();
    fireEvent.click(screen.getByRole("button", { name: mode }));
    fireEvent.change(
      screen.getByLabelText(mode === "An idea" ? "Story idea" : "Film script"),
      { target: { value: "A stranger arrives at the diner." } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Start a film" }));
    if (screen.queryByRole("button", { name: "Create film" }))
      fireEvent.click(screen.getByRole("button", { name: "Create film" }));
    expect(screen.getByRole("button", { name: "Scene plan" })).toBeInTheDocument();
    const data = useStore.getState().data;
    const project = Object.values(data.projects).find(
      (item) => item.title === "A stranger arrives at the diner",
    )!;
    expect(project.unfiled).not.toBe(true);
    expect(data.episodes[project.episodeIds[0]].script).toBe(
      "A stranger arrives at the diner.",
    );
    expect(data.credits).toBe(credits);
  },
);
it("creates a blank project without fabricating scenes or submitting a request", () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  mount();
  fireEvent.click(screen.getByRole("button", { name: "A blank project" }));
  fireEvent.change(screen.getByLabelText("Film title"), {
    target: { value: "My next film" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Start a film" }));
  if (screen.queryByRole("button", { name: "Create film" }))
    fireEvent.click(screen.getByRole("button", { name: "Create film" }));
  expect(screen.getByLabelText("Project name")).toHaveValue("My next film");
  const project = Object.values(useStore.getState().data.projects).find(
    (item) => item.title === "My next film",
  )!;
  expect(project.episodeIds).toEqual([]);
  expect(fetcher).not.toHaveBeenCalled();
});
it("retains separate idea/script drafts when switching start modes", () => {
  mount();
  const idea = screen.getByLabelText("Story idea");
  fireEvent.change(idea, { target: { value: "A letter changes everything." } });
  fireEvent.click(screen.getByRole("button", { name: "A script" }));
  expect(screen.getByLabelText("Film script")).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "An idea" }));
  expect(screen.getByLabelText("Story idea")).toHaveValue(
    "A letter changes everything.",
  );
});
it("sorts productions by name and opens the chosen production's cast", () => {
  mount();
  fireEvent.change(screen.getByLabelText("Sort productions"), {
    target: { value: "name" },
  });
  expect(
    within(
      screen.getByRole("region", { name: "Your productions" }),
    ).getAllByRole("article")[0],
  ).toHaveAttribute("aria-label", "Project Midnight Secrets");
  fireEvent.click(
    screen.getByRole("link", { name: "Manage cast for The Last Letter" }),
  );
  expect(
    screen.getByRole("article", { name: "Character Maya" }),
  ).toBeInTheDocument();
});
it("submits the home prompt to the existing backend without generating local editorial data", async () => {
  const job = { ...backendJob, projectId: null };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse(acceptedRequest(job), 202))
    .mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal("fetch", fetcher);
  const before = Object.keys(useStore.getState().data.projects);
  mount("/projects");
  fireEvent.change(screen.getByLabelText("Story idea"), {
    target: { value: "A rainy evening in a cafe." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Start a film" }));
  if (screen.queryByRole("button", { name: "Create film" }))
    fireEvent.click(screen.getByRole("button", { name: "Create film" }));
  await waitFor(() =>
    expect(useStore.getState().data.backend?.request?.jobId).toBe(job.id),
  );
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
    projectId: null,
    prompt: "A rainy evening in a cafe.",
  });
  expect(Object.keys(useStore.getState().data.projects)).toEqual(before);
});
it("keeps the editable sample productions valid and installs them only once", () => {
  const before = useStore.getState().data;
  expect(dataSchema.safeParse(before).success).toBe(true);
  const episodes = Object.keys(before.episodes);
  useStore.getState().mutate(installHomeProductions);
  expect(Object.keys(useStore.getState().data.episodes)).toEqual(episodes);
  const episodeId =
    useStore.getState().data.projects["night-shift"].episodeIds[0];
  useStore.getState().mutate((data) => {
    data.episodes[episodeId].title = "INT";
    installHomeProductions(data);
  });
  expect(useStore.getState().data.episodes[episodeId].title).toBe(
    "The late arrival",
  );
  useStore.getState().mutate((data) => {
    data.episodes[episodeId].title = "My episode name";
    installHomeProductions(data);
  });
  expect(useStore.getState().data.episodes[episodeId].title).toBe(
    "My episode name",
  );
});

it("opens the chosen production library from its card menu", () => {
  mount();
  fireEvent.keyDown(
    screen.getByRole("button", { name: "Options for The Last Letter" }),
    { key: "ArrowDown" },
  );
  fireEvent.click(screen.getByRole("menuitem", { name: "Open library" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(
    screen.getByRole("group", { name: "Library cards" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("Choose a project")).not.toBeInTheDocument();
});

it("imports a screenplay into the script draft without replacing the idea draft", async () => {
  mount();
  fireEvent.change(screen.getByLabelText("Story idea"), {
    target: { value: "An old friendship rekindled." },
  });
  fireEvent.click(screen.getByRole("button", { name: "A script" }));
  const script = "INT. CAFE — NIGHT\nMAYA\nYou kept it?";
  const file = new File([script], "reunion.fountain", { type: "text/plain" });
  Object.defineProperty(file, "text", { value: async () => script });
  fireEvent.change(screen.getByLabelText("Upload screenplay"), {
    target: { files: [file] },
  });
  await waitFor(() =>
    expect(screen.getByLabelText("Film script")).toHaveValue(script),
  );
  fireEvent.click(screen.getByRole("button", { name: "An idea" }));
  expect(screen.getByLabelText("Story idea")).toHaveValue(
    "An old friendship rekindled.",
  );
});

it("keeps the current script when an uploaded screenplay exceeds the prompt limit", async () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "A script" }));
  fireEvent.change(screen.getByLabelText("Film script"), {
    target: { value: "My original script." },
  });
  const script = "a".repeat(2001);
  const file = new File([script], "long-script.txt", { type: "text/plain" });
  Object.defineProperty(file, "text", { value: async () => script });
  fireEvent.change(screen.getByLabelText("Upload screenplay"), {
    target: { files: [file] },
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "up to 2,000 characters",
  );
  expect(screen.getByLabelText("Film script")).toHaveValue(
    "My original script.",
  );
});

it("opens the matching production's cast from its card footer", () => {
  mount();
  fireEvent.click(
    screen.getByRole("link", { name: "Manage cast for The Last Letter" }),
  );
  expect(
    screen.getByRole("article", { name: "Character Maya" }),
  ).toBeInTheDocument();
});

it("displays only linked cast portraits on production cards without an add affordance", () => {
  useStore.getState().mutate((data) => {
    data.characters["unused-cast"] = {
      id: "unused-cast",
      projectId: "last-letter",
      name: "Unused cast",
      description: "",
      reference: "/unused.png",
      approved: false,
    };
  });
  mount();
  const card = screen.getByRole("article", { name: "Project The Last Letter" });
  const faces = within(card).getByLabelText("Production cast");
  expect(within(faces).getAllByRole("img")).toHaveLength(2);
  expect(
    within(faces).queryByRole("img", { name: "Unused cast" }),
  ).not.toBeInTheDocument();
  expect(card.querySelector(".ph-add-cast")).toBeNull();
  expect(within(faces).queryByText(/^\+/)).not.toBeInTheDocument();
});
