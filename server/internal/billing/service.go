package billing

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"nori/studio/server/internal/platform/apperr"
)

type Pack struct {
	ID          string `json:"id"`
	Credits     int64  `json:"credits"`
	AmountMinor int64  `json:"amountMinor"`
	Currency    string `json:"currency"`
}

var packs = []Pack{{"small", 250, 500, "usd"}, {"standard", 1000, 1500, "usd"}, {"large", 2500, 3000, "usd"}}

type Purchase struct {
	ID          string    `json:"id"`
	PackID      string    `json:"packId"`
	Credits     int64     `json:"credits"`
	AmountMinor int64     `json:"amountMinor"`
	Currency    string    `json:"currency"`
	Provider    string    `json:"provider"`
	SessionID   *string   `json:"-"`
	CheckoutURL *string   `json:"checkoutUrl"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type Service struct {
	pool     *pgxpool.Pool
	provider Provider
}

func NewService(pool *pgxpool.Pool, provider Provider) *Service {
	return &Service{pool: pool, provider: provider}
}

func (s *Service) Mode() string {
	if s.provider == nil {
		return "disabled"
	}
	return s.provider.Name()
}

func (s *Service) Packs() []Pack { return append([]Pack{}, packs...) }

var ErrDisabled = &apperr.ConflictError{Code: "payments_unavailable", Message: "Payments are not configured."}

const purchaseColumns = "id::text,pack_id,credits,amount_minor,currency,provider,provider_session_id,checkout_url,status,created_at,updated_at"

func scanPurchase(row pgx.Row) (Purchase, error) {
	var p Purchase
	err := row.Scan(&p.ID, &p.PackID, &p.Credits, &p.AmountMinor, &p.Currency, &p.Provider, &p.SessionID, &p.CheckoutURL, &p.Status, &p.CreatedAt, &p.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		err = apperr.ErrNotFound
	}
	return p, err
}

func (s *Service) Purchase(ctx context.Context, owner, id string) (Purchase, error) {
	return scanPurchase(s.pool.QueryRow(ctx, `SELECT `+purchaseColumns+` FROM purchases WHERE id=$1 AND owner_user_id=$2`, id, owner))
}

func (s *Service) Wallet(ctx context.Context, owner string) (Wallet, error) {
	var wallet Wallet
	err := s.pool.QueryRow(ctx, `SELECT available,reserved FROM credit_wallets WHERE owner_user_id=$1`, owner).Scan(&wallet.Available, &wallet.Reserved)
	if errors.Is(err, pgx.ErrNoRows) {
		return Wallet{}, nil
	}
	return wallet, err
}

func (s *Service) Checkout(ctx context.Context, owner, key, packID string) (Purchase, error) {
	if s.provider == nil {
		return Purchase{}, ErrDisabled
	}
	if err := validateKey(key); err != nil {
		return Purchase{}, err
	}
	var pack *Pack
	for _, p := range packs {
		if p.ID == packID {
			copy := p
			pack = &copy
			break
		}
	}
	if pack == nil {
		return Purchase{}, &apperr.ValidationError{Message: "unknown credit pack"}
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Purchase{}, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "checkout:"+owner+":"+key); err != nil {
		return Purchase{}, err
	}
	p, err := scanPurchase(tx.QueryRow(ctx, `SELECT `+purchaseColumns+` FROM purchases WHERE owner_user_id=$1 AND idempotency_key=$2`, owner, key))
	if err == nil {
		if p.PackID != packID {
			return Purchase{}, &apperr.ConflictError{Code: "idempotency_conflict", Message: "Checkout key already used for another pack."}
		}
	} else if errors.Is(err, apperr.ErrNotFound) {
		p, err = scanPurchase(tx.QueryRow(ctx, `INSERT INTO purchases(id,owner_user_id,idempotency_key,pack_id,credits,amount_minor,currency,provider) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING `+purchaseColumns, uuid.NewString(), owner, key, pack.ID, pack.Credits, pack.AmountMinor, pack.Currency, s.provider.Name()))
	}
	if err != nil {
		return Purchase{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Purchase{}, err
	}
	if p.CheckoutURL != nil {
		return p, nil
	}
	// Remote I/O stays outside transactions. Purchase ID is the provider idempotency key.
	checkout, err := s.provider.CreateCheckout(ctx, CheckoutRequest{PurchaseID: p.ID, AmountMinor: p.AmountMinor, Currency: p.Currency})
	if err != nil {
		return Purchase{}, err
	}
	_, err = s.pool.Exec(ctx, `UPDATE purchases SET provider_session_id=$3,checkout_url=$4,updated_at=now() WHERE id=$1 AND owner_user_id=$2 AND provider_session_id IS NULL`, p.ID, owner, checkout.SessionID, checkout.URL)
	if err != nil {
		return Purchase{}, err
	}
	return s.Purchase(ctx, owner, p.ID)
}

func (s *Service) Simulate(ctx context.Context, owner, id, action string) (Purchase, error) {
	fake, ok := s.provider.(*Fake)
	if !ok {
		return Purchase{}, ErrDisabled
	}
	p, err := s.Purchase(ctx, owner, id)
	if err != nil {
		return Purchase{}, err
	}
	if p.SessionID == nil {
		return Purchase{}, &apperr.ConflictError{Code: "checkout_pending", Message: "Checkout creation is still pending."}
	}
	eventType := action
	if action == "delayed" {
		eventType = "paid"
	}
	switch eventType {
	case "paid", "failed", "cancelled", "refunded":
	default:
		return Purchase{}, &apperr.ValidationError{Message: "unsupported fake payment action"}
	}
	if eventType == "refunded" && p.Status != "paid" && p.Status != "refunded" {
		return Purchase{}, &apperr.ConflictError{Code: "not_paid", Message: "Only paid purchases can be refunded."}
	}
	event := PaymentEvent{ID: "fake:" + id + ":" + eventType, PurchaseID: id, SessionID: *p.SessionID, Type: eventType, AmountMinor: p.AmountMinor, Currency: p.Currency}
	raw, err := json.Marshal(event)
	if err != nil {
		return Purchase{}, err
	}
	delay := time.Duration(0)
	if action == "delayed" {
		delay = 3 * time.Second
	}
	if err := s.Receive(ctx, raw, fake.sign(raw), delay); err != nil {
		return Purchase{}, err
	}
	return s.Purchase(ctx, owner, id)
}

func (s *Service) Receive(ctx context.Context, payload []byte, signature string, delay time.Duration) error {
	if s.provider == nil {
		return ErrDisabled
	}
	event, err := s.provider.VerifyEvent(payload, signature)
	if err != nil {
		return &apperr.ValidationError{Message: "invalid payment event"}
	}
	if _, err := uuid.Parse(event.PurchaseID); err != nil || event.ID == "" {
		return &apperr.ValidationError{Message: "invalid payment event"}
	}
	normalized, err := json.Marshal(event)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `INSERT INTO payment_events(provider,event_id,payload,available_at) VALUES($1,$2,$3,now()+$4::interval) ON CONFLICT DO NOTHING`, s.provider.Name(), event.ID, normalized, delay.String())
	if err != nil {
		return err
	}
	var matches bool
	if err := s.pool.QueryRow(ctx, `SELECT payload=$3::jsonb FROM payment_events WHERE provider=$1 AND event_id=$2`, s.provider.Name(), event.ID, normalized).Scan(&matches); err != nil {
		return err
	}
	if !matches {
		return errors.New("payment event ID reused with different content")
	}
	// Duplicate delivery can still finish an event whose previous processing crashed.
	if delay > 0 {
		return nil
	}
	return s.process(ctx, s.provider.Name(), event.ID)
}

func (s *Service) process(ctx context.Context, provider, id string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var raw []byte
	err = tx.QueryRow(ctx, `SELECT payload FROM payment_events WHERE provider=$1 AND event_id=$2 AND processed_at IS NULL AND available_at<=now() FOR UPDATE`, provider, id).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	var event PaymentEvent
	if err := json.Unmarshal(raw, &event); err != nil {
		return err
	}
	var owner string
	p, err := scanPurchase(tx.QueryRow(ctx, `SELECT `+purchaseColumns+` FROM purchases WHERE id=$1 AND provider=$2 FOR UPDATE`, event.PurchaseID, provider))
	if err != nil {
		return err
	}
	if err := tx.QueryRow(ctx, `SELECT owner_user_id::text FROM purchases WHERE id=$1 AND provider=$2`, p.ID, provider).Scan(&owner); err != nil {
		return err
	}
	if p.SessionID == nil || *p.SessionID != event.SessionID || p.AmountMinor != event.AmountMinor || p.Currency != event.Currency {
		return errors.New("payment event does not match its purchase")
	}
	status := p.Status
	switch event.Type {
	case "paid":
		if status != "paid" && status != "refunded" {
			if err := change(ctx, tx, owner, "purchase:"+p.ID+":grant", "grant", p.Credits, 0); err != nil {
				return err
			}
			status = "paid"
		}
	case "refunded":
		if status == "paid" {
			if err := change(ctx, tx, owner, "purchase:"+p.ID+":refund", "refund", -p.Credits, 0); err != nil {
				return err
			}
		}
		status = "refunded"
	case "failed", "cancelled":
		if status != "paid" && status != "refunded" {
			status = event.Type
		}
	default:
		return errors.New("unsupported payment event")
	}
	if _, err := tx.Exec(ctx, `UPDATE purchases SET status=$3,updated_at=now() WHERE id=$1 AND owner_user_id=$2`, p.ID, owner, status); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE payment_events SET processed_at=now() WHERE provider=$1 AND event_id=$2`, provider, id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) Reconcile(ctx context.Context) error {
	if s.provider == nil {
		return nil
	}
	rows, err := s.pool.Query(ctx, `SELECT provider,event_id FROM payment_events WHERE processed_at IS NULL AND available_at<=now() AND provider=$1 ORDER BY available_at LIMIT 100`, s.provider.Name())
	if err != nil {
		return err
	}
	type pending struct{ provider, id string }
	events, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (pending, error) {
		var p pending
		err := row.Scan(&p.provider, &p.id)
		return p, err
	})
	if err != nil {
		return err
	}
	var failures []error
	for _, event := range events {
		if err := s.process(ctx, event.provider, event.id); err != nil {
			failures = append(failures, err)
		}
	}
	return errors.Join(failures...)
}
