import { z } from "zod";
import { requestJSON } from "./client";

export const walletSchema = z.object({
  available: z.number().int(),
  reserved: z.number().int().nonnegative(),
});
export type Wallet = z.infer<typeof walletSchema>;
const packSchema = z.object({
  id: z.string(),
  credits: z.number().int().positive(),
  amountMinor: z.number().int().positive(),
  currency: z.string(),
});
export const purchaseSchema = z.object({
  id: z.uuid(),
  packId: z.string(),
  credits: z.number().int().positive(),
  amountMinor: z.number().int().positive(),
  currency: z.string(),
  provider: z.string(),
  checkoutUrl: z.string().nullable(),
  status: z.enum(["pending", "paid", "failed", "cancelled", "refunded"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Purchase = z.infer<typeof purchaseSchema>;
export const getWallet = (signal?: AbortSignal) =>
  requestJSON("/billing/wallet", (v) => walletSchema.parse(v), { signal });
export const getCreditPacks = (signal?: AbortSignal) =>
  requestJSON(
    "/billing/packs",
    (v) =>
      z
        .object({
          mode: z.enum(["fake", "disabled"]),
          packs: z.array(packSchema),
        })
        .parse(v),
    { signal },
  );
export const createCheckout = (packId: string, key: string) =>
  requestJSON("/billing/checkouts", (v) => purchaseSchema.parse(v), {
    method: "POST",
    body: { packId },
    headers: { "Idempotency-Key": key },
  });
export const getPurchase = (id: string, signal?: AbortSignal) =>
  requestJSON(
    `/billing/purchases/${encodeURIComponent(id)}`,
    (v) => purchaseSchema.parse(v),
    { signal },
  );
export type PaymentAction =
  "paid" | "failed" | "cancelled" | "delayed" | "refunded";
export const simulatePayment = (id: string, action: PaymentAction) =>
  requestJSON(
    `/billing/purchases/${encodeURIComponent(id)}/simulate`,
    (v) => purchaseSchema.parse(v),
    { method: "POST", body: { action } },
  );
