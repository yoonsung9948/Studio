package billing

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"nori/studio/server/internal/platform/apperr"
)

type Wallet struct {
	Available int64 `json:"available"`
	Reserved  int64 `json:"reserved"`
}

type Entry struct {
	ID             string    `json:"id"`
	Kind           string    `json:"kind"`
	Reference      string    `json:"reference"`
	AvailableDelta int64     `json:"availableDelta"`
	ReservedDelta  int64     `json:"reservedDelta"`
	AvailableAfter int64     `json:"availableAfter"`
	ReservedAfter  int64     `json:"reservedAfter"`
	CreatedAt      time.Time `json:"createdAt"`
}

var ErrInsufficientCredits = &apperr.ConflictError{Code: "insufficient_credits", Message: "Not enough credits. Recharge before generating."}

// Prices are per result. LLM interpretation/enhancement remain free in this release.
func Price(operation string, _ json.RawMessage) int64 {
	switch operation {
	case "generate_image", "edit_image":
		return 8
	case "generate_video":
		return 24
	default:
		return 0
	}
}

func WalletTx(ctx context.Context, tx pgx.Tx, owner string) (Wallet, error) {
	if _, err := tx.Exec(ctx, `INSERT INTO credit_wallets(owner_user_id) VALUES($1) ON CONFLICT DO NOTHING`, owner); err != nil {
		return Wallet{}, err
	}
	var wallet Wallet
	err := tx.QueryRow(ctx, `SELECT available,reserved FROM credit_wallets WHERE owner_user_id=$1 FOR UPDATE`, owner).Scan(&wallet.Available, &wallet.Reserved)
	return wallet, err
}

func change(ctx context.Context, tx pgx.Tx, owner, reference, kind string, available, reserved int64) error {
	wallet, err := WalletTx(ctx, tx, owner)
	if err != nil {
		return err
	}
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM credit_entries WHERE owner_user_id=$1 AND reference=$2)`, owner, reference).Scan(&exists); err != nil {
		return err
	}
	if exists {
		return nil
	}
	wallet.Available += available
	wallet.Reserved += reserved
	if wallet.Reserved < 0 {
		return errors.New("credit reservation invariant violated")
	}
	if _, err := tx.Exec(ctx, `UPDATE credit_wallets SET available=$2,reserved=$3,updated_at=now() WHERE owner_user_id=$1`, owner, wallet.Available, wallet.Reserved); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO credit_entries(id,owner_user_id,reference,kind,available_delta,reserved_delta,available_after,reserved_after) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, uuid.NewString(), owner, reference, kind, available, reserved, wallet.Available, wallet.Reserved)
	return err
}

func Reserve(ctx context.Context, tx pgx.Tx, owner, jobID, operation string, input json.RawMessage) error {
	price := Price(operation, input)
	if price == 0 {
		return nil
	}
	wallet, err := WalletTx(ctx, tx, owner)
	if err != nil {
		return err
	}
	if wallet.Available < price {
		return ErrInsufficientCredits
	}
	if _, err := tx.Exec(ctx, `INSERT INTO credit_reservations(job_id,owner_user_id,credits,operation,pricing_version) VALUES($1,$2,$3,$4,1)`, jobID, owner, price, operation); err != nil {
		return err
	}
	return change(ctx, tx, owner, "job:"+jobID+":reserve", "reserve", -price, price)
}

func settle(ctx context.Context, tx pgx.Tx, owner, jobID string, capture bool) error {
	var amount int64
	var state string
	err := tx.QueryRow(ctx, `SELECT credits,state FROM credit_reservations WHERE job_id=$1 AND owner_user_id=$2 FOR UPDATE`, jobID, owner).Scan(&amount, &state)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if state != "reserved" {
		return nil
	}
	target, kind, available := "released", "release", amount
	if capture {
		target, kind, available = "captured", "capture", 0
	}
	if err := change(ctx, tx, owner, "job:"+jobID+":"+kind, kind, available, -amount); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE credit_reservations SET state=$3,updated_at=now() WHERE job_id=$1 AND owner_user_id=$2`, jobID, owner, target)
	return err
}

func Capture(ctx context.Context, tx pgx.Tx, owner, jobID string) error {
	return settle(ctx, tx, owner, jobID, true)
}

func Release(ctx context.Context, tx pgx.Tx, owner, jobID string) error {
	return settle(ctx, tx, owner, jobID, false)
}

func validateKey(key string) error {
	if key == "" || len(key) > 200 || strings.TrimSpace(key) != key {
		return &apperr.ValidationError{Message: "Idempotency-Key must contain 1-200 bytes without surrounding whitespace"}
	}
	return nil
}
