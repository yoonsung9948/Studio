import { create } from "zustand";
import type { Wallet } from "../api/billing";

// Live server balances never overwrite the local demo workspace's credits.
export const useBillingWallet = create<{ accountId?: string; wallet?: Wallet }>(
  () => ({}),
);
