import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../app/App";
import { useStore } from "../stores/store";
import { useStudio } from "../studio/selection";
import { generationInputs } from "../domain/generation-inputs";
import { episodeMediaAssetIds } from "../domain/episode-resources";
import { uploadSceneReference } from "../services/scene-reference-upload";
import { saveMediaBlob } from "../services/media-storage";
import { validateRelations } from "../domain/validation";
import { dataSchema } from "../domain/schemas";
vi.mock("../services/media-storage", () => ({
  saveMediaBlob: vi.fn().mockResolvedValue(undefined),
  loadMediaBlob: vi.fn().mockResolvedValue(undefined),
}));
const sceneId = "ep1-s1",
  shotId = "ep1-s1-q1";
beforeEach(() => {
  useStore.getState().reset();
  useStore.getState().setNotice("");
  useStudio
    .getState()
    .set({ activity: false, settings: false, account: false, palette: false });
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn().mockReturnValue("blob:scene-reference"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
  vi.mocked(saveMediaBlob).mockClear();
});
afterEach(() => vi.clearAllMocks());
function mount() {
  render(
    <MemoryRouter
      initialEntries={[
        `/projects/midnight/episodes/ep1?stage=plan&scene=${sceneId}&shot=${shotId}&mode=demo`,
      ]}
    >
      <App />
    </MemoryRouter>,
  );
}
it("previews and discards script enhancement without changing the script, and applies only on confirmation", () => {
  mount();
  const before = useStore.getState().data.scenes[sceneId].screenplay;
  fireEvent.click(screen.getByRole("button", { name: "Enhance script" }));
  let dialog = within(screen.getByRole("dialog"));
  expect(
    (dialog.getByLabelText("Enhanced script") as HTMLTextAreaElement).value,
  ).toContain("VISUAL DIRECTION");
  fireEvent.click(dialog.getByRole("button", { name: "Discard" }));
  expect(useStore.getState().data.scenes[sceneId].screenplay).toBe(before);
  fireEvent.click(screen.getByRole("button", { name: "Enhance script" }));
  dialog = within(screen.getByRole("dialog"));
  fireEvent.change(dialog.getByLabelText("Enhanced script"), {
    target: { value: "INT. APARTMENT — NIGHT\nMaya pauses, listening." },
  });
  fireEvent.click(dialog.getByRole("button", { name: "Apply enhancement" }));
  expect(useStore.getState().data.scenes[sceneId].screenplay).toBe(
    "INT. APARTMENT — NIGHT\nMaya pauses, listening.",
  );
});
it("blocks a stale enhancement from overwriting a changed scene", () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Enhance script" }));
  act(() =>
    useStore.getState().mutate((data) => {
      data.scenes[sceneId].planRevision =
        (data.scenes[sceneId].planRevision ?? 1) + 1;
    }),
  );
  expect(
    screen.getByRole("button", { name: "Apply enhancement" }),
  ).toBeDisabled();
});
it("deletes a selected shot and restores its records and media with Undo", () => {
  mount();
  const before = structuredClone(useStore.getState().data);
  const title = before.shots[shotId].title;
  fireEvent.click(screen.getByRole("button", { name: `Delete shot ${title}` }));
  expect(useStore.getState().data.shots[shotId].archived).toBe(true);
  expect(useStore.getState().data.scenes[sceneId].shotIds).not.toContain(
    shotId,
  );
  expect(Object.keys(useStore.getState().data.assets)).toEqual(
    Object.keys(before.assets),
  );
  expect(() =>
    validateRelations(dataSchema.parse(useStore.getState().data)),
  ).not.toThrow();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(useStore.getState().data.shots[shotId]).toEqual(before.shots[shotId]);
  expect(useStore.getState().data.scenes[sceneId].shotIds).toEqual(
    before.scenes[sceneId].shotIds,
  );
});
it("keeps essentials visible and groups optional shot direction into exactly three collapsed sections", () => {
  mount();
  const panel = screen.getByRole("region", { name: "Shot plan details" });
  expect(within(panel).getByLabelText("Shot title")).toBeVisible();
  expect(within(panel).getByLabelText("Shot action")).toBeVisible();
  expect(within(panel).getByLabelText("Shot framing")).toBeVisible();
  expect(within(panel).getByLabelText("Take duration")).toBeVisible();
  const sections = panel.querySelectorAll("details");
  expect(sections).toHaveLength(3);
  for (const section of sections) expect(section.open).toBe(false);
  expect(screen.queryByLabelText("Scene continuity")).not.toBeInTheDocument();
});
it("uploads an image into scene generation references and episode media using persistent storage", async () => {
  mount();
  const file = new File(["image"], "cafe-mood.png", { type: "image/png" });
  fireEvent.change(screen.getByLabelText("Upload additional references"), {
    target: { files: [file] },
  });
  await waitFor(() =>
    expect(screen.getByText("cafe-mood.png")).toBeInTheDocument(),
  );
  const data = useStore.getState().data,
    refs = generationInputs(data, sceneId).referenceInputs;
  const ref = refs.find(
    (entry) => data.assets[entry.assetId]?.title === "cafe-mood.png",
  )!;
  expect(saveMediaBlob).toHaveBeenCalledWith(ref.assetId, file);
  expect(data.assets[ref.assetId]).toMatchObject({
    projectId: "midnight",
    storedBlob: true,
    sessionOnly: true,
  });
  expect(episodeMediaAssetIds(data, "ep1")).toContain(ref.assetId);
  expect(episodeMediaAssetIds(data, "ep2")).not.toContain(ref.assetId);
  expect(() => validateRelations(dataSchema.parse(data))).not.toThrow();
  fireEvent.click(
    screen.getByRole("button", { name: "Remove reference cafe-mood.png" }),
  );
  expect(
    generationInputs(useStore.getState().data, sceneId).referenceInputs,
  ).not.toContainEqual(ref);
});
it("rejects unsupported uploads before persisting any file or changing scene data", async () => {
  const before = structuredClone(useStore.getState().data);
  await expect(
    uploadSceneReference(
      sceneId,
      new File(["text"], "script.txt", { type: "text/plain" }),
    ),
  ).rejects.toThrow(/PNG, JPEG or WebP/);
  expect(saveMediaBlob).not.toHaveBeenCalled();
  expect(useStore.getState().data).toEqual(before);
});

it("can delete the last shot without leaving an unusable selection and lets Undo restore it", () => {
  useStore.getState().mutate((data) => {
    data.scenes[sceneId].shotIds = [shotId];
  });
  mount();
  const title = useStore.getState().data.shots[shotId].title;
  fireEvent.click(screen.getByRole("button", { name: `Delete shot ${title}` }));
  expect(
    screen.getByText("Add a shot to direct its camera, action and timing."),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add shot" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(screen.getByLabelText("Shot title")).toHaveValue(title);
});

it("removes Scene brief and allows only one optional shot section to be expanded", () => {
  mount();
  expect(
    screen.queryByRole("button", { name: "Scene brief" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Scene description")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Scene screenplay")).toBeInTheDocument();
  const panel = screen.getByRole("region", { name: "Shot plan details" });
  const sections = panel.querySelectorAll("details");
  fireEvent.click(within(panel).getByText("Camera & motion"));
  expect(sections[0].open).toBe(true);
  fireEvent.click(within(panel).getByText("Performance & background"));
  expect(sections[0].open).toBe(false);
  expect(sections[1].open).toBe(true);
  fireEvent.click(within(panel).getByText("Dialogue & advanced"));
  expect(sections[1].open).toBe(false);
  expect(sections[2].open).toBe(true);
  fireEvent.click(within(panel).getByText("Dialogue & advanced"));
  expect([...sections].every((section) => !section.open)).toBe(true);
  expect(within(panel).getByLabelText("Shot title")).toBeVisible();
  expect(within(panel).getByLabelText("Take duration")).toBeVisible();
});

it("queues frames from Shots without a hidden script or reference approval step", () => {
  useStore.getState().mutate((data) => {
    data.projects.midnight.strictApprovals = true;
    data.episodes.ep1.scriptApprovedRevision = undefined;
    data.scenes[sceneId].planApprovedRevision = undefined;
    data.studio.setups[sceneId].locationMode = "required";
    data.studio.setups[sceneId].locationId = undefined;
  });
  mount();
  fireEvent.click(
    within(
      screen.getByRole("navigation", { name: "Production stages" }),
    ).getByRole("button", { name: "Shots" }),
  );
  const credits = useStore.getState().data.credits;
  fireEvent.click(
    screen.getAllByRole("button", { name: /Generate.*frames/ }).at(-1)!,
  );
  expect(screen.getByText("2 frames queued")).toBeInTheDocument();
  const jobs = Object.values(useStore.getState().data.jobs).filter(
    (job) => job.shotId === shotId && job.state === "queued",
  );
  expect(jobs).toHaveLength(1);
  expect(jobs[0].operation).toBe("image");
  expect(useStore.getState().data.credits).toBe(credits - 16);
});
