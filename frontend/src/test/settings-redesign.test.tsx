import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { App } from "../app/App";
import { IdentityContext } from "../features/account/identity";
import { uiSchema } from "../domain/schemas";
import { useStore } from "../stores/store";
import { useStudio } from "../studio/selection";
import { SettingsWorkspace } from "../studio/SettingsWorkspace";
import { DraftField } from "../studio/design/Primitives";
import { useJobNotifications } from "../studio/shell/useJobNotifications";

beforeEach(() => {
  useStore.getState().reset();
  useStore.setState({ storageFailed: false });
  useStudio
    .getState()
    .set({ activity: false, settings: false, account: false, palette: false });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const mount = () =>
  render(
    <MemoryRouter initialEntries={["/settings"]}>
      <App />
    </MemoryRouter>,
  );
it("connects appearance, density, autosave and motion preferences to the shared shell", () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Light" }));
  fireEvent.click(screen.getByRole("button", { name: "Compact" }));
  fireEvent.click(screen.getByRole("switch", { name: "Reduce motion" }));
  fireEvent.click(screen.getByRole("switch", { name: "Autosave" }));
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(document.documentElement.dataset.reducedMotion).toBe("true");
  expect(document.querySelector(".studio-layout")).toHaveClass(
    "density-compact",
  );
  expect(uiSchema.parse(useStore.getState().ui)).toMatchObject({
    theme: "light",
    density: "compact",
    reducedMotion: true,
    autosave: false,
  });
  expect(
    screen.getByText("Text changes are saved when you finish editing a field."),
  ).toBeInTheDocument();
});
it("defers text autosave when disabled while saving on blur and navigation", () => {
  vi.useFakeTimers();
  useStore.getState().setUI({ autosave: false });
  const save = vi.fn();
  const view = render(
    <DraftField label="Draft text" value="Original" onSave={save} />,
  );
  fireEvent.change(screen.getByLabelText("Draft text"), {
    target: { value: "My draft" },
  });
  act(() => vi.advanceTimersByTime(1000));
  expect(save).not.toHaveBeenCalled();
  fireEvent.blur(screen.getByLabelText("Draft text"));
  expect(save).toHaveBeenCalledWith("My draft");
  fireEvent.change(screen.getByLabelText("Draft text"), {
    target: { value: "Next draft" },
  });
  view.unmount();
  expect(save).toHaveBeenLastCalledWith("Next draft");
});
it("saves a pending draft when autosave is enabled again", () => {
  vi.useFakeTimers();
  useStore.getState().setUI({ autosave: false });
  const save = vi.fn();
  render(<DraftField label="Draft text" value="Original" onSave={save} />);
  fireEvent.change(screen.getByLabelText("Draft text"), {
    target: { value: "Pending" },
  });
  act(() => useStore.getState().setUI({ autosave: true }));
  act(() => vi.advanceTimersByTime(701));
  expect(save).toHaveBeenCalledWith("Pending");
});
it("offers one connected set of notification controls in each settings view", () => {
  mount();
  fireEvent.click(
    within(
      screen.getByRole("navigation", { name: "Settings sections" }),
    ).getByRole("button", { name: "Notifications" }),
  );
  expect(
    screen.getAllByRole("switch", { name: "Review requested" }),
  ).toHaveLength(1);
  fireEvent.click(screen.getByRole("switch", { name: "Review requested" }));
  expect(useStore.getState().ui.notifications?.review).toBe(false);
  fireEvent.click(
    screen.getByRole("button", { name: "Workspace" }),
  );
  expect(
    screen.getByRole("switch", { name: "Review requested" }),
  ).not.toBeChecked();
});
it("uses the current identity and the existing account management action", () => {
  const manage = vi.fn();
  render(
    <MemoryRouter>
      <IdentityContext.Provider
        value={{
          profile: {
            fullName: "Sam Director",
            email: "sam@example.com",
            tier: "Starter",
          },
          manageAccount: manage,
          signOut: async () => {},
        }}
      >
        <SettingsWorkspace />
      </IdentityContext.Provider>
    </MemoryRouter>,
  );
  expect(
    screen.getByRole("heading", { name: "Sam Director" }),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Demo balance/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Manage account" }));
  expect(manage).toHaveBeenCalledOnce();
});
it("shows team availability and help without inventing members or invitations", () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Team" }));
  expect(
    screen.getByText(/Shared team invitations and roles are not available/),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Help & shortcuts" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Open commands" }),
  );
  expect(useStudio.getState().palette).toBe(true);
});
it("reports local save failures accurately", () => {
  useStore.setState({ storageFailed: true });
  mount();
  expect(screen.getByText("Save failed · session only")).toHaveAttribute(
    "role",
    "status",
  );
  expect(screen.queryByText("Saved automatically")).not.toBeInTheDocument();
});
function NotificationObserver() {
  useJobNotifications();
  return null;
}
it("respects the review notification preference for newly generated candidates", () => {
  useStore.getState().setUI({
    notifications: { completed: false, failed: false, review: true },
  });
  render(<NotificationObserver />);
  act(() =>
    useStore.getState().mutate((data) => {
      const shot = data.shots["ep1-s1-q1"],
        original = data.takes[shot.currentTakeId!];
      data.takes.reviewOne = {
        ...structuredClone(original),
        id: "reviewOne",
        approved: false,
        revision: shot.revision,
      };
      shot.candidateTakeId = "reviewOne";
      shot.stale = false;
    }),
  );
  expect(useStore.getState().notice).toContain("1 take is ready for review");
  act(() =>
    useStore.getState().setUI({
      notifications: { completed: false, failed: false, review: false },
    }),
  );
  act(() => useStore.getState().setNotice(""));
  act(() =>
    useStore.getState().mutate((data) => {
      data.takes.reviewTwo = {
        ...structuredClone(data.takes.reviewOne),
        id: "reviewTwo",
      };
      data.shots["ep1-s1-q1"].candidateTakeId = "reviewTwo";
    }),
  );
  expect(useStore.getState().notice).toBe("");
});
