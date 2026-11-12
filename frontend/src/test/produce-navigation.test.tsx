import { beforeEach, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../app/App";
import { useStore } from "../stores/store";
import { useStudio, useSelection } from "../studio/selection";
import { installDirectorProject } from "../mocks/director-project";
import { generationInputSnapshot } from "../domain/generation-inputs";

const base = "/projects/last-letter/episodes/last-letter-ep3";
beforeEach(() => {
  useStore.getState().reset();
  useStore.getState().mutate(installDirectorProject);
  useStudio
    .getState()
    .set({ activity: false, settings: false, account: false, palette: false });
});
function mount(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}
it.each(["plan", "shots", "takes", "final"])(
  "keeps shared chrome and title editing in %s",
  (stage) => {
    mount(`${base}?stage=${stage}`);
    expect(
      screen.getByRole("heading", { name: "The reunion", level: 1 }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit episode title" }));
    fireEvent.change(screen.getByLabelText("Episode title"), {
      target: { value: "The return" },
    });
    fireEvent.keyDown(screen.getByLabelText("Episode title"), { key: "Enter" });
    expect(useStore.getState().data.episodes["last-letter-ep3"].title).toBe(
      "The return",
    );
  },
);
it("keeps the selected scene and shot through all four stages", () => {
  mount(`${base}?stage=plan&scene=letter-reunion&shot=letter-reunion-q2`);
  const nav = screen.getByRole("navigation", { name: "Production stages" });
  for (const name of ["Shots", "Takes", "Final video", "Scene plan"]) {
    fireEvent.click(within(nav).getByRole("button", { name }));
    expect(useSelection.getState().keys).toEqual(["shot:letter-reunion-q2"]);
  }
  expect(
    within(screen.getByRole("region", { name: "Scene editor" })).getByRole(
      "heading",
      { level: 2 },
    ),
  ).toHaveTextContent("The reunion");
});
it("opens a newly added scene directly without retaining the previous scene's shot", () => {
  mount(`${base}?stage=plan&scene=letter-reunion&shot=letter-reunion-q2`);
  const credits = useStore.getState().data.credits;
  fireEvent.click(screen.getByRole("button", { name: "Add scene" }));
  const data = useStore.getState().data,
    id = data.episodes["last-letter-ep3"].sceneIds.at(-1)!;
  expect(
    within(screen.getByRole("region", { name: "Scene editor" })).getByRole(
      "heading",
      { level: 2 },
    ),
  ).toHaveTextContent(data.scenes[id].title);
  expect(data.credits).toBe(credits);
  expect(useSelection.getState().keys).toEqual([
    `shot:${data.scenes[id].shotIds[0]}`,
  ]);
});
it("opens visual references from planning and carries those choices into Shots", () => {
  mount(`${base}?stage=plan&scene=letter-reunion&shot=letter-reunion-q1`);
  fireEvent.click(screen.getByRole("button", { name: "Edit references" }));
  const picker = screen.getByRole("dialog", { name: "Add references" });
  expect(within(picker).getByRole("button", { name: "Maya" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  fireEvent.click(
    within(picker).getByRole("button", { name: "Apply references" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Create starting frames" }),
  );
  expect(
    screen.getByRole("button", { name: /references · Edit/ }),
  ).toHaveTextContent("4 references");
  const inputs = generationInputSnapshot(
    useStore.getState().data,
    "letter-reunion-q1",
  );
  expect(inputs.locationId).toBeTruthy();
  expect(inputs.worldElements?.some((item) => item.kind === "prop")).toBe(true);
});
it("shows the same editing tools after legacy frame and motion URLs", () => {
  const mounted = mount(`${base}/shots/letter-reunion-q1?stage=frame`);
  expect(
    screen.getByRole("heading", { name: "Camera & composition" }),
  ).toBeInTheDocument();
  mounted.unmount();
  mount(`${base}/shots/letter-reunion-q1?stage=motion`);
  expect(
    screen.getByRole("navigation", { name: "Take controls" }),
  ).toBeInTheDocument();
});
it("rejects a legacy shot route outside the selected episode", () => {
  mount(`${base}/shots/ep1-s1-q1?stage=frame`);
  expect(
    screen.getByRole("heading", { name: "Episode unavailable" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByAltText("Starting-frame candidate"),
  ).not.toBeInTheDocument();
});
it("keeps reference and media navigation scoped to the episode and returns to the same stage", () => {
  mount(`${base}?stage=takes&scene=letter-reunion&shot=letter-reunion-q1`);
  const sidebar = screen.getByRole("complementary", {
    name: "Studio navigation",
  });
  fireEvent.click(within(sidebar).getByRole("button", { name: "References" }));
  fireEvent.click(within(sidebar).getByRole("button", { name: "Media" }));
  expect(useStudio.getState().activity).toBe(false);
  fireEvent.click(within(sidebar).getByRole("button", { name: "Produce" }));
  expect(
    within(
      screen.getByRole("navigation", { name: "Production stages" }),
    ).getByRole("button", { name: "Takes" }),
  ).toHaveAttribute("aria-current", "step");
});
