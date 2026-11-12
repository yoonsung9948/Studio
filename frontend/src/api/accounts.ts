import { z } from "zod";
import { requestJSON } from "./client";
const accountSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  status: z.literal("active"),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export function getAccount(signal?: AbortSignal) {
  return requestJSON("/me", (value) => accountSchema.parse(value), { signal });
}
