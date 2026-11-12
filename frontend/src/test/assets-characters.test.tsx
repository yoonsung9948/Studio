import {
  act,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it } from "vitest";
import { App } from "../app/App";
import { useStore } from "../stores/store";
import { useStudio } from "../studio/selection";
import {
  assetCharacters,
  characterEpisodeUsage,
  characterView,
  characterViewSlots,
  createAssetCharacter,
  generateAssetCharacterViews,
  useAssetCharacterInScene,
} from "../domain/asset-characters";
import { approveVersion, completeStudioJob } from "../domain/studio-commands";
import { episodeContinuity } from "../domain/episode-resources";
import { validateRelations } from "../domain/validation";
import { dataSchema } from "../domain/schemas";
import { installDirectorProject } from "../mocks/director-project";
import { CONFIG } from "../domain/types";

beforeEach(() => {
  useStore.getState().reset();
  useStore.getState().mutate(installDirectorProject);
  useStudio
    .getState()
    .set({ activity: false, settings: false, account: false, palette: false });
});
function mount(query = "character=maya") {
  return render(
    <MemoryRouter initialEntries={[`/assets?mode=demo&${query}`]}>
      <App />
    </MemoryRouter>,
  );
}
it("creates reusable characters without adding a production or episode", () => {
  const data = structuredClone(useStore.getState().data);
  const productions = Object.values(data.projects).filter(
    (project) => !project.unfiled,
  ).length;
  const episodes = Object.keys(data.episodes).length;
  const first = createAssetCharacter(data),
    second = createAssetCharacter(data);
  expect(data.characters[first].projectId).toBe(
    data.characters[second].projectId,
  );
  expect(data.projects[data.characters[first].projectId]).toMatchObject({
    assetLibrary: true,
    unfiled: true,
    episodeIds: [],
  });
  expect(
    Object.values(data.projects).filter((project) => !project.unfiled),
  ).toHaveLength(productions);
  expect(Object.keys(data.episodes)).toHaveLength(episodes);
  expect(dataSchema.parse(data).characters[first]).toBeDefined();
  expect(() => validateRelations(data)).not.toThrow();
});
it("saves identity fields, cancels drafts and finds characters by name", () => {
  mount("character=maya&tab=details");
  fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
    target: { value: "Maya Stone" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Description" }), {
    target: { value: "Short dark hair, calm and observant." },
  });
  expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(useStore.getState().data.characters.maya).toMatchObject({
    name: "Maya Stone",
    appearance: "Short dark hair, calm and observant.",
    description: "Short dark hair, calm and observant.",
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
    target: { value: "Discard me" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(
    "Maya Stone",
  );
  fireEvent.click(screen.getByRole("link", { name: "Characters" }));
  fireEvent.change(screen.getByLabelText("Search characters"), {
    target: { value: "Stone" },
  });
  expect(
    screen.getByRole("button", { name: "Open Maya Stone views" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Open Leo Hart views" }),
  ).not.toBeInTheDocument();
});
it("creates and edits a character through the browser card", () => {
  mount("");
  fireEvent.click(
    screen.getByRole("button", {
      name: "New character",
    }),
  );
  const field = screen.getByRole("textbox", { name: "Name" });
  expect(field).toHaveValue("Untitled character");
  fireEvent.change(field, { target: { value: "Sora" } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(
    assetCharacters(useStore.getState().data).some(
      (character) => character.name === "Sora",
    ),
  ).toBe(true);
});
it("submits the chosen output count and prompt and keeps candidates separate from saved views", () => {
  const data = structuredClone(useStore.getState().data);
  const credits = data.credits;
  const source = data.characters.maya.canonicalVersionId;
  generateAssetCharacterViews(
    data,
    "maya",
    ["profile"],
    2,
    "Left profile in soft studio lighting.",
  );
  const job = Object.values(data.jobs).at(-1)!;
  expect(job).toMatchObject({
    operation: "reference",
    outputCount: 2,
    cost: 16,
  });
  expect(job.specification).toContain("Left profile in soft studio lighting.");
  expect(data.credits).toBe(credits - 2 * CONFIG.imageCost);
  expect(data.characters.maya.canonicalVersionId).toBe(source);
  expect(() => generateAssetCharacterViews(data, "maya", ["profile"])).toThrow(
    /already generating/,
  );
  job.state = "running";
  completeStudioJob(data, job.id);
  expect(job.outputVersionIds).toHaveLength(2);
  expect(characterView(data, data.characters.maya, "profile").ready).toBe(
    false,
  );
  approveVersion(data, job.outputVersionIds![0]);
  expect(characterView(data, data.characters.maya, "profile").ready).toBe(true);
  expect(data.characters.maya.canonicalVersionId).toBe(source);
  expect(() => validateRelations(dataSchema.parse(data))).not.toThrow();
});
it("lets the Views workspace generate, inspect, compare and choose real candidates", () => {
  mount("character=maya&tab=views&view=profile");
  const prior = screen
    .getByLabelText("Generated candidates")
    .querySelectorAll("button").length;
  fireEvent.change(screen.getByLabelText("Output count"), {
    target: { value: "2" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: /Generate 2 views · 16 cr/ }),
  );
  const jobId = Object.values(useStore.getState().data.jobs).at(-1)!.id;
  act(() =>
    useStore.getState().mutate((data) => {
      data.jobs[jobId].state = "running";
      completeStudioJob(data, jobId);
    }),
  );
  const candidates = within(screen.getByLabelText("Generated candidates"));
  expect(candidates.getAllByRole("button")).toHaveLength(prior + 2);
  fireEvent.click(
    candidates.getByRole("button", { name: `Preview candidate ${prior + 2}` }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save as left profile" }));
  expect(
    characterView(
      useStore.getState().data,
      useStore.getState().data.characters.maya,
      "profile",
    ).ready,
  ).toBe(true);
  expect(
    screen.getByRole("button", { name: "Left profile saved" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Compare" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("Compare candidates");
});
it("generates missing six-view slots with accurate credits without replacing saved views", () => {
  const data = structuredClone(useStore.getState().data);
  const existing = characterView(data, data.characters.maya, "front").currentId;
  const credits = data.credits;
  generateAssetCharacterViews(data, "maya", [
    "profile",
    "right_profile",
    "back",
  ]);
  expect(data.credits).toBe(credits - 24);
  const jobs = Object.values(data.jobs).slice(-3);
  expect(
    jobs.map((job) => data.studio.references[job.target!.id].type),
  ).toEqual(["profile", "right_profile", "back"]);
  for (const job of jobs) {
    job.state = "running";
    completeStudioJob(data, job.id);
    approveVersion(data, job.outputVersionIds![0]);
  }
  expect(characterView(data, data.characters.maya, "front").currentId).toBe(
    existing,
  );
  expect(characterView(data, data.characters.maya, "back").ready).toBe(true);
  expect(() => validateRelations(dataSchema.parse(data))).not.toThrow();
});
it("reuses a source in only the chosen episode with production-owned media and one reusable snapshot", () => {
  const data = structuredClone(useStore.getState().data);
  const source = structuredClone(data.characters.maya);
  const copy = useAssetCharacterInScene(data, "maya", "letter-reunion");
  expect(copy).not.toBe("maya");
  expect(data.characters[copy]).toMatchObject({
    sourceCharacterId: "maya",
    projectId: "last-letter",
    name: source.name,
  });
  expect(data.characters.maya).toEqual(source);
  expect(
    episodeContinuity(data, "last-letter-ep3").cast.some(
      (cast) => cast.id === copy,
    ),
  ).toBe(true);
  expect(
    characterEpisodeUsage(data, "maya").some(
      (episode) => episode.id === "last-letter-ep3",
    ),
  ).toBe(true);
  expect(assetCharacters(data).some((character) => character.id === copy)).toBe(
    false,
  );
  const version =
    data.studio.versions[data.characters[copy].canonicalVersionId!];
  expect(data.assets[version.assetId].projectId).toBe("last-letter");
  for (const slot of characterViewSlots)
    expect(characterView(data, data.characters[copy], slot.type).ready).toBe(
      characterView(data, data.characters.maya, slot.type).ready,
    );
  expect(useAssetCharacterInScene(data, "maya", "letter-arrival")).toBe(copy);
  expect(() => validateRelations(dataSchema.parse(data))).not.toThrow();
});
it("keeps generation primary and rejects locked or archived assignment targets", () => {
  mount("character=maya&tab=views");
  expect(
    screen.queryByRole("button", { name: "Use in an episode" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("form", { name: "Generate views" }),
  ).toBeInTheDocument();
  const data = structuredClone(useStore.getState().data);
  data.shots[data.scenes["letter-reunion"].shotIds[0]].locked = true;
  expect(() =>
    useAssetCharacterInScene(data, "maya", "letter-reunion"),
  ).toThrow(/Unlock/);
  data.episodes["last-letter-ep3"].archived = true;
  expect(() =>
    useAssetCharacterInScene(data, "maya", "letter-reunion"),
  ).toThrow(/active episode scene/);
});

it("uploads an identity candidate without charging and requires explicit selection", async () => {
  mount("character=maya&tab=views&view=front");
  const credits = useStore.getState().data.credits;
  const current = useStore.getState().data.characters.maya.canonicalVersionId;
  const prior = Object.keys(useStore.getState().data.studio.versions).length;
  fireEvent.change(screen.getByLabelText("Upload reference image"), {
    target: {
      files: [new File(["portrait"], "portrait.png", { type: "image/png" })],
    },
  });
  await waitFor(() =>
    expect(Object.keys(useStore.getState().data.studio.versions)).toHaveLength(
      prior + 1,
    ),
  );
  expect(useStore.getState().data.credits).toBe(credits);
  expect(useStore.getState().data.characters.maya.canonicalVersionId).toBe(
    current,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Save as front portrait" }),
  );
  const data = useStore.getState().data;
  expect(data.characters.maya.canonicalVersionId).not.toBe(current);
  expect(data.characters.maya.reference).toMatch(/^data:image\/png;base64,/);
  expect(() => validateRelations(dataSchema.parse(data))).not.toThrow();
});
