import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SceneWorkspace } from "../features/SceneWorkspace";
import { EpisodePage } from "../features/Episode";
import { Route, Routes } from "react-router-dom";
import { ActionsProvider } from "../components/Actions";
import { useStore } from "../stores/store";
import { tick } from "../domain/commands";
import { exportService } from "../services/mock";
import { seed } from "../mocks/seed";
beforeEach(() => useStore.getState().reset());
describe("Scene generation to review", () => {
  it("preflights, completes demo jobs, and explicitly approves a candidate", async () => {
    render(
      <MemoryRouter
        initialEntries={["/projects/midnight/episodes/ep1?tab=scenes"]}
      >
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
          </Routes>
        </ActionsProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Generate episode" }));
    expect(
      screen.getByRole("heading", { name: "Generate episode" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: /Generate video · \d+ shots? · .* cr/,
      }),
    );
    act(() => {
      for (let i = 0; i < 50; i++) useStore.getState().mutate(tick);
    });
    const shot = useStore.getState().data.shots["ep1-s2-q1"];
    expect(shot.candidateTakeId).toBeTruthy();
    expect(shot.currentTakeId).toBeUndefined();
    fireEvent.click(screen.getByRole("link", { name: /The Message/ }));
    fireEvent.click(screen.getByRole("button", { name: /Results/ }));
    fireEvent.click(
      screen.getAllByRole("button", { name: "Approve for Edit" })[0],
    );
    expect(useStore.getState().data.shots[shot.id].currentTakeId).toBe(
      shot.candidateTakeId,
    );
    expect(useStore.getState().data.takes[shot.candidateTakeId!].approved).toBe(
      true,
    );
  });
  it("produces valid honest JSON manifest", async () => {
    const record = await exportService.create(seed(), "ep2", {
      title: "Fixture",
      preset: "TikTok",
      captions: true,
      description: "test",
      draft: false,
    });
    const manifest = JSON.parse(record.manifest);
    expect(manifest.rendered).toBe(false);
    expect(manifest.fps).toBe(30);
    expect(manifest.shots).toHaveLength(6);
  });
});
