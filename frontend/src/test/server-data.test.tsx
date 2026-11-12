import { useEffect, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AccountDataProvider } from "../services/server-data";
import { configureApiSession } from "../api/session";
import { activateWorkspace, useStore } from "../stores/store";
import { ServerProjects, ServerProject } from "../studio/ServerProjects";
import { ServerLibrary, SignedMedia } from "../studio/ServerLibrary";
import { ServerActivity } from "../studio/ServerActivity";
import { backendActivity } from "../services/backend-activity";
import { backendJobObserver } from "../services/job-observer";
import {
  jsonResponse,
  backendProject,
  completedDecisionJob,
  backendJob,
} from "./fixtures/backend";

const owner = "40000000-0000-4000-8000-000000000001",
  otherOwner = "40000000-0000-4000-8000-000000000002";
const secondProject = {
  ...backendProject,
  id: "10000000-0000-4000-8000-000000000002",
  title: "Another film",
};
const asset = {
  id: "50000000-0000-4000-8000-000000000001",
  projectId: backendProject.id,
  producerJobId: backendJob.id,
  kind: "video" as const,
  createdAt: backendProject.createdAt,
};
const file = {
  id: "60000000-0000-4000-8000-000000000001",
  assetId: asset.id,
  role: "original" as const,
  contentType: "video/mp4",
  sizeBytes: 10,
};
let release: (() => void) | undefined;
function establish(id = owner, token = "token-a") {
  release = configureApiSession(async () => token);
  activateWorkspace(id);
  useStore.getState().mutate((data) => {
    data.backend = { ownerId: id, projects: {} };
  });
}
function Frame({
  children,
  id = owner,
  path = "/projects",
}: {
  children: ReactNode;
  id?: string;
  path?: string;
}) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <AccountDataProvider accountId={id}>{children}</AccountDataProvider>
    </MemoryRouter>
  );
}
const emptyPage = { items: [], nextCursor: null };
function mockAPI(
  handler: (
    url: URL,
    options: RequestInit,
  ) => Response | Promise<Response> | undefined,
) {
  const fetcher = vi.fn((path: string, options: RequestInit = {}) => {
    const url = new URL(path, "http://localhost");
    return Promise.resolve(
      handler(url, options) ??
        (url.pathname === "/api/v1/jobs"
          ? jsonResponse(emptyPage)
          : jsonResponse(
              { error: { code: "not_found", message: "Resource not found." } },
              404,
            )),
    );
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
beforeEach(() => {
  vi.stubEnv("VITE_HOME_WORKFLOW", "api");
  vi.stubEnv("VITE_AUTH_BYPASS", "false");
  localStorage.clear();
  establish();
});
afterEach(() => {
  release?.();
  backendActivity.dispose();
  backendJobObserver.dispose();
  activateWorkspace(null);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

it("loads owned projects after empty browser storage, paginates, and reloads from the server", async () => {
  const fetcher = mockAPI((url) =>
    url.pathname === "/api/v1/projects"
      ? jsonResponse(
          url.searchParams.has("cursor")
            ? { items: [secondProject], nextCursor: null }
            : { items: [backendProject], nextCursor: "next" },
        )
      : undefined,
  );
  const view = render(
    <Frame>
      <ServerProjects />
    </Frame>,
  );
  await screen.findByRole("link", { name: "Open First film" });
  fireEvent.click(screen.getByRole("button", { name: "Load more projects" }));
  await screen.findByRole("link", { name: "Open Another film" });
  expect(
    fetcher.mock.calls.some(([path]) => String(path).includes("cursor=next")),
  ).toBe(true);
  view.unmount();
  localStorage.clear();
  establish();
  render(
    <Frame>
      <ServerProjects />
    </Frame>,
  );
  await screen.findByRole("link", { name: "Open First film" });
  expect(useStore.getState().data.projects[backendProject.id]).toBeUndefined();
});
it("creates a server project and refreshes the list, without making a demo project", async () => {
  let created = false;
  mockAPI((url, options) => {
    if (url.pathname !== "/api/v1/projects") return;
    if (options.method === "POST") {
      created = true;
      expect(JSON.parse(String(options.body))).toEqual({ title: "First film" });
      return jsonResponse(backendProject, 201);
    }
    return jsonResponse({
      items: created ? [backendProject] : [],
      nextCursor: null,
    });
  });
  render(
    <Frame>
      <ServerProjects />
    </Frame>,
  );
  await screen.findByText("No projects yet");
  fireEvent.change(screen.getByLabelText("New project name"), {
    target: { value: "First film" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create project" }));
  await screen.findByRole("link", { name: "Open First film" });
  expect(useStore.getState().data.projects[backendProject.id]).toBeUndefined();
});
it("loads project details directly from a URL and reports unavailable projects", async () => {
  mockAPI((url) =>
    url.pathname === `/api/v1/projects/${backendProject.id}`
      ? jsonResponse(backendProject)
      : undefined,
  );
  render(
    <Frame path={`/projects/${backendProject.id}/episodes`}>
      <Routes>
        <Route
          path="/projects/:projectId/episodes"
          element={<ServerProject />}
        />
      </Routes>
    </Frame>,
  );
  await screen.findByRole("heading", { name: "First film" });
  expect(
    screen.getByRole("link", { name: "Open project library" }),
  ).toHaveAttribute("href", `/projects/${backendProject.id}/library`);
});
it("retrieves the asset library and plays media only through a freshly signed URL", async () => {
  const fetcher = mockAPI((url) => {
    if (url.pathname === "/api/v1/assets")
      return jsonResponse({ items: [asset], nextCursor: null });
    if (url.pathname === `/api/v1/assets/${asset.id}`)
      return jsonResponse({ ...asset, files: [file] });
    if (url.pathname === `/api/v1/asset-files/${file.id}/url`)
      return jsonResponse({
        url: `/api/v1/downloads/${file.id}?token=private-link`,
        expiresAt: new Date(Date.now() + 300000).toISOString(),
      });
  });
  const view = render(
    <Frame path={`/projects/${backendProject.id}/library`}>
      <Routes>
        <Route
          path="/projects/:projectId/library"
          element={<ServerLibrary />}
        />
      </Routes>
    </Frame>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Open video 1" }));
  await waitFor(() =>
    expect(view.container.querySelector("video")).toHaveAttribute(
      "src",
      `/api/v1/downloads/${file.id}?token=private-link`,
    ),
  );
  expect(
    fetcher.mock.calls.some(([path]) =>
      String(path).includes(`projectId=${backendProject.id}`),
    ),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: "Video" }));
  await waitFor(() =>
    expect(
      fetcher.mock.calls.some(([path]) => String(path).includes("kind=video")),
    ).toBe(true),
  );
  expect(JSON.stringify(localStorage)).not.toContain("private-link");
});
it("renews an expiring media link without persisting it", async () => {
  vi.useFakeTimers();
  let count = 0;
  mockAPI((url) =>
    url.pathname === `/api/v1/asset-files/${file.id}/url`
      ? jsonResponse({
          url: `/api/v1/downloads/${file.id}?token=link-${++count}`,
          expiresAt: new Date(
            Date.now() + (count === 1 ? 31000 : 300000),
          ).toISOString(),
        })
      : undefined,
  );
  const view = render(
    <Frame>
      <SignedMedia file={file} kind="video" />
    </Frame>,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  expect(view.container.querySelector("video")).toHaveAttribute(
    "src",
    `/api/v1/downloads/${file.id}?token=link-1`,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1100);
  });
  expect(view.container.querySelector("video")).toHaveAttribute(
    "src",
    `/api/v1/downloads/${file.id}?token=link-2`,
  );
  expect(count).toBe(2);
});
it("cancels and discards an old account's pending project response", async () => {
  let oldSignal: AbortSignal | undefined,
    resolveOld!: (response: Response) => void;
  mockAPI((url, options) => {
    if (url.pathname !== "/api/v1/projects") return;
    if (
      new Headers(options.headers).get("Authorization") === "Bearer token-a"
    ) {
      oldSignal = options.signal as AbortSignal;
      return new Promise<Response>((resolve) => {
        resolveOld = resolve;
      });
    }
    return jsonResponse({ items: [secondProject], nextCursor: null });
  });
  const view = render(
    <Frame>
      <ServerProjects />
    </Frame>,
  );
  await waitFor(() => expect(oldSignal).toBeDefined());
  establish(otherOwner, "token-b");
  view.rerender(
    <Frame id={otherOwner}>
      <ServerProjects />
    </Frame>,
  );
  await screen.findByRole("link", { name: "Open Another film" });
  await act(async () => {
    resolveOld(jsonResponse({ items: [backendProject], nextCursor: null }));
  });
  expect(oldSignal?.aborted).toBe(true);
  expect(
    screen.queryByRole("link", { name: "Open First film" }),
  ).not.toBeInTheDocument();
});
function Activity() {
  useEffect(() => backendActivity.start(), []);
  return <ServerActivity />;
}
it("discovers saved jobs, observes active jobs once, and retrieves terminal details only on demand", async () => {
  const active = { ...backendJob, projectId: null };
  const terminal = {
    ...completedDecisionJob,
    id: "20000000-0000-4000-8000-000000000003",
  };
  const fetcher = mockAPI((url) => {
    if (url.pathname === "/api/v1/jobs")
      return jsonResponse({
        items:
          url.searchParams.get("status") === "running"
            ? []
            : url.searchParams.get("status") === "queued"
              ? [active]
              : [active, terminal],
        nextCursor: null,
      });
    if (url.pathname === `/api/v1/jobs/${terminal.id}`)
      return jsonResponse(terminal);
    if (url.pathname === `/api/v1/jobs/${backendJob.id}`)
      return jsonResponse({
        ...completedDecisionJob,
        projectId: null,
        updatedAt: "2026-10-19T12:00:00Z",
      });
  });

  const view = render(
    <Frame>
      <Activity />
    </Frame>,
  );
  await waitFor(() =>
    expect(screen.getAllByRole("button", { name: "Show result" })).toHaveLength(
      2,
    ),
  );
  expect(
    fetcher.mock.calls.filter(
      ([path]) => path === `/api/v1/jobs/${terminal.id}`,
    ),
  ).toHaveLength(0);
  await waitFor(() =>
    expect(
      useStore.getState().data.backend?.jobs?.[backendJob.id]?.job?.status,
    ).toBe("succeeded"),
  );
  expect(
    fetcher.mock.calls.filter(
      ([path]) => path === `/api/v1/jobs/${backendJob.id}`,
    ),
  ).toHaveLength(1);
  fireEvent.click(screen.getAllByRole("button", { name: "Show result" })[0]);
  await waitFor(() =>
    expect(
      fetcher.mock.calls.filter(
        ([path]) => path === `/api/v1/jobs/${terminal.id}`,
      ),
    ).toHaveLength(1),
  );
  view.unmount();
});
it("does not repeatedly retry authentication failures", async () => {
  const fetcher = mockAPI((url) =>
    url.pathname === "/api/v1/projects"
      ? jsonResponse(
          {
            error: { code: "unauthenticated", message: "Sign in to continue." },
          },
          401,
        )
      : undefined,
  );
  render(
    <Frame>
      <ServerProjects />
    </Frame>,
  );
  await screen.findByRole("alert");
  expect(
    fetcher.mock.calls.filter(([path]) =>
      String(path).startsWith("/api/v1/projects"),
    ),
  ).toHaveLength(1);
  expect(
    screen.queryByRole("link", { name: "Open First film" }),
  ).not.toBeInTheDocument();
});

it("shows a 404 for a project unavailable to the account", async () => {
  mockAPI(() => undefined);
  render(
    <Frame path={`/projects/${backendProject.id}/episodes`}>
      <Routes>
        <Route
          path="/projects/:projectId/episodes"
          element={<ServerProject />}
        />
      </Routes>
    </Frame>,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Resource not found.",
  );
  expect(
    screen.queryByRole("heading", { name: "First film" }),
  ).not.toBeInTheDocument();
});
it("refreshes the asset library when an observed generation completes", async () => {
  let complete = false;
  mockAPI((url) =>
    url.pathname === "/api/v1/assets"
      ? jsonResponse({ items: complete ? [asset] : [], nextCursor: null })
      : undefined,
  );
  render(
    <Frame>
      <ServerLibrary />
    </Frame>,
  );
  await screen.findByText("No media yet");
  act(() =>
    useStore.getState().mutate((data) => {
      data.backend!.jobs = {
        [backendJob.id]: {
          ...backendJob,
          job: { ...backendJob, status: "running" },
        },
      };
    }),
  );
  complete = true;
  act(() =>
    useStore.getState().mutate((data) => {
      data.backend!.jobs![backendJob.id].job = {
        ...completedDecisionJob,
        operation: "generate_video",
      };
    }),
  );
  await screen.findByRole("button", { name: "Open video 1" });
});
it("never automatically repeats a failed project creation", async () => {
  const fetcher = mockAPI((url, options) =>
    url.pathname === "/api/v1/projects"
      ? options.method === "POST"
        ? jsonResponse(
            { error: { code: "internal_error", message: "Creation failed." } },
            500,
          )
        : jsonResponse(emptyPage)
      : undefined,
  );
  render(
    <Frame>
      <ServerProjects />
    </Frame>,
  );
  fireEvent.change(screen.getByLabelText("New project name"), {
    target: { value: "First film" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create project" }));
  await screen.findByText("Creation failed.");
  expect(
    fetcher.mock.calls.filter(([, options]) => options?.method === "POST"),
  ).toHaveLength(1);
});
