import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import {
  getPurchase,
  simulatePayment,
  type PaymentAction,
} from "../../api/billing";
import { useOwnedData } from "../../services/server-data";

export function BillingCheckout() {
  return useOwnedData() ? (
    <Checkout />
  ) : (
    <p>Sign in with backend access to open checkout.</p>
  );
}
function Checkout() {
  const context = useOwnedData()!,
    { purchaseId = "" } = useParams();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const key = [context.accountId, "billing", "purchase", purchaseId];
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => getPurchase(purchaseId, signal),
    refetchInterval: (q) => (q.state.data?.status === "pending" ? 1000 : false),
  });
  const purchase = query.data;
  useEffect(() => {
    if (purchase)
      void context.client.invalidateQueries({
        queryKey: [context.accountId, "billing", "wallet"],
      });
  }, [purchase?.status, context.accountId, context.client]);
  const simulate = async (action: PaymentAction) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await simulatePayment(purchaseId, action);
      context.client.setQueryData(key, result);
      await context.client.invalidateQueries({
        queryKey: [context.accountId, "billing", "wallet"],
      });
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Payment simulation failed. Retry.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="account-settings-card"
      style={{ maxWidth: 640, margin: "32px auto", padding: 24 }}
    >
      <h1>Test checkout</h1>
      <p>
        No real payment is collected. This page simulates provider confirmation.
      </p>
      {query.isPending && <p role="status">Loading purchase…</p>}
      {query.error && (
        <p role="alert">
          {query.error.message}
          <button onClick={() => void query.refetch()}>Retry</button>
        </p>
      )}
      {purchase && (
        <>
          <h2>{purchase.credits.toLocaleString()} credits</h2>
          <p>
            {new Intl.NumberFormat(undefined, {
              style: "currency",
              currency: purchase.currency,
            }).format(purchase.amountMinor / 100)}
          </p>
          <p role="status">Payment status: {purchase.status}</p>
          {purchase.provider === "fake" && (
            <div className="form-fields">
              {purchase.status === "pending" && (
                <>
                  {(
                    [
                      ["paid", "Simulate successful payment"],
                      ["delayed", "Simulate delayed confirmation"],
                      ["failed", "Simulate payment failure"],
                      ["cancelled", "Cancel checkout"],
                    ] as const
                  ).map(([action, label]) => (
                    <button
                      className="st-button"
                      key={action}
                      disabled={busy}
                      onClick={() => void simulate(action)}
                    >
                      {label}
                    </button>
                  ))}
                </>
              )}
              {purchase.status === "paid" && (
                <>
                  <button
                    className="st-button"
                    disabled={busy}
                    onClick={() => void simulate("paid")}
                  >
                    Replay payment confirmation
                  </button>
                  <button
                    className="st-button"
                    disabled={busy}
                    onClick={() => void simulate("refunded")}
                  >
                    Simulate full refund
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <p>
        <Link to="/projects">Return to studio</Link>
      </p>
    </section>
  );
}
