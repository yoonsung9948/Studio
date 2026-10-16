import { beforeEach, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../app/App";
import { useStore } from "../stores/store";
import { useDirectorRequest } from "../stores/director";

beforeEach(() => {
  useStore.getState().reset();
  useDirectorRequest.setState({ prompt: null });
});
function mount(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

it("lands on Script even for an episode with existing scenes and hides the banner toggle", () => {
  mount("/projects/midnight/episodes/ep1");
  expect(
    screen.getByRole("heading", { name: "Your screenplay" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "AI Director" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Toggle AI Director")).not.toBeInTheDocument();
});

it("opens the Director for a new draft without overwriting or remounting the script", async () => {
  mount("/projects/midnight/episodes/ep1");
  const script = screen.getByLabelText("Episode screenplay");
  const original = useStore.getState().data.episodes.ep1.script;
  fireEvent.click(screen.getByRole("button", { name: "Draft new version" }));
  expect(
    await screen.findByRole("dialog", { name: "AI Director" }),
  ).toBeInTheDocument();
  expect(
    (screen.getByLabelText("Message AI Director") as HTMLTextAreaElement).value,
  ).toContain("new version");
  expect(useStore.getState().data.episodes.ep1.script).toBe(original);
  fireEvent.click(screen.getByRole("button", { name: "Close AI Director" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(screen.getByLabelText("Episode screenplay")).toBe(script);
});

it("opens a scene-scoped Director from Edit with AI and keeps the plan mounted", async () => {
  mount("/projects/midnight/episodes/ep1/scenes/ep1-s1");
  const title = screen.getByLabelText("Scene title");
  fireEvent.click(screen.getByRole("button", { name: "Edit with AI" }));
  expect(
    await screen.findByRole("dialog", { name: "AI Director" }),
  ).toBeInTheDocument();
  expect(
    (screen.getByLabelText("Message AI Director") as HTMLTextAreaElement).value,
  ).toContain("this scene");
  fireEvent.click(screen.getByRole("button", { name: "Close AI Director" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(screen.getByLabelText("Scene title")).toBe(title);
});

it("continues to honor explicit Scenes links", () => {
  mount("/projects/midnight/episodes/ep1?tab=scenes");
  expect(
    screen.getByRole("heading", { name: "Scene plans" }),
  ).toBeInTheDocument();
});
