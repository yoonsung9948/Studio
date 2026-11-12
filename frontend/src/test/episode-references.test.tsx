import { retryJob } from "../domain/commands";
import { episodeLookJobDestination } from "../studio/references/paths";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it } from "vitest";
import { App } from "../app/App";
import { recover, useStore } from "../stores/store";
import { useSelection, useStudio } from "../studio/selection";
import { installDirectorProject } from "../mocks/director-project";
import {
  createWorkspaceEpisode,
  addWorkspaceScene,
  addWorkspaceShot,
} from "../domain/workspace";
import {
  assignEpisodeLook,
  createEpisodeLook,
  episodeCharacterLooks,
  episodeLookView,
  episodeReferenceCharacters,
  generateEpisodeLookViews,
  linkCharacterToEpisode,
  localizeEpisodeLook,
  lookSceneUsage,
} from "../domain/episode-characters";
import {
  approveVersion,
  completeStudioJob,
  setSceneCast,
  updateLook,
} from "../domain/studio-commands";
import {
  characterLooks,
  lookReady,
  versionAsset,
} from "../domain/studio-selectors";
import {
  episodeContinuity,
  episodeMediaAssetIds,
} from "../domain/episode-resources";
import { dataSchema } from "../domain/schemas";
import { validateRelations } from "../domain/validation";
import { updateShotPlan } from "../domain/scene-preflight";
let episodeId = "",
  siblingId = "",
  sceneId = "",
  siblingScene = "";
const path = () => `/projects/midnight/episodes/${episodeId}/references`;
beforeEach(() => {
  useStore.getState().reset();
  useStore.getState().mutate((data) => {
    installDirectorProject(data);
    episodeId = createWorkspaceEpisode(data, "midnight", "");
    siblingId = createWorkspaceEpisode(data, "midnight", "");
    data.episodes[episodeId].title = "The reunion";
    sceneId = addWorkspaceScene(data, episodeId);
    data.scenes[sceneId].title = "Café arrival";
    siblingScene = addWorkspaceScene(data, siblingId);
    addWorkspaceShot(data, sceneId);
    addWorkspaceShot(data, siblingScene);
  });
  useSelection.getState().replace([]);
  useStudio
    .getState()
    .set({ activity: false, settings: false, account: false, palette: false });
});
const mount = (url = path()) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <App />
    </MemoryRouter>,
  );
it("links an Assets identity to exactly one episode without assigning scenes", () => {
  const data = structuredClone(useStore.getState().data),
    before = structuredClone(data.studio.setups[sceneId]);
  const id = linkCharacterToEpisode(data, episodeId, "letter-maya");
  expect(data.characters[id]).toMatchObject({
    projectId: "midnight",
    sourceCharacterId: "letter-maya",
  });
  expect(
    episodeReferenceCharacters(data, episodeId).map(
      (character) => character.id,
    ),
  ).toEqual([id]);
  expect(episodeReferenceCharacters(data, siblingId)).toHaveLength(0);
  expect(data.studio.setups[sceneId]).toEqual(before);
  expect(episodeContinuity(data, episodeId).cast).toHaveLength(0);
  expect(episodeMediaAssetIds(data, episodeId)).toContain(
    data.studio.versions[data.characters[id].canonicalVersionId!].assetId,
  );
  expect(linkCharacterToEpisode(data, episodeId, "letter-maya")).toBe(id);
  expect(data.episodes[episodeId].characterIds).toEqual([id]);
  expect(() => validateRelations(dataSchema.parse(data))).not.toThrow();
});
it("keeps looks and assignments isolated for two episodes using the same character", () => {
  const data = structuredClone(useStore.getState().data);
  linkCharacterToEpisode(data, episodeId, "maya");
  linkCharacterToEpisode(data, siblingId, "maya");
  const look = createEpisodeLook(data, episodeId, "maya", "Evening coat");
  const other = createEpisodeLook(data, siblingId, "maya", "Raincoat");
  assignEpisodeLook(data, episodeId, look, [sceneId]);
  expect(
    episodeCharacterLooks(data, episodeId, "maya").map((item) => item.id),
  ).toEqual([look]);
  expect(
    characterLooks(data, "maya", siblingId).some((item) => item.id === look),
  ).toBe(false);
  expect(data.studio.setups[siblingScene].cast).toEqual([]);
  expect(() =>
    assignEpisodeLook(data, siblingId, look, [siblingScene]),
  ).toThrow(/episode/);
  expect(() =>
    setSceneCast(data, siblingScene, [{ characterId: "maya", lookId: look }]),
  ).toThrow(/episode/);
  expect(() =>
    updateShotPlan(data, data.scenes[siblingScene].shotIds[0], {
      castOverride: [{ characterId: "maya", lookId: look }],
    }),
  ).toThrow(/episode/);
  expect(data.studio.looks[other].episodeId).toBe(siblingId);
  expect(() => validateRelations(dataSchema.parse(data))).not.toThrow();
});
it("preserves explicit shot overrides and blocks locked or foreign scene assignments", () => {
  const data = structuredClone(useStore.getState().data);
  linkCharacterToEpisode(data, episodeId, "maya");
  const look = createEpisodeLook(data, episodeId, "maya");
  const first = data.scenes[sceneId].shotIds[0];
  const second = addWorkspaceShot(data, sceneId);
  data.shots[first].castOverride = [{ characterId: "leo" }];
  assignEpisodeLook(data, episodeId, look, [sceneId]);
  expect(data.shots[first].castOverride).toEqual([{ characterId: "leo" }]);
  expect(data.shots[second].characters).toContain("maya");
  expect(lookSceneUsage(data, episodeId, look)[0].shots).toBe(
    data.scenes[sceneId].shotIds.length - 1,
  );
  data.shots[second].locked = true;
  const next = createEpisodeLook(data, episodeId, "maya", "Another");
  expect(() => assignEpisodeLook(data, episodeId, next, [sceneId])).toThrow(
    /Unlock/,
  );
  expect(() =>
    assignEpisodeLook(data, episodeId, next, [siblingScene]),
  ).toThrow(/episode/);
});
it("copies legacy shared looks and views without changing another episode or invalidating identical footage", () => {
  const data = structuredClone(useStore.getState().data);
  setSceneCast(data, siblingScene, [
    { characterId: "maya", lookId: "maya-look-1" },
  ]);
  const before = structuredClone(data.studio.setups[siblingScene]);
  const shots = data.scenes["ep1-s1"].shotIds.map((id) => ({
    ...data.shots[id],
  }));
  const id = localizeEpisodeLook(data, "ep1", "maya-look-1");
  expect(data.studio.looks[id]).toMatchObject({
    episodeId: "ep1",
    sourceLookId: "maya-look-1",
  });
  expect(data.studio.setups[siblingScene]).toEqual(before);
  expect(lookReady(data, id)).toBe(lookReady(data, "maya-look-1"));
  expect(versionAsset(data, data.studio.looks[id].primaryVersionId)?.url).toBe(
    versionAsset(data, data.studio.looks["maya-look-1"].primaryVersionId)?.url,
  );
  expect(localizeEpisodeLook(data, "ep1", "maya-look-1")).toBe(id);
  expect(data.scenes["ep1-s1"].shotIds.map((id) => data.shots[id])).toEqual(
    shots,
  );
  updateLook(data, id, { description: "A navy coat" });
  expect(data.studio.looks["maya-look-1"].description).not.toBe("A navy coat");
  expect(() => validateRelations(dataSchema.parse(data))).not.toThrow();
});
it("generates look-specific views, charges exact credits, and keeps the source identity unchanged", () => {
  const data = structuredClone(useStore.getState().data);
  linkCharacterToEpisode(data, episodeId, "maya");
  const id = createEpisodeLook(data, episodeId, "maya", "Evening coat");
  updateLook(data, id, { description: "Navy coat and cream scarf." });
  const canonical = data.characters.maya.canonicalVersionId,
    credits = data.credits;
  generateEpisodeLookViews(
    data,
    episodeId,
    id,
    ["front"],
    2,
    "Keep her face and haircut.",
  );
  let job = Object.values(data.jobs).at(-1)!;
  expect(job).toMatchObject({ operation: "look", outputCount: 2, cost: 16 });
  expect(job.specification).toContain("Navy coat and cream scarf.");
  job.state = "running";
  completeStudioJob(data, job.id);
  approveVersion(data, job.outputVersionIds![0]);
  const primary = data.studio.looks[id].primaryVersionId;
  generateEpisodeLookViews(
    data,
    episodeId,
    id,
    ["full_body"],
    1,
    "Full body, neutral backdrop.",
  );
  job = Object.values(data.jobs).at(-1)!;
  expect(job.sourceLookVersionId).toBe(primary);
  expect(episodeLookJobDestination(data, job)?.path).toBe(
    `/projects/midnight/episodes/${episodeId}/references/characters/maya/looks/${id}?tab=views&view=full_body`,
  );
  job.state = "running";
  completeStudioJob(data, job.id);
  approveVersion(data, job.outputVersionIds![0]);
  expect(episodeLookView(data, id, "full_body").ready).toBe(true);
  expect(data.characters.maya.canonicalVersionId).toBe(canonical);
  expect(data.credits).toBe(credits - 24);
  expect(() => validateRelations(dataSchema.parse(data))).not.toThrow();
});
it("shows Add from Assets, links an identity only, and keeps the sibling episode empty", () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Add from Assets" }));
  const drawer = within(screen.getByRole("dialog"));
  fireEvent.change(drawer.getByLabelText("Search asset characters"), {
    target: { value: "Maya Chen" },
  });
  fireEvent.click(drawer.getByRole("button", { name: "Choose Maya Chen" }));
  fireEvent.click(drawer.getByRole("button", { name: "Add identity only" }));
  expect(
    screen.getByRole("heading", { name: "Maya Chen" }),
  ).toBeInTheDocument();
  expect(useStore.getState().data.studio.setups[sceneId].cast).toEqual([]);
  expect(
    episodeReferenceCharacters(useStore.getState().data, siblingId),
  ).toHaveLength(0);
});
it("creates an episode look, saves details and keeps scene assignment secondary", () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Add from Assets" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Add Maya Chen and create a look" }),
  );
  expect(
    screen.getByRole("form", { name: "Generate views" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Details" }));
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Evening coat" },
  });
  fireEvent.change(screen.getByLabelText("Description"), {
    target: { value: "Navy wool coat and cream scarf." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  fireEvent.click(screen.getByRole("button", { name: "Assign to scenes" }));
  const dialog = within(screen.getByRole("dialog"));
  fireEvent.click(dialog.getByRole("checkbox", { name: /Café arrival/ }));
  fireEvent.click(dialog.getByRole("button", { name: "Assign to 1 scene" }));
  expect(
    screen.getByRole("link", { name: /Café arrival.*Open scene/ }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Views" }));
  expect(
    screen.getByRole("complementary", { name: "Saved views" }),
  ).toHaveTextContent("0 / 4");
  expect(
    screen.getByRole("button", { name: "Generate 2 views · 16 cr" }),
  ).toBeEnabled();
});

it("rejects a look URL under a different episode", () => {
  let id = "";
  useStore.getState().mutate((data) => {
    linkCharacterToEpisode(data, episodeId, "maya");
    id = createEpisodeLook(data, episodeId, "maya");
  });
  mount(
    `/projects/midnight/episodes/${siblingId}/references/characters/maya/looks/${id}`,
  );
  expect(screen.getByText("Look unavailable.")).toBeInTheDocument();
  expect(screen.queryByLabelText("Look view prompt")).not.toBeInTheDocument();
});
it("keeps Home and scoped sidebar destinations, and displays the live credit balance instead of New film", () => {
  mount();
  const sidebar = within(
    screen.getByRole("complementary", { name: "Studio navigation" }),
  );
  expect(sidebar.getByRole("button", { name: "Home" })).toBeInTheDocument();
  expect(sidebar.getByRole("button", { name: "References" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const header = within(
    screen.getByRole("banner", { name: "Account and credits" }),
  );
  expect(
    header.queryByRole("button", { name: "New film" }),
  ).not.toBeInTheDocument();
  act(() =>
    useStore.getState().mutate((data) => {
      data.credits = 1176;
    }),
  );
  fireEvent.click(
    header.getByRole("button", { name: "1,176 credits remaining" }),
  );
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});

it("keeps retry count, prompt and episode context for look jobs", () => {
  const data = structuredClone(useStore.getState().data);
  linkCharacterToEpisode(data, episodeId, "maya");
  const id = createEpisodeLook(data, episodeId, "maya", "Evening coat");
  updateLook(data, id, { description: "Navy coat and cream scarf." });
  generateEpisodeLookViews(
    data,
    episodeId,
    id,
    ["front"],
    2,
    "Warm neutral backdrop.",
  );
  const job = Object.values(data.jobs).at(-1)!;
  job.state = "failed";
  const credits = data.credits;
  retryJob(data, job.id);
  const retry = Object.values(data.jobs).at(-1)!;
  expect(retry).toMatchObject({
    episodeId,
    outputCount: 2,
    cost: 16,
    specification: job.specification,
  });
  expect(data.credits).toBe(credits - 16);
  expect(episodeLookJobDestination(data, retry)?.path).toContain(
    `/episodes/${episodeId}/references/characters/maya/looks/${id}?tab=views`,
  );
});

it("restores saved episode links and looks without resetting the workspace", () => {
  const data = structuredClone(useStore.getState().data);
  linkCharacterToEpisode(data, episodeId, "maya");
  const lookId = createEpisodeLook(data, episodeId, "maya", "Evening coat");
  assignEpisodeLook(data, episodeId, lookId, [sceneId]);
  const restored = recover(
    JSON.stringify({ version: 3, data, ui: useStore.getState().ui }),
  );
  expect(restored.notice).toBe("");
  expect(restored.data.episodes[episodeId].characterIds).toContain("maya");
  expect(restored.data.studio.looks[lookId].episodeId).toBe(episodeId);
  expect(restored.data.studio.setups[sceneId].cast).toContainEqual({
    characterId: "maya",
    lookId,
  });
});
