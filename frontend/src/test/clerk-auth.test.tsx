import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { AuthenticationRoot } from "../features/account/ClerkAuth";
import { useIdentity } from "../features/account/identity";
import { useAccount } from "../stores/account";
import { activateWorkspace } from "../stores/store";
import { useStore } from "../stores/store";
import { requestJSON } from "../api/client";
import { backendJob, backendProject, jsonResponse } from "./fixtures/backend";

const clerk = vi.hoisted(() => ({
  auth: {
    isLoaded: true,
    isSignedIn: false,
    userId: null as string | null,
    sessionId: null as string | null,
  },
  getToken: vi.fn(),
  signOut: vi.fn(),
  openUserProfile: vi.fn(),
}));
vi.mock("@clerk/react", () => ({
  ClerkProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({ ...clerk.auth, getToken: clerk.getToken }),
  useUser: () => ({
    user: clerk.auth.isSignedIn
      ? {
          fullName: "Clerk User",
          imageUrl: "https://example.com/avatar.png",
          primaryEmailAddress: { emailAddress: "clerk@example.com" },
        }
      : null,
  }),
  useClerk: () => clerk,
  SignIn: ({ forceRedirectUrl }: { forceRedirectUrl: string }) => (
    <div>Clerk sign in: {forceRedirectUrl}</div>
  ),
  SignUp: () => <div>Clerk sign up</div>,
}));
function Studio() {
  const identity = useIdentity();
  return (
    <>
      <div>Studio: {useLocation().pathname}</div>
      <span>{identity?.profile.fullName}</span>
      <button onClick={() => identity?.signOut()}>Session sign out</button>
      <button onClick={() => identity?.manageAccount()}>Manage account</button>
    </>
  );
}
function visit(path: string, publishableKey = "pk_test_configured") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthenticationRoot publishableKey={publishableKey}>
        <Studio />
      </AuthenticationRoot>
    </MemoryRouter>,
  );
}
const internalId = "40000000-0000-4000-8000-000000000001";
const otherInternalId = "40000000-0000-4000-8000-000000000002";
afterEach(() => {
  vi.unstubAllGlobals();
});
beforeEach(() => {
  activateWorkspace(null);
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() =>
      Promise.resolve(
        jsonResponse({
          id: clerk.auth.userId === "user_new" ? otherInternalId : internalId,
          displayName: "",
          status: "active",
          createdAt: "2026-01-01",
          updatedAt: "2026-01-01",
        }),
      ),
    ),
  );
  clerk.auth = {
    isLoaded: true,
    isSignedIn: false,
    userId: null,
    sessionId: null,
  };
  clerk.getToken.mockReset().mockResolvedValue("clerk-session-jwt");
  clerk.signOut.mockReset().mockResolvedValue(undefined);
  clerk.openUserProfile.mockReset();
  useStore.getState().reset();
  useAccount.getState().signIn("local-demo@example.com");
});
it("ignores the local demo flag and sends protected links to real Clerk sign-in", () => {
  visit("/projects/midnight/world?kind=character&id=maya");
  expect(
    screen.getByText(
      "Clerk sign in: /projects/midnight/world?kind=character&id=maya",
    ),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Studio:/)).not.toBeInTheDocument();
});
it("waits for Clerk session loading instead of granting access", () => {
  clerk.auth.isLoaded = false;
  visit("/projects");
  expect(screen.getByRole("status")).toHaveTextContent("Loading your session");
  expect(screen.queryByText(/Studio:/)).not.toBeInTheDocument();
});
it("uses Clerk identity, API token and real account actions after sign-in", async () => {
  clerk.auth = {
    isLoaded: true,
    isSignedIn: true,
    userId: "user_a",
    sessionId: "sess_a",
  };
  visit("/login?redirect_url=%2Fprojects%2Fmidnight%2Fworld");
  expect(
    await screen.findByText("Studio: /projects/midnight/world"),
  ).toBeInTheDocument();
  expect(screen.getByText("Clerk User")).toBeInTheDocument();
  const fetcher = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
  vi.stubGlobal("fetch", fetcher);
  try {
    await requestJSON("/me", (value) => value);
    expect(fetcher.mock.calls[0][1].headers.get("Authorization")).toBe(
      "Bearer clerk-session-jwt",
    );
    expect(localStorage.getItem("nori-demo-account-v1")).not.toContain(
      "clerk-session-jwt",
    );
  } finally {
    vi.unstubAllGlobals();
  }
  fireEvent.click(screen.getByRole("button", { name: "Manage account" }));
  expect(clerk.openUserProfile).toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Session sign out" }));
  expect(clerk.signOut).toHaveBeenCalledWith({ redirectUrl: "/login" });
});
it("isolates the entire workspace when switching accounts", async () => {
  activateWorkspace(internalId);
  useStore.getState().mutate((d) => {
    d.backend = {
      ownerId: internalId,
      projects: { [backendProject.id]: backendProject },
      jobs: {
        [backendJob.id]: {
          id: backendJob.id,
          projectId: backendJob.projectId,
          operation: backendJob.operation,
        },
      },
    };
  });
  useStore.getState().mutate((data) => {
    Object.values(data.projects)[0].title = "Private old-account film";
  }, true);
  clerk.auth = {
    isLoaded: true,
    isSignedIn: true,
    userId: "user_new",
    sessionId: "sess_new",
  };
  visit("/projects");
  await screen.findByText("Studio: /projects");
  expect(useStore.getState().data.backend).toEqual({
    ownerId: otherInternalId,
    projects: {},
  });
  expect(
    Object.values(useStore.getState().data.projects).some(
      (p) => p.title === "Private old-account film",
    ),
  ).toBe(false);
  expect(useStore.getState().past).toEqual([]);
  expect(localStorage.getItem(`nori-demo-v1:user:${internalId}`)).toContain(
    "Private old-account film",
  );
});
it("keeps the same account's saved backend jobs across sessions", async () => {
  activateWorkspace(internalId);
  useStore.getState().mutate((d) => {
    d.backend = {
      ownerId: internalId,
      projects: { [backendProject.id]: backendProject },
    };
  });
  clerk.auth = {
    isLoaded: true,
    isSignedIn: true,
    userId: "user_a",
    sessionId: "sess_a",
  };
  visit("/projects");
  await screen.findByText("Studio: /projects");
  expect(useStore.getState().data.backend?.projects[backendProject.id]).toEqual(
    backendProject,
  );
});
it("keeps public landing and registration reachable and rejects external return URLs", () => {
  visit("/signup?redirect_url=https%3A%2F%2Fevil.example");
  expect(screen.getByText("Clerk sign up")).toBeInTheDocument();
});
it("never falls back to dummy authentication when a publishable key is missing", () => {
  visit("/projects", "");
  expect(screen.getByRole("alert")).toHaveTextContent("Sign-in setup required");
  expect(
    screen.queryByRole("button", { name: "Sign in" }),
  ).not.toBeInTheDocument();
});

it("preserves Clerk-normalized same-origin return URLs while rejecting external redirects", async () => {
  clerk.auth = {
    isLoaded: true,
    isSignedIn: true,
    userId: "user_a",
    sessionId: "sess_a",
  };
  visit(
    `/signup?redirect_url=${encodeURIComponent(window.location.origin + "/projects/midnight/world?kind=character")}`,
  );
  expect(
    await screen.findByText("Studio: /projects/midnight/world"),
  ).toBeInTheDocument();
});

it("clears in-memory work and subscriptions on sign-out", async () => {
  clerk.auth = {
    isLoaded: true,
    isSignedIn: true,
    userId: "user_a",
    sessionId: "sess_a",
  };
  const view = visit("/projects");
  await screen.findByText("Studio: /projects");
  useStore.getState().mutate((data) => {
    Object.values(data.projects)[0].title = "Private film";
  }, true);
  clerk.auth = {
    isLoaded: true,
    isSignedIn: false,
    userId: null,
    sessionId: null,
  };
  view.rerender(
    <MemoryRouter initialEntries={["/projects"]}>
      <AuthenticationRoot publishableKey="pk_test_configured">
        <Studio />
      </AuthenticationRoot>
    </MemoryRouter>,
  );
  await screen.findByText(/Clerk sign in/);
  expect(
    Object.values(useStore.getState().data.projects).some(
      (p) => p.title === "Private film",
    ),
  ).toBe(false);
  expect(useStore.getState().past).toEqual([]);
  expect(useStore.getState().data.backend).toBeUndefined();
});
it("does not expose cached studio work while account verification fails", async () => {
  clerk.auth = {
    isLoaded: true,
    isSignedIn: true,
    userId: "user_a",
    sessionId: "sess_a",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "account_disabled",
            message: "Your account is disabled.",
          },
        },
        403,
      ),
    ),
  );
  visit("/projects");
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Your account is disabled",
  );
  expect(screen.queryByText(/Studio:/)).not.toBeInTheDocument();
});
