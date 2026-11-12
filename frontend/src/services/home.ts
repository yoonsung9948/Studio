import { useStore } from "../stores/store";
import { interpretationWorkflow } from "./interpretation";
import { createHomeDraft } from "../domain/workspace";
import { commit } from "../studio/generation";
export interface HomeRequest {
  prompt: string;
  projectId?: string;
  creationKind?: "episode" | "scene" | "shot";
  durationSeconds?: number;
}
/** Adapt the existing composer without ever sending a local editorial ID to Go. */
export async function submitHomeRequest(input: HomeRequest) {
  const data = useStore.getState().data;
  const local = input.projectId ? data.projects[input.projectId] : undefined;
  const backendId = local
    ? data.backend?.projectLinks?.[local.id]
    : input.projectId;
  if (!local && backendId && !data.backend?.projects[backendId])
    throw new Error("Choose an existing project or No project.");
  await interpretationWorkflow.start({
    prompt: input.prompt,
    projectId: backendId,
    title: local?.title,
    sourceProjectId: local?.id,
    creationKind: input.creationKind,
    durationSeconds: input.durationSeconds,
  });
}
/** Developer-only demo entry: /projects?mode=demo uses the same composer. */
export function createDemoHomeDraft(input: HomeRequest) {
  const kind = input.creationKind ?? "episode";
  let result: ReturnType<typeof createHomeDraft> | undefined;
  if (
    !commit(
      (data) => {
        result = createHomeDraft(
          data,
          input.prompt,
          kind,
          input.projectId,
          input.durationSeconds ?? 30,
        );
      },
      `${kind[0].toUpperCase() + kind.slice(1)} draft created · 0 credits spent`,
    )
  )
    return undefined;
  return result;
}
