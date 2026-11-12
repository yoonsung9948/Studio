import { z } from "zod";
import { queryString, type PageParams } from "./pagination";
import { requestJSON } from "./client";
import { projectSchema, type CreateProjectRequest } from "./types";
export function createProject(
  input: CreateProjectRequest,
  signal?: AbortSignal,
) {
  return requestJSON("/projects", (v) => projectSchema.parse(v), {
    method: "POST",
    body: input,
    signal,
  });
}

export function listProjects(
  params: PageParams & { q?: string } = {},
  signal?: AbortSignal,
) {
  return requestJSON(
    `/projects${queryString(params)}`,
    (value) =>
      z
        .object({
          items: z.array(projectSchema),
          nextCursor: z.string().nullable(),
        })
        .parse(value),
    { signal },
  );
}
export function getProject(id: string, signal?: AbortSignal) {
  return requestJSON(
    `/projects/${encodeURIComponent(id)}`,
    (value) => projectSchema.parse(value),
    { signal },
  );
}
