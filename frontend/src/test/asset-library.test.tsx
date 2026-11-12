import { beforeEach, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../app/App";
import { useStore, recover } from "../stores/store";
import { useStudio } from "../studio/selection";
import { installDirectorProject } from "../mocks/director-project";
import {
  createLibraryObject,
  generateAssetView,
  assetView,
  assetViewCandidates,
  objectOwner,
  saveAssetView,
  uploadAssetView,
} from "../domain/asset-library";
import {
  assetUsage,
  linkAssetToEpisode,
  episodeAssetSubjects,
} from "../domain/asset-usage";
import { completeStudioJob } from "../domain/studio-commands";
import { retryJob } from "../domain/commands";
import { createWorkspaceEpisode } from "../domain/workspace";
import { dataSchema } from "../domain/schemas";
import { validateRelations } from "../domain/validation";
import { episodeMediaAssetIds } from "../domain/episode-resources";

beforeEach(() => {
  useStore.getState().reset();
  useStore.getState().mutate(installDirectorProject);
  useStudio
    .getState()
    .set({ activity: false, settings: false, account: false, palette: false });
});
const mount = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );

it.each(["places", "props"] as const)(
  "creates a %s asset, generates repeatable candidates and persists explicit saved views",
  (category) => {
    const data = structuredClone(useStore.getState().data),
      subject = createLibraryObject(data, category),
      owner = objectOwner(data, subject)!;
    owner.description = "A distinctive reference";
    const credits = data.credits;
    generateAssetView(data, subject, "front", 2, "Soft light, front view");
    const job = Object.values(data.jobs).at(-1)!;
    expect(job.cost).toBe(16);
    expect(data.credits).toBe(credits - 16);
    job.state = "running";
    completeStudioJob(data, job.id);
    const candidates = assetViewCandidates(data, subject, "front");
    expect(candidates).toHaveLength(2);
    expect(assetView(data, subject, "front").currentId).toBeUndefined();
    saveAssetView(data, subject, "front", candidates[0].id);
    const primary = owner.primaryVersionId;
    const type = category === "props" ? "back" : "detail";
    generateAssetView(data, subject, type, 1, "Another angle");
    const next = Object.values(data.jobs).at(-1)!;
    next.state = "running";
    completeStudioJob(data, next.id);
    expect(assetViewCandidates(data, subject, type)).toHaveLength(1);
    saveAssetView(data, subject, type, next.outputVersionIds![0]);
    expect(owner.primaryVersionId).toBe(primary);
    expect(assetView(data, subject, "front").currentId).toBe(candidates[0].id);
    expect(assetViewCandidates(data, subject, "front")).toHaveLength(2);
    expect(() => validateRelations(dataSchema.parse(data))).not.toThrow();
    const restored = recover(
      JSON.stringify({ version: 3, data, ui: useStore.getState().ui }),
    );
    expect(restored.notice).toBe("");
    expect(assetView(restored.data, subject, type).currentId).toBe(
      next.outputVersionIds![0],
    );
  },
);

it.each(["places", "props"] as const)(
  "links %s into an episode once with owned media, without assigning scenes or changing sibling references",
  (category) => {
    const data = structuredClone(useStore.getState().data),
      subject = createLibraryObject(data, category);
    const version = uploadAssetView(
      data,
      subject,
      "front",
      "data:image/png;base64,c291cmNl",
      "Source image",
    );
    saveAssetView(data, subject, "front", version);
    const episode = "last-letter-ep3",
      sibling = createWorkspaceEpisode(data, "last-letter", "Sibling");
    const setup = structuredClone(data.studio.setups);
    const linked = linkAssetToEpisode(data, episode, subject);
    expect(linked.id).not.toBe(subject.id);
    expect(linkAssetToEpisode(data, episode, subject)).toEqual(linked);
    expect(episodeAssetSubjects(data, episode, category)).toContainEqual(
      linked,
    );
    expect(episodeAssetSubjects(data, sibling, category)).toEqual([]);
    expect(data.studio.setups).toEqual(setup);
    const copied = objectOwner(data, linked)!;
    expect(data.assets[copied.assetId!].projectId).toBe("last-letter");
    expect(episodeMediaAssetIds(data, episode)).toContain(copied.assetId);
    const rows = assetUsage(data, subject);
    expect(rows).toHaveLength(1);
    expect(rows[0].episode.id).toBe(episode);
    expect(rows[0].scenes).toEqual([]);
    const replacement = uploadAssetView(
      data,
      subject,
      "front",
      "data:image/png;base64,bmV3",
      "New source",
    );
    saveAssetView(data, subject, "front", replacement);
    expect(objectOwner(data, linked)?.assetId).toBe(copied.assetId);
    expect(() => validateRelations(dataSchema.parse(data))).not.toThrow();
  },
);

it("keeps view type and direction on retry and rejects stale or foreign candidates", () => {
  const data = structuredClone(useStore.getState().data),
    subject = createLibraryObject(data, "places");
  objectOwner(data, subject)!.description = "A rainy café";
  generateAssetView(data, subject, "entrance", 1, "Blue hour");
  const job = Object.values(data.jobs).at(-1)!;
  job.state = "failed";
  retryJob(data, job.id);
  const retried = Object.values(data.jobs).at(-1)!;
  expect(retried.viewType).toBe("entrance");
  expect(retried.specification).toContain("Blue hour");
  retried.state = "running";
  completeStudioJob(data, retried.id);
  expect(() =>
    saveAssetView(data, subject, "front", retried.outputVersionIds![0]),
  ).toThrow(/candidate/);
  objectOwner(data, subject)!.revision = 2;
  expect(() =>
    saveAssetView(data, subject, "entrance", retried.outputVersionIds![0]),
  ).toThrow(/older/);
  const foreign = createLibraryObject(data, "places");
  expect(() =>
    saveAssetView(data, foreign, "entrance", retried.outputVersionIds![0]),
  ).toThrow(/candidate/);
});

it.each(["places", "props"] as const)(
  "lets the %s gallery create an asset and open Views directly",
  (category) => {
    mount(`/assets?kind=${category}&mode=demo`);
    fireEvent.click(
      screen.getByRole("button", {
        name: category === "places" ? "New place" : "New prop",
      }),
    );
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "My reference" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Warm and cinematic" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    fireEvent.click(
      screen.getByRole("link", {
        name: category === "places" ? "Places" : "Props",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Open My reference views" }),
    );
    expect(
      screen.getByRole("form", { name: "Generate views" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Generate 2 views · 16 cr" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("heading", { name: "Scene assignments" }),
    ).not.toBeInTheDocument();
  },
);

it("blocks reference Views under the wrong episode", () => {
  const data = useStore.getState().data,
    other = data.projects["last-letter"].episodeIds.find(
      (id) => id !== "last-letter-ep3",
    )!;
  mount(
    `/projects/last-letter/episodes/${other}/references/places/letter-cafe/views?mode=demo`,
  );
  expect(screen.getByText("Reference unavailable.")).toBeInTheDocument();
});
