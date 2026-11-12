package billing

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestFakeProviderSignatures(t *testing.T) {
	provider, err := NewFake(strings.Repeat("k", 32))
	if err != nil {
		t.Fatal(err)
	}
	event := PaymentEvent{ID: "event", PurchaseID: "purchase", Type: "paid", SessionID: "session", AmountMinor: 500, Currency: "usd"}
	raw, _ := json.Marshal(event)
	if _, err := provider.VerifyEvent(raw, provider.sign(raw)); err != nil {
		t.Fatal(err)
	}
	if _, err := provider.VerifyEvent(append(raw, ' '), provider.sign(raw)); err == nil {
		t.Fatal("accepted modified event")
	}
	if _, err := provider.VerifyEvent(raw, "bad signature"); err == nil {
		t.Fatal("accepted unsigned event")
	}
	a, err := provider.CreateCheckout(context.Background(), CheckoutRequest{PurchaseID: "purchase"})
	if err != nil {
		t.Fatal(err)
	}
	b, err := provider.CreateCheckout(context.Background(), CheckoutRequest{PurchaseID: "purchase"})
	if err != nil || a != b {
		t.Fatal("checkout is not idempotent")
	}
}
