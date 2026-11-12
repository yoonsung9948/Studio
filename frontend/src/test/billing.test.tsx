import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AccountDataProvider, useCredits } from "../services/server-data";
import { configureApiSession } from "../api/session";
import { activateWorkspace, useStore } from "../stores/store";
import { bindBackendOwner } from "../domain/interpretation";
import { RechargeDialog } from "../features/account/Profile";
import { BillingCheckout } from "../features/billing/Checkout";
import { jsonResponse } from "./fixtures/backend";

const owner = "40000000-0000-4000-8000-000000000001";
const purchaseId = "90000000-0000-4000-8000-000000000001";
const purchase = {
  id: purchaseId,
  packId: "standard",
  credits: 1000,
  amountMinor: 1500,
  currency: "usd",
  provider: "fake",
  checkoutUrl: `/billing/checkout/${purchaseId}`,
  status: "pending",
  createdAt: "2026-11-05T00:00:00Z",
  updatedAt: "2026-11-05T00:00:00Z",
};
let release: (() => void) | undefined;
beforeEach(() => {
  vi.stubEnv("VITE_HOME_WORKFLOW", "api");
  vi.stubEnv("VITE_AUTH_BYPASS", "false");
  activateWorkspace(owner);
  useStore.getState().mutate((data) => bindBackendOwner(data, owner));
  release = configureApiSession(async () => "token");
});
afterEach(() => {
  release?.();
  activateWorkspace(null);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
function Balance() {
  const credits = useCredits();
  return <p data-testid="balance">{credits}</p>;
}
function openBilling(path = "/projects") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AccountDataProvider accountId={owner}>
        <Balance />
        <Routes>
          <Route
            path="/projects"
            element={<RechargeDialog open onOpenChange={() => {}} />}
          />
          <Route
            path="/billing/checkout/:purchaseId"
            element={<BillingCheckout />}
          />
        </Routes>
      </AccountDataProvider>
    </MemoryRouter>,
  );
}
function mockAPI(handler: (path: string, options: RequestInit) => Response) {
  const fetcher = vi.fn((path: string, options: RequestInit = {}) =>
    Promise.resolve(handler(path, options)),
  );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
const empty = { items: [], nextCursor: null };
it("reuses the checkout key after an uncertain submission and never adds local credits", async () => {
  let attempts = 0;
  const keys: string[] = [];
  const before = useStore.getState().data.credits;
  mockAPI((path, options) => {
    if (path.endsWith("/billing/wallet"))
      return jsonResponse({ available: 25, reserved: 8 });
    if (path.endsWith("/billing/packs"))
      return jsonResponse({
        mode: "fake",
        packs: [
          { id: "standard", credits: 1000, amountMinor: 1500, currency: "usd" },
        ],
      });
    if (path.endsWith("/billing/checkouts")) {
      keys.push(new Headers(options.headers).get("Idempotency-Key")!);
      attempts++;
      return attempts === 1
        ? jsonResponse(
            { error: { code: "unavailable", message: "Retry checkout" } },
            503,
          )
        : jsonResponse(purchase, 201);
    }
    if (path.endsWith(`/purchases/${purchaseId}`))
      return jsonResponse(purchase);
    return jsonResponse(empty);
  });
  openBilling();
  await waitFor(() =>
    expect(screen.getByTestId("balance")).toHaveTextContent("25"),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Continue to test checkout" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Retry checkout");
  fireEvent.click(
    screen.getByRole("button", { name: "Continue to test checkout" }),
  );
  expect(
    await screen.findByRole("heading", { name: "Test checkout" }),
  ).toBeInTheDocument();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  expect(useStore.getState().data.credits).toBe(before);
});
it("refreshes the server wallet after payment and permits duplicate-event testing", async () => {
  let available = 0,
    paid = false,
    confirmations = 0;
  mockAPI((path, options) => {
    if (path.endsWith("/billing/wallet"))
      return jsonResponse({ available, reserved: 0 });
    if (path.endsWith("/simulate")) {
      expect(JSON.parse(options.body as string)).toEqual({ action: "paid" });
      confirmations++;
      if (!paid) {
        available = 1000;
        paid = true;
      }
      return jsonResponse({ ...purchase, status: "paid" });
    }
    if (path.endsWith(`/purchases/${purchaseId}`))
      return jsonResponse({ ...purchase, status: paid ? "paid" : "pending" });
    return jsonResponse(empty);
  });
  openBilling(`/billing/checkout/${purchaseId}`);
  fireEvent.click(
    await screen.findByRole("button", { name: "Simulate successful payment" }),
  );
  await waitFor(() =>
    expect(screen.getByTestId("balance")).toHaveTextContent("1000"),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Replay payment confirmation" }),
  );
  await waitFor(() => expect(confirmations).toBe(2));
  expect(screen.getByTestId("balance")).toHaveTextContent("1000");
});
it("does not offer fake checkout when server payments are disabled", async () => {
  mockAPI((path) =>
    path.endsWith("/billing/wallet")
      ? jsonResponse({ available: 0, reserved: 0 })
      : path.endsWith("/billing/packs")
        ? jsonResponse({ mode: "disabled", packs: [] })
        : jsonResponse(empty),
  );
  openBilling();
  expect(
    await screen.findByText("Payments are not configured on this server."),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Continue to test checkout" }),
  ).toBeDisabled();
});
