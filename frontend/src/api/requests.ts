import { requestJSON } from "./client";
import {
  acceptedRequestSchema,
  userRequestSchema,
  type SubmitRequestInput,
} from "./types";

export function submitRequest(
  input: SubmitRequestInput,
  idempotencyKey: string,
  signal?: AbortSignal,
) {
  return requestJSON(
    "/requests",
    (value) => acceptedRequestSchema.parse(value),
    {
      method: "POST",
      body: { ...input, projectId: input.projectId ?? null },
      headers: { "Idempotency-Key": idempotencyKey },
      signal,
    },
  );
}

export function getRequest(id: string, signal?: AbortSignal) {
  return requestJSON(
    `/requests/${encodeURIComponent(id)}`,
    (value) => userRequestSchema.parse(value),
    { signal },
  );
}
