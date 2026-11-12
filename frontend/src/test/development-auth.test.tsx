import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthenticationRoot } from "../features/account/ClerkAuth";
import { App } from "../app/App";
import { activateWorkspace, useStore } from "../stores/store";
import { requestJSON } from "../api/client";
import { backendActivity } from "../services/backend-activity";
const clerkProvider = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("Clerk must not initialize in bypass mode");
  }),
);
vi.mock("@clerk/react", () => ({
  ClerkProvider: clerkProvider,
  SignIn: () => null,
  SignUp: () => null,
  useAuth: () => {
    throw Error("Clerk hook reached");
  },
  useUser: () => null,
  useClerk: () => null,
}));
beforeEach(() => {
  localStorage.clear();
  activateWorkspace(null);
  clerkProvider.mockClear();
  vi.stubEnv("VITE_AUTH_BYPASS", "true");
  vi.stubEnv("VITE_HOME_WORKFLOW", "demo");
  vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", "");
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("No network allowed"))),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  activateWorkspace(null);
});
const visit = (path = "/login") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthenticationRoot>
        <App />
      </AuthenticationRoot>
    </MemoryRouter>,
  );
it("opens directly, creates local work from Home and never starts Clerk or backend polling", () => {
  const start = vi.spyOn(backendActivity, "start");
  visit();
  expect(
    screen.getByRole("heading", { name: "Back to your stories." }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Account" })).toBeInTheDocument();
  expect(useStore.getState().data.backend).toBeUndefined();
  fireEvent.change(screen.getByLabelText("Story idea"), {
    target: { value: "A letter arrives at midnight" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Start a film" }));
  if (screen.queryByRole("button", { name: "Create film" }))
    fireEvent.click(screen.getByRole("button", { name: "Create film" }));
  expect(screen.getByRole("button", { name: "Scene plan" })).toHaveAttribute(
    "aria-current",
    "step",
  );
  expect(fetch).not.toHaveBeenCalled();
  expect(clerkProvider).not.toHaveBeenCalled();
  expect(start).not.toHaveBeenCalled();
});
it("uses an isolated persistent workspace and preserves real-account content", () => {
  const realId = "40000000-0000-4000-8000-000000000001";
  activateWorkspace(realId);
  useStore.getState().mutate((data) => {
    data.projects.midnight.title = "Private real-account project";
  });
  const privateSaved = localStorage.getItem(`nori-demo-v1:user:${realId}`);
  const view = visit("/projects");
  expect(
    screen.queryByText("Private real-account project"),
  ).not.toBeInTheDocument();
  useStore.getState().mutate((data) => {
    data.projects.midnight.title = "My local demo project";
  });
  view.unmount();
  expect(localStorage.getItem(`nori-demo-v1:user:${realId}`)).toBe(
    privateSaved,
  );
  visit("/projects");
  expect(useStore.getState().data.projects.midnight.title).toBe(
    "My local demo project",
  );
  cleanup();
  activateWorkspace(realId);
  expect(useStore.getState().data.projects.midnight.title).toBe(
    "Private real-account project",
  );
});
it("blocks direct API access before fetch in bypass mode", async () => {
  await expect(requestJSON("/me", (value) => value)).rejects.toMatchObject({
    status: 403,
    code: "development_bypass",
  });
  expect(fetch).not.toHaveBeenCalled();
});
it("shows a useful error for an unsafe combination instead of silently bypassing", () => {
  vi.stubEnv("VITE_HOME_WORKFLOW", "api");
  visit();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "requires VITE_HOME_WORKFLOW=demo",
  );
  expect(screen.queryByLabelText("Story idea")).not.toBeInTheDocument();
  expect(clerkProvider).not.toHaveBeenCalled();
});
