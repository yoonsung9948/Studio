import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  QueryClient,
  QueryClientProvider,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { ApiError } from "../api/client";
import { getWallet } from "../api/billing";
import { useBillingWallet } from "./billing";
import { listProjects, getProject } from "../api/projects";
import { getAsset, listAssets } from "../api/assets";
import {
  listJobs,
  getJob,
  type JobFilters,
  type JobSummary,
} from "../api/jobs";
import { readAppConfiguration } from "../config";
import { homeUsesDemo } from "../config/environment";
import { recordObservedJob, terminalBackendJob } from "../domain/backend-jobs";
import { useStore } from "../stores/store";

interface AccountData {
  accountId: string;
  client: QueryClient;
  demo: boolean;
}
const AccountDataContext = createContext<AccountData | null>(null);
export function createServerQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15000,
        refetchOnWindowFocus: "always",
        retry: (count, error) =>
          count < 2 &&
          error instanceof ApiError &&
          (error.status === 0 || error.status === 429 || error.status >= 500),
      },
      mutations: { retry: false },
    },
  });
}
export function AccountDataProvider({
  accountId,
  children,
}: {
  accountId: string;
  children: ReactNode;
}) {
  const location = useLocation();
  const explicit = new URLSearchParams(location.search).get("mode");
  const development = readAppConfiguration().development;
  const [demoSelected, setDemoSelected] = useState(
    development && explicit === "demo",
  );
  const demo =
    homeUsesDemo(readAppConfiguration(), location.search) ||
    (development && (explicit === "api" ? false : demoSelected));
  useLayoutEffect(() => {
    if (development && (explicit === "demo" || explicit === "api"))
      setDemoSelected(explicit === "demo");
  }, [development, explicit]);
  const client = useMemo(createServerQueryClient, [accountId]);
  useEffect(() => {
    const focus = () => {
      if (document.visibilityState !== "hidden")
        void client.refetchQueries(
          { type: "active" },
          { cancelRefetch: false },
        );
    };
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [client]);
  const context = useMemo(
    () => ({ accountId, client, demo }),
    [accountId, client, demo],
  );
  useEffect(
    () => () => {
      void client.cancelQueries();
      client.clear();
    },
    [client],
  );
  return (
    <AccountDataContext.Provider value={context}>
      <QueryClientProvider client={client}>
        <ServerDataBridge />
        {children}
      </QueryClientProvider>
    </AccountDataContext.Provider>
  );
}
export function useOwnedData() {
  const context = useContext(AccountDataContext);
  return context?.demo ? null : context;
}
export function useCredits() {
  const context = useOwnedData();
  const local = useStore((state) => state.data.credits);
  const billing = useBillingWallet();
  return context
    ? billing.accountId === context.accountId
      ? (billing.wallet?.available ?? 0)
      : 0
    : local;
}
function useAccountData() {
  const context = useContext(AccountDataContext);
  if (!context) throw new Error("Account data provider is required");
  return context;
}
export function useProjects(search = "") {
  const { accountId } = useAccountData();
  return useInfiniteQuery({
    queryKey: [accountId, "projects", "list", search],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      listProjects({ limit: 20, cursor: pageParam, q: search }, signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}
export function useProject(id: string) {
  const { accountId } = useAccountData();
  return useQuery({
    queryKey: [accountId, "projects", "detail", id],
    queryFn: ({ signal }) => getProject(id, signal),
  });
}
export function useAssets(projectId?: string, kind?: string) {
  const { accountId } = useAccountData();
  return useInfiniteQuery({
    queryKey: [accountId, "assets", "list", projectId ?? null, kind ?? null],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      listAssets({ limit: 20, cursor: pageParam, projectId, kind }, signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}
export function useAsset(id: string) {
  const { accountId } = useAccountData();
  return useQuery({
    queryKey: [accountId, "assets", "detail", id],
    queryFn: ({ signal }) => getAsset(id, signal),
  });
}
export function useJobs(filters: JobFilters = {}, enabled = true) {
  const { accountId } = useAccountData();
  return useInfiniteQuery({
    enabled,
    queryKey: [accountId, "jobs", "list", filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      listJobs({ ...filters, limit: 20, cursor: pageParam }, signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}
export function useJob(id: string) {
  const { accountId } = useAccountData();
  return useQuery({
    queryKey: [accountId, "jobs", "detail", id],
    queryFn: ({ signal }) => getJob(id, signal),
  });
}

async function activeJobs(signal: AbortSignal) {
  const groups = await Promise.all(
    (["queued", "running"] as const).map(async (status) => {
      const jobs: JobSummary[] = [];
      let cursor: string | undefined;
      const seen = new Set<string>();
      do {
        const page = await listJobs({ status, cursor, limit: 100 }, signal);
        jobs.push(...page.items);
        cursor = page.nextCursor ?? undefined;
        if (cursor) {
          if (seen.has(cursor))
            throw new ApiError(
              200,
              "invalid_response",
              "Job pagination did not advance.",
            );
          seen.add(cursor);
        }
      } while (cursor);
      return jobs;
    }),
  );
  return groups.flat();
}
function ServerDataBridge() {
  const context = useAccountData(),
    enabled = !!useOwnedData();
  const wallet = useQuery({
    queryKey: [context.accountId, "billing", "wallet"],
    queryFn: ({ signal }) => getWallet(signal),
    enabled,
    refetchInterval: enabled ? 5000 : false,
  });
  useEffect(() => {
    if (enabled && wallet.data)
      useBillingWallet.setState({
        accountId: context.accountId,
        wallet: wallet.data,
      });
  }, [enabled, wallet.data, context.accountId]);
  useEffect(
    () => () => {
      if (useBillingWallet.getState().accountId === context.accountId)
        useBillingWallet.setState({ accountId: undefined, wallet: undefined });
    },
    [context.accountId],
  );
  const recent = useJobs({}, enabled);
  const active = useQuery({
    queryKey: [context.accountId, "jobs", "active"],
    queryFn: ({ signal }) => activeJobs(signal),
    enabled,
  });
  useEffect(() => {
    if (!enabled || (!recent.data && !active.data)) return;
    useStore.getState().mutate((data) => {
      if (data.backend?.ownerId !== context.accountId) return;
      for (const summary of [
        ...(recent.data?.pages.flatMap((page) => page.items) ?? []),
        ...(active.data ?? []),
      ]) {
        const previous = data.backend.jobs?.[summary.id];
        if (
          previous?.job &&
          new Date(previous.job.updatedAt) > new Date(summary.updatedAt)
        )
          continue;
        recordObservedJob(data, summary, {
          title: previous?.title ?? summary.operation.replaceAll("_", " "),
          job: {
            ...previous?.job,
            ...summary,
            input: previous?.job?.input ?? null,
            results: previous?.job?.results,
            attempts: previous?.job?.attempts ?? [],
          },
        });
      }
    });
  }, [enabled, recent.data, active.data, context.accountId]);
  useEffect(() => {
    if (!enabled) return;
    return useStore.subscribe((current, previous) => {
      const next = current.data.backend,
        old = previous.data.backend;
      if (next?.ownerId !== context.accountId) return;
      if (next.projects !== old?.projects) {
        const changed = Object.values(next.projects).some(
          (project) =>
            JSON.stringify(project) !==
            JSON.stringify(old?.projects[project.id]),
        );
        if (changed)
          void context.client.invalidateQueries({
            queryKey: [context.accountId, "projects"],
          });
      }
      for (const record of Object.values(next.jobs ?? {})) {
        const status = record.job?.status,
          oldStatus = old?.jobs?.[record.id]?.job?.status;
        if (status !== oldStatus && terminalBackendJob(status)) {
          void context.client.invalidateQueries({
            queryKey: [context.accountId, "jobs"],
          });
          void context.client.invalidateQueries({
            queryKey: [context.accountId, "billing", "wallet"],
          });
          if (status === "succeeded") {
            void context.client.invalidateQueries({
              queryKey: [context.accountId, "characters"],
            });
            window.dispatchEvent(new Event("reference-library-changed"));
            void context.client.invalidateQueries({
              queryKey: [context.accountId, "assets"],
            });
          }
        }
      }
    });
  }, [enabled, context]);
  return null;
}
