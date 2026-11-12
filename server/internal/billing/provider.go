package billing

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
)

type CheckoutRequest struct {
	PurchaseID  string
	AmountMinor int64
	Currency    string
}

type Checkout struct {
	SessionID string
	URL       string
}

type PaymentEvent struct {
	ID          string `json:"id"`
	PurchaseID  string `json:"purchaseId"`
	SessionID   string `json:"sessionId"`
	Type        string `json:"type"`
	AmountMinor int64  `json:"amountMinor"`
	Currency    string `json:"currency"`
}

type Provider interface {
	Name() string
	CreateCheckout(context.Context, CheckoutRequest) (Checkout, error)
	VerifyEvent([]byte, string) (PaymentEvent, error)
}

// Fake is enabled only by explicit development configuration. Purchases and
// events live in PostgreSQL, so no provider state is lost on process restart.
type Fake struct{ key []byte }

func NewFake(secret string) (*Fake, error) {
	if len(secret) < 32 {
		return nil, errors.New("fake payment secret must contain at least 32 bytes")
	}
	return &Fake{key: []byte(secret)}, nil
}

func (*Fake) Name() string { return "fake" }

func (*Fake) CreateCheckout(ctx context.Context, in CheckoutRequest) (Checkout, error) {
	if err := ctx.Err(); err != nil {
		return Checkout{}, err
	}
	return Checkout{SessionID: "fake:" + in.PurchaseID, URL: "/billing/checkout/" + in.PurchaseID}, nil
}

func (f *Fake) sign(payload []byte) string {
	h := hmac.New(sha256.New, f.key)
	h.Write(payload)
	return hex.EncodeToString(h.Sum(nil))
}

func (f *Fake) VerifyEvent(payload []byte, signature string) (PaymentEvent, error) {
	var event PaymentEvent
	expected, err := hex.DecodeString(f.sign(payload))
	if err != nil {
		return event, err
	}
	supplied, err := hex.DecodeString(signature)
	if err != nil || !hmac.Equal(expected, supplied) {
		return event, errors.New("invalid payment signature")
	}
	if err := json.Unmarshal(payload, &event); err != nil {
		return event, err
	}
	return event, nil
}
