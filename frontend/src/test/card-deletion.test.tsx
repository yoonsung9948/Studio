import { beforeEach, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../app/App";
import { useStore, recover } from "../stores/store";
import { useSelection, useStudio } from "../studio/selection";
import { deleteCardSelection } from "../domain/card-deletion";
import { validateRelations } from "../domain/validation";
beforeEach(() => {
  useStore.getState().reset();
  useSelection.getState().replace([]);
  useStudio.getState().set({
    activity: false,
    navigation: false,
    settings: false,
    account: false,
    palette: false,
  });
});
const mount = (path = "/work?mode=demo") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
it("deletes the entire selected set through right-click and restores it with Undo", () => {
  mount();
  const all = screen.getByRole("group", { name: "All work" });
  const cards = within(all).getAllByRole("article"),
    first = cards[0],
    second = cards[1];
  const keys = [first.dataset.selectionKey, second.dataset.selectionKey];
  fireEvent.click(first);
  fireEvent.click(second, { metaKey: true });
  fireEvent.contextMenu(all);
  expect(useSelection.getState().keys).toEqual(keys);
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
  for (const key of keys)
    expect(all.querySelector(`[data-selection-key="${key}"]`)).toBeNull();
  expect(within(all).getAllByRole("article")).toHaveLength(cards.length - 2);
  expect(screen.getByRole("status")).toHaveTextContent("2 items deleted");
  validateRelations(useStore.getState().data);
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  for (const key of keys)
    expect(all.querySelector(`[data-selection-key="${key}"]`)).not.toBeNull();
  validateRelations(useStore.getState().data);
});
it("right-clicking an unselected card targets that card without deleting an old selection", () => {
  mount();
  const all = screen.getByRole("group", { name: "All work" });
  const [first, second] = within(all).getAllByRole("article");
  fireEvent.click(first);
  fireEvent.contextMenu(second);
  expect(useSelection.getState().keys).toEqual([second.dataset.selectionKey]);
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
  expect(first).toBeInTheDocument();
  expect(second).not.toBeInTheDocument();
});
it("removes selected project cards and their work from Home while preserving media for Undo", () => {
  mount();
  const project = within(
    screen.getByRole("group", { name: "Projects cards" }),
  ).getByRole("article", { name: "Project Midnight Secrets" });
  const assets = Object.keys(useStore.getState().data.assets);
  fireEvent.contextMenu(project);
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
  expect(
    screen.queryByRole("article", { name: "Project Midnight Secrets" }),
  ).not.toBeInTheDocument();
  const all = screen.getByRole("group", { name: "All work" });
  expect(within(all).queryAllByText(/Midnight Secrets/)).toHaveLength(0);
  expect(Object.keys(useStore.getState().data.assets)).toEqual(assets);
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(
    screen.getByRole("article", { name: "Project Midnight Secrets" }),
  ).toBeInTheDocument();
});
it("removes scene cards and restores their timeline position", () => {
  mount();
  fireEvent.change(screen.getByLabelText("Work type"), {
    target: { value: "scenes" },
  });
  const all = screen.getByRole("group", { name: "All work" });
  const card = within(all).getAllByRole("article")[0],
    key = card.dataset.selectionKey!;
  const id = key.slice(key.indexOf(":") + 1);
  const scene = useStore.getState().data.scenes[id],
    order = [...useStore.getState().data.episodes[scene.episodeId].sceneIds];
  fireEvent.contextMenu(card);
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
  expect(all.querySelector(`[data-selection-key="${key}"]`)).toBeNull();
  expect(
    useStore.getState().data.episodes[scene.episodeId].sceneIds,
  ).not.toContain(id);
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(useStore.getState().data.episodes[scene.episodeId].sceneIds).toEqual(
    order,
  );
});
it("deletes a character from World and restores its looks and relationships with Undo", () => {
  mount("/projects/midnight/world");
  const card = screen.getByRole("article", { name: "Character Maya Chen" });
  fireEvent.contextMenu(card);
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
  expect(card).not.toBeInTheDocument();
  validateRelations(useStore.getState().data);
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(
    screen.getByRole("article", { name: "Character Maya Chen" }),
  ).toBeInTheDocument();
  validateRelations(useStore.getState().data);
});
it("persists soft deletion without breaking saved project relationships", () => {
  const data = structuredClone(useStore.getState().data);
  deleteCardSelection(data, [
    "project:midnight",
    "scene:ep2-s1",
    "shot:ep1-s1-q1",
  ]);
  validateRelations(data);
  const saved = recover(
    JSON.stringify({ version: 3, data, ui: useStore.getState().ui }),
  );
  expect(saved.notice).toBe("");
  expect(saved.data.projects.midnight.archived).toBe(true);
  expect(saved.data.shots["ep1-s1-q1"].archived).toBe(true);
});

it("removes deleted-scene clips from the cut and cancels its active generation without deleting media", () => {
  const data = structuredClone(useStore.getState().data);
  const scene = data.scenes["ep1-s1"],
    episode = data.episodes[scene.episodeId];
  const shot = data.shots[scene.shotIds[0]],
    take = data.takes[shot.currentTakeId!];
  const cut = {
    revision: 1,
    clips: [
      {
        id: "deleted-clip",
        shotId: shot.id,
        takeId: take.id,
        inFrame: 0,
        outFrame: 30,
        volume: 1,
      },
    ],
    audio: [],
    captions: false,
    aspectRatio: "16:9" as const,
  };
  episode.cut = cut;
  const jobId = "scene-delete-job";
  data.jobs[jobId] = {
    id: jobId,
    sceneId: scene.id,
    projectId: episode.projectId,
    episodeId: episode.id,
    shotId: shot.id,
    operation: "video",
    state: "queued",
    attempt: 1,
    cost: 24,
    progress: 0,
    revision: shot.revision,
    replacement: true,
  };
  const assets = structuredClone(data.assets);
  deleteCardSelection(data, [`scene:${scene.id}`]);
  expect(episode.cut.clips).toEqual([]);
  expect(episode.cut.revision).toBe(2);
  expect(data.jobs[jobId].state).toBe("canceled");
  expect(data.assets).toEqual(assets);
  validateRelations(data);
});
