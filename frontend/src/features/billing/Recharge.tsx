import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { createCheckout, getCreditPacks } from "../../api/billing";
import { useOwnedData, useCredits } from "../../services/server-data";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../components/ui/dialog";

export function ServerRechargeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const context = useOwnedData()!;
  const navigate = useNavigate();
  const credits = useCredits();
  const packs = useQuery({
    queryKey: [context.accountId, "billing", "packs"],
    queryFn: ({ signal }) => getCreditPacks(signal),
    enabled: open,
  });
  const [selected, setSelected] = useState("standard"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const attempt = useRef<{ pack: string; key: string } | undefined>(undefined);
  const checkout = async () => {
    if (busy) return;
    if (!attempt.current || attempt.current.pack !== selected)
      attempt.current = { pack: selected, key: crypto.randomUUID() };
    setBusy(true);
    setError("");
    try {
      const purchase = await createCheckout(selected, attempt.current.key);
      if (
        !purchase.checkoutUrl ||
        purchase.checkoutUrl !== `/billing/checkout/${purchase.id}`
      )
        throw Error(
          "The checkout URL is unavailable. Retry the same purchase.",
        );
      onOpenChange(false);
      navigate(purchase.checkoutUrl);
      attempt.current = undefined;
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not create checkout. Retry.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="recharge-dialog">
        <DialogTitle>Recharge credits</DialogTitle>
        <DialogDescription>
          {packs.data?.mode === "fake"
            ? "Test checkout. No money is collected."
            : "Purchase credits for generation."}
        </DialogDescription>
        <p>
          Available balance: <b>{credits.toLocaleString()} credits</b>
        </p>
        {packs.isPending && <p role="status">Loading credit packs…</p>}
        {packs.error && (
          <p role="alert">
            {packs.error.message}
            <button onClick={() => void packs.refetch()}>Retry</button>
          </p>
        )}
        {packs.data?.mode === "disabled" && (
          <p role="status">Payments are not configured on this server.</p>
        )}
        <div className="recharge-packs" role="group" aria-label="Credit pack">
          {packs.data?.packs.map((pack) => (
            <button
              key={pack.id}
              disabled={busy}
              aria-pressed={selected === pack.id}
              onClick={() => setSelected(pack.id)}
            >
              <b>{pack.credits.toLocaleString()} credits</b>
              <span>
                {new Intl.NumberFormat(undefined, {
                  style: "currency",
                  currency: pack.currency,
                }).format(pack.amountMinor / 100)}
              </span>
            </button>
          ))}
        </div>
        {error && <p role="alert">{error}</p>}
        <Button
          disabled={busy || !packs.data || packs.data.mode !== "fake"}
          onClick={() => void checkout()}
        >
          {busy ? "Opening checkout…" : "Continue to test checkout"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
