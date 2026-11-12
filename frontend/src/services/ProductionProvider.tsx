import { listProjects } from "../api/projects";
import { refreshReferenceLibrary } from "./library-projection";
import { clearShotWatches, resumeShotJobs } from "./shot-generation";
import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useOwnedData } from "./server-data";
import { activateWorkspace, beginServerWorkspace } from "../stores/store";
import { ProductionSync, useProductionSave } from "./production-sync";
export function ProductionProvider({ children }: { children: ReactNode }) {
  const owned = useOwnedData();
  const location = useLocation();
  const [session, setSession] = useState<{
    owner: string;
    sync: ProductionSync;
  }>();
  const [ready, setReady] = useState("");
  const [loadError, setLoadError] = useState("");
  const status = useProductionSave();
  const project = /^\/projects\/([^/]+)(?:\/|$)/.exec(location.pathname)?.[1];
  const id = project && project !== "browse" ? project : undefined;
  const work = location.pathname === "/work";
  useLayoutEffect(() => {
    if (!owned) {
      if (session) {
        activateWorkspace(session.owner);
        setSession(undefined);
      }
      return;
    }
    beginServerWorkspace();
    const sync = new ProductionSync();
    const library = new AbortController();
    void refreshReferenceLibrary(library.signal).catch(() => {});
    setSession({ owner: owned.accountId, sync });
    return () => {
      library.abort();
      clearShotWatches();
      sync.stop();
      beginServerWorkspace();
    };
  }, [owned?.accountId]);
  useEffect(() => {
    if (!session || !owned || session.owner !== owned.accountId) return;
    let live = true;
    setLoadError("");
    if (!id) {
      setReady("");
      if (!work) return;
      const controller = new AbortController();
      void (async () => {
        let cursor: string | undefined;
        do {
          const page = await listProjects(
            { limit: 100, cursor },
            controller.signal,
          );
          for (let i = 0; i < page.items.length; i += 4)
            await Promise.all(
              page.items.slice(i, i + 4).map((p) => session.sync.load(p.id)),
            );
          cursor = page.nextCursor ?? undefined;
        } while (cursor && !controller.signal.aborted);
        if (live) setReady("work");
      })().catch((error) => {
        if (live) setLoadError(error.message);
      });
      return () => {
        live = false;
        controller.abort();
      };
    }
    const abort = new AbortController();
    void session.sync
      .load(id)
      .then(() => {
        if (live) {
          setReady(id);
          void resumeShotJobs(id, abort.signal).catch(() => {});
        }
      })
      .catch((e) => {
        if (live) setLoadError(e.message);
      });
    return () => {
      live = false;
      abort.abort();
    };
  }, [session, id, work, owned?.accountId]);
  useEffect(() => {
    if (!session) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const library = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () => void refreshReferenceLibrary(abort.signal).catch(() => {}),
        300,
      );
    };
    window.addEventListener("reference-library-changed", library);
    return () => {
      abort.abort();
      clearTimeout(timer);
      window.removeEventListener("reference-library-changed", library);
    };
  }, [session]);
  useEffect(() => {
    if (!session) return;
    const changed = () =>
      void owned?.client.invalidateQueries({
        queryKey: [owned.accountId, "projects"],
      });
    window.addEventListener("production-saved", changed);
    return () => window.removeEventListener("production-saved", changed);
  }, [session, owned?.accountId]);
  useEffect(() => {
    if (!session) return;
    const unload = (e: BeforeUnloadEvent) => {
      if (useProductionSave.getState().pending) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const focus = () => {
      if (id && !useProductionSave.getState().pending)
        void session.sync.reload(id).catch(() => {});
    };
    const renewal = setInterval(
      () => {
        if (id) void session.sync.media(id);
      },
      4 * 60 * 1000,
    );
    window.addEventListener("beforeunload", unload);
    window.addEventListener("focus", focus);
    return () => {
      clearInterval(renewal);
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener("focus", focus);
    };
  }, [session, id]);
  if (!owned) return <>{children}</>;
  if (!session || session.owner !== owned.accountId)
    return <p role="status">Opening your studio…</p>;
  if (loadError)
    return (
      <div role="alert">
        {loadError}
        <button onClick={() => window.location.reload()}>Reload studio</button>
      </div>
    );
  if ((id && ready !== id) || (work && ready !== "work"))
    return <p role="status">Loading production…</p>;
  return (
    <>
      {status.error ? (
        <div role="alert">
          {status.error} Your unsaved edits remain in this session.
          <button onClick={() => void session.sync.flush().catch(() => {})}>
            Retry save
          </button>
          {id && (
            <button
              onClick={() => {
                if (window.confirm("Discard unsaved edits and reload?"))
                  void session.sync.reload(id, true);
              }}
            >
              Reload saved production
            </button>
          )}
        </div>
      ) : status.pending ? (
        <p role="status">Saving production…</p>
      ) : null}
      {children}
    </>
  );
}
