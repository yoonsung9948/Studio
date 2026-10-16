import { beforeEach, it, expect } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  within,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { ActionsProvider } from "../components/Actions";
import { EpisodePage } from "../features/Episode";
import { SceneWorkspace } from "../features/SceneWorkspace";
import { Editor } from "../features/Editor";
import { useStore } from "../stores/store";
import { tick } from "../domain/commands";
import { createPlannedScene } from "../domain/workflow";
beforeEach(() => useStore.getState().reset());
function mount(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <ActionsProvider>
        <Routes>
          <Route
            path="/projects/:projectId/episodes/:episodeId"
            element={<EpisodePage />}
          />
          <Route
            path="/projects/:projectId/episodes/:episodeId/scenes/:sceneId"
            element={<SceneWorkspace />}
          />
          <Route
            path="/projects/:projectId/episodes/:episodeId/scenes/:sceneId/edit"
            element={<Editor />}
          />
        </Routes>
      </ActionsProvider>
    </MemoryRouter>,
  );
}
it("opens a scene plan from the board and reaches reference selection without a popup or editor", () => {
  mount("/projects/midnight/episodes/ep1?tab=scenes");
  fireEvent.click(screen.getByRole("link", { name: /The Message/ }));
  expect(
    screen.getByRole("heading", { name: "Shape this moment." }),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText("Preview scrubber")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Choose references" }));
  expect(
    screen.getByRole("heading", { name: "Choose what guides this scene." }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Look for Maya Chen")).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: /Generate video · 3 shots/ }),
  ).toBeEnabled();
});
it("takes a new episode from generated script through plan approval, generation, results and Edit", async () => {
  useStore.getState().mutate((d) => {
    d.episodes.fresh = {
      id: "fresh",
      projectId: "midnight",
      title: "A missed call",
      synopsis: "A phone rings in a quiet room.",
      script: "",
      scriptRevision: 1,
      scriptHistory: [],
      sceneIds: [],
      targetSeconds: 15,
      revision: 1,
      timelineVersion: 1,
    };
    d.projects.midnight.episodeIds.push("fresh");
  });
  mount("/projects/midnight/episodes/fresh");
  expect(
    screen.getByRole("navigation", { name: "Episode workflow" }),
  ).toHaveTextContent("Edit");
  expect(screen.getByRole("button", { name: /02\s*Scenes/ })).toBeDisabled();
  expect(screen.getByRole("button", { name: /03\s*Edit/ })).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Create scene plans" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Generate script" }));
  await waitFor(() =>
    expect(
      (
        screen.getByRole("textbox", {
          name: "Episode screenplay",
        }) as HTMLTextAreaElement
      ).value,
    ).toContain("A phone rings in a quiet room."),
  );
  expect(
    (
      screen.getByRole("textbox", {
        name: "Episode screenplay",
      }) as HTMLTextAreaElement
    ).value,
  ).toContain("A phone rings in a quiet room.");
  fireEvent.change(screen.getByLabelText("Number of scenes"), {
    target: { value: "1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create scene plans" }));
  await screen.findByRole("heading", { name: "Scene plans" });
  expect(screen.getByRole("link", { name: /02\s*Scenes/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /03\s*Edit/ })).toBeDisabled();
  fireEvent.click(screen.getByRole("link", { name: "Review plan" }));
  fireEvent.click(screen.getByRole("button", { name: "Approve Scene Plan" }));
  fireEvent.click(
    screen.getByRole("button", { name: /Generate video · \d+ shots? ·/ }),
  );
  expect(
    screen.getByRole("heading", { name: "Your scene, taking shape." }),
  ).toBeInTheDocument();
  act(() => {
    for (let i = 0; i < 35; i++) useStore.getState().mutate(tick);
  });
  for (const button of screen.getAllByRole("button", {
    name: "Approve for Edit",
  }))
    fireEvent.click(button);
  fireEvent.click(screen.getByRole("link", { name: "Go to episode Edit" }));
  expect(
    screen.getByRole("heading", { name: "Your episode edit" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Edit scene" })).toBeInTheDocument();
});
it("locks saved reference selection after a plan edit until the revised plan is approved", () => {
  mount("/projects/midnight/episodes/ep1/scenes/ep1-s2");
  const field = screen.getByLabelText("Detailed action");
  fireEvent.change(field, {
    target: { value: "Maya slowly turns off the recording." },
  });
  fireEvent.blur(field);
  fireEvent.click(screen.getByRole("button", { name: /References/ }));
  expect(
    screen.getByRole("heading", { name: "Approve the scene plan first." }),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText("Look for Maya Chen")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Review plan" }));
  fireEvent.click(screen.getByRole("button", { name: "Approve Scene Plan" }));
  expect(screen.getByLabelText("Look for Maya Chen")).toBeInTheDocument();
  expect(useStore.getState().data.studio.setups["ep1-s2"].cast).toHaveLength(2);
});
it("does not open the video editor for a scene without approved footage", () => {
  mount("/projects/midnight/episodes/ep1/scenes/ep1-s2/edit");
  expect(
    screen.getByRole("heading", {
      name: "Approve a result before editing this scene.",
    }),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText("Preview scrubber")).not.toBeInTheDocument();
});
it("uses one shared dialog for episode generation and editable scene references", () => {
  mount("/projects/midnight/episodes/ep1?tab=scenes");
  fireEvent.click(screen.getByRole("button", { name: "Generate episode" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: /The Message/ }));
  expect(
    within(dialog).getByLabelText("Look for Maya Chen"),
  ).toBeInTheDocument();
  expect(
    within(dialog).getByRole("button", { name: /Generate video/ }),
  ).toBeInTheDocument();
});

it("paginates the scene board and preserves off-page scenes when reordering", () => {
  useStore.getState().mutate((d) => {
    for (let i = 5; i <= 8; i++)
      createPlannedScene(d, "ep1", `Added scene ${i}`, "A new beat", 3);
  });
  const original = [...useStore.getState().data.episodes.ep1.sceneIds];
  mount("/projects/midnight/episodes/ep1?tab=scenes");
  expect(
    screen.getByRole("navigation", { name: "Scene pages" }),
  ).toHaveTextContent("Page 1 of 2");
  expect(
    screen.getByRole("button", { name: "Previous scene page" }),
  ).toBeDisabled();
  expect(
    screen.queryByRole("heading", { name: /Added scene 7/ }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next scene page" }));
  expect(
    screen.getByRole("heading", { name: /Added scene 7/ }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Next scene page" }),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", { name: "Move Added scene 7 down" }),
  );
  const order = useStore.getState().data.episodes.ep1.sceneIds;
  expect(order.slice(0, 6)).toEqual(original.slice(0, 6));
  expect(order.slice(6)).toEqual(original.slice(6).reverse());
});

it("guards locked tab URLs and unlocks Scenes only after plans exist", () => {
  useStore.getState().mutate((d) => {
    d.episodes.ep1.sceneIds = [];
  });
  mount("/projects/midnight/episodes/ep1?tab=edit");
  expect(
    screen.getByRole("heading", { name: "Your screenplay" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /02\s*Scenes/ })).toBeDisabled();
  expect(screen.getByRole("button", { name: /03\s*Edit/ })).toBeDisabled();
});

it("shows generated shot assets on the scene board", () => {
  const d = useStore.getState().data;
  const shot = Object.values(d.shots).find(
    (s) => s.sceneId === "ep1-s1" && s.currentTakeId,
  )!;
  const asset = d.assets[d.takes[shot.currentTakeId!].assetId];
  mount("/projects/midnight/episodes/ep1?tab=scenes");
  expect(
    within(screen.getByLabelText("The Arrival generated shots")).getByAltText(
      `${shot.title} generated shot`,
    ),
  ).toHaveAttribute("src", asset.url);
});
