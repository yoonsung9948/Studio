import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it } from "vitest";
import { App } from "../app/App";
import { seed } from "../mocks/seed";
import { installDirectorProject } from "../mocks/director-project";
import { useStore } from "../stores/store";
import { useStudio } from "../studio/selection";
import { updateScenePlan } from "../domain/workflow";
import { sceneOutlineSummary } from "../domain/scene-text";
import { proposeSceneAssistance } from "../domain/scene-assistance";
import {
  generationInputSnapshot,
  generationInputs,
} from "../domain/generation-inputs";
import { produceProgress, scenePreview } from "../domain/produce";
import { createWorldElement } from "../domain/workspace";
import { ReferencePicker } from "../studio/produce/ReferencePicker";
import { DraftField } from "../studio/design/Primitives";
import { SaveStatus, usePendingEdits } from "../studio/design/SavingState";

const sceneId = "letter-reunion",
  shotId = "letter-reunion-q1";
beforeEach(() => {
  useStore.getState().reset();
  useStore.getState().mutate(installDirectorProject);
  useStore.getState().setNotice("");
  usePendingEdits.setState({ ids: new Set() });
  useStudio
    .getState()
    .set({ activity: false, settings: false, account: false, palette: false });
});
function mount() {
  return render(
    <MemoryRouter
      initialEntries={[
        `/projects/last-letter/episodes/last-letter-ep3?stage=plan&scene=${sceneId}&shot=${shotId}&mode=demo`,
      ]}
    >
      <App />
    </MemoryRouter>,
  );
}
function sceneEditorTitle() {
  return within(screen.getByRole("region", { name: "Scene editor" })).getByRole(
    "heading",
    { level: 2 },
  );
}
function otherScene() {
  const data = useStore.getState().data;
  return data.scenes[
    data.episodes["last-letter-ep3"].sceneIds.find((id) => id !== sceneId)!
  ];
}
function selectScene(title: string) {
  fireEvent.click(
    within(
      screen.getByRole("complementary", { name: "Scene outline" }),
    ).getByRole("button", { name: `Plan ${title}` }),
  );
}
it("keeps pencil-activated titles synchronized between outline cards and the script, without a shot-plan title field", () => {
  mount();
  expect(
    screen.queryByRole("textbox", { name: "Scene title" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByLabelText("Scene title in shot plan"),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Edit scene title" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Scene title" }), {
    target: { value: "The return" },
  });
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Scene title" }), {
    key: "Enter",
  });
  expect(
    screen.getByRole("button", { name: "Edit scene title The return" }),
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Edit scene title The return" }),
  );
  expect(
    screen.getByRole("textbox", { name: "Scene title for The return" }),
  ).toHaveFocus();
  fireEvent.change(
    screen.getByRole("textbox", { name: "Scene title for The return" }),
    { target: { value: "The second return" } },
  );
  fireEvent.keyDown(
    screen.getByRole("textbox", { name: "Scene title for The return" }),
    { key: "Enter" },
  );
  expect(
    within(screen.getByRole("region", { name: "Scene editor" })).getByRole(
      "heading",
      { name: "The second return" },
    ),
  ).toBeVisible();
});
it("renames an unselected outline card without changing the scene being edited", () => {
  const other = otherScene();
  mount();
  fireEvent.click(
    screen.getByRole("button", { name: `Edit scene title ${other.title}` }),
  );
  fireEvent.change(
    screen.getByRole("textbox", { name: `Scene title for ${other.title}` }),
    { target: { value: "A renamed arrival" } },
  );
  fireEvent.blur(
    screen.getByRole("textbox", { name: `Scene title for ${other.title}` }),
  );
  expect(useStore.getState().data.scenes[other.id].title).toBe(
    "A renamed arrival",
  );
  expect(sceneEditorTitle()).toHaveTextContent("The reunion");
});
it("cancels script title edits with Escape and saves them on blur", () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Edit scene title" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Scene title" }), {
    target: { value: "Discard me" },
  });
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Scene title" }), {
    key: "Escape",
  });
  expect(useStore.getState().data.scenes[sceneId].title).toBe("The reunion");
  expect(
    screen.getByRole("button", { name: "Edit scene title" }),
  ).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Edit scene title" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Scene title" }), {
    target: { value: "Saved on blur" },
  });
  fireEvent.blur(screen.getByRole("textbox", { name: "Scene title" }));
  expect(useStore.getState().data.scenes[sceneId].title).toBe("Saved on blur");
});
it("derives outline descriptions from script edits without showing a summary field", () => {
  mount();
  const before = useStore.getState().data.scenes[sceneId].description;
  expect(screen.queryByLabelText("Scene summary")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Scene screenplay"), {
    target: { value: "EXT. PIER — DAWN\n\nMaya returns the blue umbrella." },
  });
  fireEvent.blur(screen.getByLabelText("Scene screenplay"));
  expect(
    within(
      screen.getByRole("complementary", { name: "Scene outline" }),
    ).getByRole("button", { name: "Plan The reunion" }),
  ).toHaveTextContent("Maya returns the blue umbrella.");
  expect(useStore.getState().data.scenes[sceneId].description).toBe(before);
});
it("renames metadata without invalidating media, while screenplay changes invalidate it", () => {
  const data = structuredClone(useStore.getState().data);
  const shots = data.scenes[sceneId].shotIds.map((id) =>
    structuredClone(data.shots[id]),
  );
  const takes = structuredClone(data.takes),
    revision = data.scenes[sceneId].planRevision;
  updateScenePlan(data, sceneId, { title: "New name" });
  expect(data.scenes[sceneId].planRevision).toBe(revision);
  expect(data.scenes[sceneId].shotIds.map((id) => data.shots[id])).toEqual(
    shots,
  );
  expect(data.takes).toEqual(takes);
  expect(() =>
    updateScenePlan(data, sceneId, { title: "x".repeat(121) }),
  ).toThrow(/1–120/);
  updateScenePlan(data, sceneId, {
    screenplay: "INT. CAFE — NIGHT\n\nMaya opens the blue umbrella.",
  });
  expect(data.shots[shotId].revision).toBeGreaterThan(shots[0].revision);
  expect(generationInputSnapshot(data, shotId).sourceScript).toContain(
    "blue umbrella",
  );
});
it("derives suggested coverage from current screenplay rather than old summary or shot text", () => {
  const data = structuredClone(useStore.getState().data);
  data.scenes[sceneId].description = "An obsolete summary about a letter.";
  data.scenes[sceneId].screenplay =
    "EXT. PIER — DAWN\n\nMaya drops a blue umbrella.\n\nJun catches it before it falls into the water.";
  const proposal = proposeSceneAssistance(data, sceneId);
  expect(proposal.shots.map((shot) => shot.action).join(" ")).toContain(
    "blue umbrella",
  );
  expect(proposal.shots.map((shot) => shot.action).join(" ")).toContain(
    "Jun catches it",
  );
  expect(proposal.shots.map((shot) => shot.action).join(" ")).not.toContain(
    "obsolete summary",
  );
});
it("preserves edited suggested-shot drafts separately for each scene", () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Suggest shots" }));
  fireEvent.change(screen.getByLabelText("Suggested shot title"), {
    target: { value: "My umbrella shot" },
  });
  const other = otherScene();
  selectScene(other.title);
  expect(
    screen.queryByLabelText("Suggested shot title"),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Suggest shots" }));
  fireEvent.change(screen.getByLabelText("Suggested shot title"), {
    target: { value: "Other scene draft" },
  });
  selectScene("The reunion");
  expect(screen.getByLabelText("Suggested shot title")).toHaveValue(
    "My umbrella shot",
  );
  fireEvent.click(screen.getByRole("button", { name: "Discard" }));
  selectScene(other.title);
  expect(screen.getByLabelText("Suggested shot title")).toHaveValue(
    "Other scene draft",
  );
});
it("closes reference drafts on scene changes without applying them to either scene", () => {
  mount();
  const other = otherScene(),
    before = structuredClone(useStore.getState().data.studio.setups);
  fireEvent.click(screen.getByRole("button", { name: "Edit references" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("The reunion");
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Maya" }),
  );
  selectScene(other.title);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(useStore.getState().data.studio.setups).toEqual(before);
});
it("resets the picker when its target changes and blocks concurrently stale selections", () => {
  const other = otherScene(),
    close = () => {};
  const view = render(
    <MemoryRouter>
      <ReferencePicker sceneId={sceneId} onClose={close} />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Maya" }));
  view.rerender(
    <MemoryRouter>
      <ReferencePicker sceneId={other.id} onClose={close} />
    </MemoryRouter>,
  );
  expect(screen.getByRole("dialog")).toHaveTextContent(other.title);
  expect(screen.getByRole("button", { name: "Maya" })).toHaveAttribute(
    "aria-pressed",
    String(
      useStore
        .getState()
        .data.studio.setups[other.id].cast.some(
          (item) => item.characterId === "letter-maya",
        ),
    ),
  );
  act(() =>
    useStore.getState().mutate((data) => {
      data.studio.setups[other.id].revision++;
    }),
  );
  expect(
    screen.getByRole("button", { name: "Apply references" }),
  ).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Scene references changed",
  );
});
it("limits places and props to the episode, while offering the episode references path", () => {
  useStore.getState().mutate((data) => {
    const source = Object.values(data.studio.locations).find(
      (item) => item.projectId === "last-letter",
    )!;
    data.studio.locations["unlinked-place"] = {
      ...source,
      id: "unlinked-place",
      name: "Unlinked warehouse",
    };
    createWorldElement(data, "last-letter", "prop", "Unlinked compass");
  });
  render(
    <MemoryRouter>
      <ReferencePicker sceneId={sceneId} onClose={() => {}} />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Places" }));
  expect(
    screen.queryByRole("button", { name: "Unlinked warehouse" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Props" }));
  expect(
    screen.queryByRole("button", { name: "Unlinked compass" }),
  ).not.toBeInTheDocument();
  act(() =>
    useStore.getState().mutate((data) => {
      data.episodes["last-letter-ep3"].propIds = [];
      for (const id of data.episodes["last-letter-ep3"].sceneIds) {
        data.studio.setups[id].worldElementIds = [];
        for (const shot of data.scenes[id].shotIds)
          data.shots[shot].worldElementIds = [];
      }
    }),
  );
  expect(
    screen.getByRole("link", { name: "Open episode References" }),
  ).toHaveAttribute(
    "href",
    "/projects/last-letter/episodes/last-letter-ep3/references?kind=props",
  );
});
it("omits continuity notes from foundations while preserving the sound controls", () => {
  mount();
  const panel = within(
    screen.getByRole("complementary", { name: "Scene planning inspector" }),
  );
  expect(
    panel.queryByText("Continuity notes (advanced)"),
  ).not.toBeInTheDocument();
  expect(
    panel.queryByLabelText("Continuity instructions"),
  ).not.toBeInTheDocument();
  expect(panel.getByText("Sound notes (optional)")).toBeVisible();
});
it("keeps scene artwork in planning and provides a distinct link to its generated shot", () => {
  mount();
  const before = scenePreview(useStore.getState().data, sceneId);
  expect(before.sample).toBe(false);
  selectScene("The reunion");
  expect(screen.getByLabelText("Scene screenplay")).toBeVisible();
  fireEvent.click(
    screen.getByRole("link", { name: "Open generated shot for The reunion" }),
  );
  expect(screen.queryByLabelText("Scene screenplay")).not.toBeInTheDocument();
  expect(
    within(
      screen.getByRole("navigation", { name: "Production stages" }),
    ).getByRole("button", { name: "Shots" }),
  ).toHaveAttribute("aria-current", "step");
});
it("reports pending edits and storage errors instead of hardcoded saved labels", () => {
  render(
    <>
      <DraftField label="Test save field" value="before" onSave={() => {}} />
      <SaveStatus />
    </>,
  );
  fireEvent.change(screen.getByLabelText("Test save field"), {
    target: { value: "after" },
  });
  expect(screen.getByRole("status")).toHaveTextContent("Saving…");
  act(() => useStore.setState({ storageFailed: true }));
  expect(screen.getByRole("status")).toHaveTextContent("Save failed");
});
it("does not complete planning for an empty scene or frames for an unavailable selected image", () => {
  const data = structuredClone(useStore.getState().data);
  expect(produceProgress(data, "last-letter-ep3")[0]).toBe(true);
  const first = data.episodes["last-letter-ep3"].sceneIds[0];
  data.scenes[first].shotIds = [];
  expect(produceProgress(data, "last-letter-ep3")).toEqual([
    false,
    false,
    false,
  ]);
  const bare = seed();
  expect(produceProgress(bare, "missing")).toEqual([false, false, false]);
});
it("requires active, current chosen frames and takes to report completion", () => {
  const data = structuredClone(useStore.getState().data);
  const episode = data.episodes["last-letter-ep3"];
  for (const id of episode.sceneIds)
    for (const qid of data.scenes[id].shotIds) {
      const shot = data.shots[qid],
        image = data.takes[shot.imageTakeId!]!;
      shot.generationOverride = {
        ...shot.generationOverride,
        startingFrameAssetId: image.assetId,
      };
      image.approved = true;
      image.revision = shot.revision;
      const videoId = `test-video-${qid}`,
        assetId = `test-asset-${qid}`;
      data.assets[assetId] = {
        ...data.assets[image.assetId],
        id: assetId,
        kind: "video",
      };
      data.takes[videoId] = {
        ...image,
        id: videoId,
        kind: "video",
        assetId,
        approved: true,
        revision: shot.revision,
      };
      shot.currentTakeId = videoId;
      shot.stale = false;
    }
  expect(produceProgress(data, episode.id)).toEqual([true, true, true]);
  data.assets[
    generationInputs(data, sceneId, shotId).startingFrameAssetId!
  ].missing = true;
  expect(produceProgress(data, episode.id)).toEqual([true, false, false]);
  data.assets[
    generationInputs(data, sceneId, shotId).startingFrameAssetId!
  ].missing = false;
  data.shots[shotId].stale = true;
  expect(produceProgress(data, episode.id)).toEqual([true, true, false]);
  data.shots[shotId].stale = false;
  data.shots[shotId].discardedTakeIds = [data.shots[shotId].imageTakeId!];
  expect(produceProgress(data, episode.id)).toEqual([true, false, false]);
});

it("derives concise outline copy from screenplay only and leaves an empty script empty", () => {
  const data = structuredClone(useStore.getState().data);
  data.scenes[sceneId].description = "Obsolete independent summary";
  data.scenes[sceneId].screenplay =
    "INT. CAFE — NIGHT\n\nMaya returns the umbrella.";
  expect(sceneOutlineSummary(data, sceneId)).toBe("Maya returns the umbrella.");
  data.scenes[sceneId].screenplay = "A long action unfolds. ".repeat(20);
  expect(sceneOutlineSummary(data, sceneId).length).toBeLessThanOrEqual(160);
  expect(sceneOutlineSummary(data, sceneId)).toMatch(/…$/);
  data.scenes[sceneId].screenplay = "";
  expect(sceneOutlineSummary(data, sceneId)).toBe("");
});

it("omits the chosen-frame badge without changing the selected frame", () => {
  const data = useStore.getState().data;
  const before = data.shots[shotId].imageTakeId;
  mount();
  expect(screen.queryByText("Chosen frame")).not.toBeInTheDocument();
  expect(useStore.getState().data.shots[shotId].imageTakeId).toBe(before);
});
it("deletes the selected scene, removes its clips, and restores it with Undo", () => {
  const before = structuredClone(useStore.getState().data);
  const other = otherScene();
  mount();
  fireEvent.click(
    screen.getByRole("button", { name: "Delete scene The reunion" }),
  );
  const data = useStore.getState().data;
  expect(data.scenes[sceneId].archived).toBe(true);
  expect(data.episodes["last-letter-ep3"].sceneIds).not.toContain(sceneId);
  expect(
    screen.queryByRole("button", { name: "Plan The reunion" }),
  ).not.toBeInTheDocument();
  expect(sceneEditorTitle()).not.toHaveTextContent("The reunion");
  expect(Object.keys(data.assets)).toEqual(Object.keys(before.assets));
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(useStore.getState().data.scenes[sceneId]).toEqual(
    before.scenes[sceneId],
  );
  expect(useStore.getState().data.episodes["last-letter-ep3"].sceneIds).toEqual(
    before.episodes["last-letter-ep3"].sceneIds,
  );
  expect(
    screen.getByRole("button", { name: "Plan The reunion" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: `Plan ${other.title}` }),
  ).toBeInTheDocument();
});
it("deletes an unselected scene without changing the scene currently being edited", () => {
  const other = otherScene();
  mount();
  fireEvent.click(
    screen.getByRole("button", { name: `Delete scene ${other.title}` }),
  );
  expect(sceneEditorTitle()).toHaveTextContent("The reunion");
});
it("can delete the final scene and create a new one from the empty state", () => {
  useStore.getState().mutate((data) => {
    data.episodes["last-letter-ep3"].sceneIds = [sceneId];
  });
  mount();
  fireEvent.click(
    screen.getByRole("button", { name: "Delete scene The reunion" }),
  );
  expect(screen.getByText("Every story starts with a scene.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Add scene" }));
  const ids = useStore.getState().data.episodes["last-letter-ep3"].sceneIds;
  expect(ids).toHaveLength(1);
  expect(ids[0]).not.toBe(sceneId);
  expect(sceneEditorTitle()).toHaveTextContent(
    useStore.getState().data.scenes[ids[0]].title,
  );
});
