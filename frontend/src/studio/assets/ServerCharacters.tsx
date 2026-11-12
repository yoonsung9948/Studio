import {
  referenceAPI,
  referenceViews,
  type ReferenceKind,
} from "../../api/references";
import { productionSync } from "../../services/production-sync";
import { useEffect, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import * as api from "../../api/characters";
import { useOwnedData } from "../../services/server-data";
import { backendJobObserver } from "../../services/job-observer";
import { AssetThumbnail } from "../ServerLibrary";
import { useStore } from "../../stores/store";
import type { Job } from "../../api/types";

export function SubjectViewEditor({
  id,
  onDeleted,
  kind = "character",
}: {
  id: string;
  onDeleted(): void;
  kind?: ReferenceKind | "character";
}) {
  const service = kind === "character" ? api : referenceAPI(kind);
  const views =
    kind === "character" ? api.characterViews : referenceViews(kind);
  const label = kind === "cast" ? "character" : kind.replace("_instance", "");
  const context = useOwnedData()!;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState("front");
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState(1);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [pending, setPending] = useState<{
    key: string;
    input: {
      views: string[];
      count: number;
      prompt: string;
      sourceVersionId?: string;
    };
  }>();
  const key = [context.accountId, "characters", kind, id];
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => service.getCharacter(id, signal),
  });
  const versions = useInfiniteQuery({
    queryKey: [...key, "versions"],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      service.characterVersions(id, pageParam, signal),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  const [fields, setFields] = useState({ name: "", appearance: "", notes: "" });
  useEffect(() => {
    if (query.data)
      setFields({
        name: query.data.name,
        appearance: query.data.appearance,
        notes: query.data.notes,
      });
  }, [query.data]);
  const refresh = () => {
    void context.client.invalidateQueries({
      queryKey: [context.accountId, "characters"],
    });
    void context.client.invalidateQueries({
      queryKey: [context.accountId, "billing"],
    });
  };
  useEffect(() => {
    const stops = jobs.map((job) =>
      backendJobObserver.watch(
        { id: job.id, operation: job.operation, projectId: job.projectId },
        {
          onJob: (updated) => {
            if (updated.status === "succeeded" || updated.status === "failed") {
              refresh();
              if (updated.error) setError(updated.error.message);
            }
          },
          onError: (failure) => setError(failure.message),
        },
      ),
    );
    return () => stops.forEach((stop) => stop());
  }, [jobs, context.accountId]);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await productionSync()?.flush();
      await fn();
      refresh();
      window.dispatchEvent(new Event("reference-library-changed"));
      if (kind === "look" || kind === "cast" || kind.endsWith("_instance")) {
        const data = useStore.getState().data;
        const project =
          kind === "look"
            ? data.characters[data.studio.looks[id]?.characterId]?.projectId
            : kind === "cast"
              ? data.characters[id]?.projectId
              : kind === "place_instance"
                ? data.studio.locations[id]?.projectId
                : Object.values(data.projects).find((p) =>
                    p.worldElements?.some((e) => e.id === id),
                  )?.id;
        if (project) await productionSync()?.reload(project);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };
  const generate = (sourceVersionId?: string) =>
    void run(async () => {
      const request = pending ?? {
        key: crypto.randomUUID(),
        input: { views: [view], count, prompt, sourceVersionId },
      };
      setPending(request);
      await productionSync()?.flush();
      const accepted = await service.generateCharacter(
        id,
        request.input,
        request.key,
      );
      setJobs(accepted.jobs);
      setPending(undefined);
    });
  if (query.isPending) return <p role="status">Loading character…</p>;
  if (query.error) return <p role="alert">{query.error.message}</p>;
  const character = query.data!;
  const candidates = (
    versions.data?.pages.flatMap((p) => p.items) ?? []
  ).filter((v) => v.view === view);
  return (
    <section className="st-panel-scroll" aria-label={`${label} editor`}>
      <h1>{character.name}</h1>
      <form
        hidden={
          kind === "look" || kind === "cast" || kind.endsWith("_instance")
        }
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => service.updateCharacter(id, fields));
        }}
      >
        {(["name", "appearance", "notes"] as const).map((field) => (
          <label key={field}>
            {field}
            <textarea
              aria-label={`${label === "character" ? "Character" : label} ${field}`}
              value={fields[field]}
              onChange={(e) =>
                setFields({ ...fields, [field]: e.target.value })
              }
            />
          </label>
        ))}
        <button disabled={busy}>Save {label}</button>
      </form>
      {(kind === "character" || kind === "place" || kind === "prop") && (
        <button
          disabled={busy}
          onClick={() => {
            if (
              window.confirm(
                "Delete this library character? Production snapshots are retained.",
              )
            )
              void run(async () => {
                await service.deleteCharacter(id);
                onDeleted();
              });
          }}
        >
          Delete {label}
        </button>
      )}
      <nav aria-label={`${label} views`}>
        {views.map((type) => (
          <button
            key={type}
            aria-pressed={view === type}
            onClick={() => setView(type)}
          >
            {type.replaceAll("_", " ")}
          </button>
        ))}
      </nav>
      {view !== "front" && !character.canonicalVersionId && (
        <p>Select a front portrait before generating other views.</p>
      )}
      <label>
        Image direction
        <textarea
          aria-label="Image direction"
          value={prompt}
          disabled={!!pending}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </label>
      <label>
        Candidates
        <select
          aria-label="Candidates"
          disabled={!!pending}
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
        >
          {[1, 2, 3, 4].map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </label>
      <button
        disabled={busy || (view !== "front" && !character.canonicalVersionId)}
        onClick={() => generate()}
      >
        {pending ? "Retry same submission" : "Generate view"}
      </button>
      {pending && (
        <button onClick={() => setPending(undefined)}>
          Discard submission retry
        </button>
      )}
      {(kind !== "character" || view === "front") && (
        <label>
          Upload {view.replaceAll("_", " ")} (PNG, JPEG or WebP, up to{" "}
          {kind === "character" ? 5 : 32} MB)
          <input
            aria-label={
              kind === "character" ? "Upload front portrait" : `Upload ${view}`
            }
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                if (file.size > (kind === "character" ? 5 : 32) * 1024 * 1024) {
                  setError("Use an image up to 5 MB.");
                  return;
                }
                void run(() =>
                  kind === "character"
                    ? api.uploadCharacter(id, file, crypto.randomUUID())
                    : referenceAPI(kind).uploadCharacter(
                        id,
                        file,
                        crypto.randomUUID(),
                        view,
                      ),
                );
              }
              e.target.value = "";
            }}
          />
        </label>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="ag-grid">
        {candidates.map((version) => (
          <article key={version.id}>
            <AssetThumbnail id={version.assetId} kind="image" />
            <p>
              {version.approval}
              {version.stale ? " · Stale" : ""}
              {character.views.find((v) => v.type === view)
                ?.selectedVersionId === version.id
                ? " · Selected"
                : ""}
            </p>
            <button
              disabled={busy || version.stale}
              onClick={() =>
                void run(() =>
                  service.selectCharacterVersion(id, view, version.id),
                )
              }
            >
              Use this image
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(() => service.rejectCharacterVersion(id, version.id))
              }
            >
              Reject image
            </button>
            <button
              disabled={busy || version.stale || !!pending}
              onClick={() => generate(version.id)}
            >
              Edit this image
            </button>
          </article>
        ))}
      </div>
      {versions.hasNextPage && (
        <button onClick={() => void versions.fetchNextPage()}>
          Load more images
        </button>
      )}
    </section>
  );
}
export function ServerCharacters() {
  const context = useOwnedData()!;
  const [params, setParams] = useSearchParams();
  const kind =
    params.get("kind") === "places"
      ? "place"
      : params.get("kind") === "props"
        ? "prop"
        : "character";
  const service = kind === "character" ? api : referenceAPI(kind);
  const id = params.get("character");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const query = useInfiniteQuery({
    queryKey: [context.accountId, "characters", kind, "list"],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      service.listCharacters(pageParam, signal),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  const create = async () => {
    setBusy(true);
    setError("");
    try {
      const character = await service.createCharacter({
        name: `Untitled ${kind}`,
        appearance: "",
        notes: "",
      });
      await context.client.invalidateQueries({
        queryKey: [context.accountId, "characters"],
      });
      setParams({
        kind:
          kind === "place"
            ? "places"
            : kind === "prop"
              ? "props"
              : "characters",
        character: character.id,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Creation failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="ac-workspace">
      <header className="av-heading">
        <h1>Reusable assets</h1>
        <nav>
          {["characters", "places", "props"].map((tab) => (
            <button
              key={tab}
              aria-pressed={(params.get("kind") ?? "characters") === tab}
              onClick={() => setParams({ kind: tab })}
            >
              {tab}
            </button>
          ))}
        </nav>
        <button disabled={busy} onClick={() => void create()}>
          New {kind}
        </button>
        {id && (
          <button
            onClick={() =>
              setParams({ kind: params.get("kind") ?? "characters" })
            }
          >
            Back to library
          </button>
        )}
      </header>
      {error && <p role="alert">{error}</p>}
      {id ? (
        <SubjectViewEditor
          key={kind + id}
          kind={kind}
          id={id}
          onDeleted={() =>
            setParams({ kind: params.get("kind") ?? "characters" })
          }
        />
      ) : (
        <>
          <p>
            Create reusable characters. Save the front portrait before
            generating other views.
          </p>
          {query.error && <p role="alert">{query.error.message}</p>}
          <div className="ag-grid">
            {query.data?.pages
              .flatMap((p) => p.items)
              .map((character) => (
                <button
                  key={character.id}
                  onClick={() =>
                    setParams({
                      kind:
                        kind === "place"
                          ? "places"
                          : kind === "prop"
                            ? "props"
                            : "characters",
                      character: character.id,
                    })
                  }
                >
                  {character.name}
                </button>
              ))}
          </div>
          {query.hasNextPage && (
            <button onClick={() => void query.fetchNextPage()}>
              Load more characters
            </button>
          )}
        </>
      )}
    </section>
  );
}
