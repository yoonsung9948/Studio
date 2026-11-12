//go:build integration

package engine_test

import (
	"context"
	"errors"
	"sync"
	"testing"

	"nori/studio/server/internal/accounts"
	"nori/studio/server/internal/providers/fake"
)

func TestAccountsConcurrentResolutionAndStatus(t *testing.T) {
	f := setup(t, fake.Interpreter{})
	ctx := context.Background()
	service := accounts.NewService(f.pool)
	identity := accounts.Identity{Issuer: "https://studio.example", Subject: "user_one", DisplayName: "Initial name"}
	const n = 12
	results := make([]accounts.User, n)
	errs := make([]error, n)
	var wg sync.WaitGroup
	for i := range n {
		wg.Add(1)
		go func() { defer wg.Done(); results[i], errs[i] = service.Resolve(ctx, identity) }()
	}
	wg.Wait()
	for i := range n {
		if errs[i] != nil {
			t.Fatal(errs[i])
		}
		if results[i].ID != results[0].ID {
			t.Fatal("concurrent first requests created duplicate users")
		}
	}
	var count int
	if err := f.pool.QueryRow(ctx, `SELECT count(*) FROM users`).Scan(&count); err != nil || count != 2 {
		t.Fatalf("count=%d error=%v", count, err)
	}
	if err := f.pool.QueryRow(ctx, `SELECT count(*) FROM auth_identities`).Scan(&count); err != nil || count != 2 {
		t.Fatalf("count=%d error=%v", count, err)
	}
	identity.DisplayName = "Changed upstream"
	replay, err := service.Resolve(ctx, identity)
	if err != nil || replay.DisplayName != "Initial name" {
		t.Fatalf("profile overwritten: %+v %v", replay, err)
	}
	// Identical subjects from another issuer identify a different account.
	other, err := service.Resolve(ctx, accounts.Identity{Issuer: "https://other.example", Subject: identity.Subject})
	if err != nil || other.ID == replay.ID {
		t.Fatalf("identities conflated: %+v %v", other, err)
	}
	if _, err := f.pool.Exec(ctx, `UPDATE users SET status='disabled',updated_at=now() WHERE id=$1`, replay.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Resolve(ctx, identity); !errors.Is(err, accounts.ErrDisabled) {
		t.Fatalf("disabled account error=%v", err)
	}
	for _, invalid := range []accounts.Identity{{Subject: "x"}, {Issuer: "x"}, {Issuer: " ", Subject: "x"}} {
		if _, err := service.Resolve(ctx, invalid); err == nil {
			t.Fatal("empty identity accepted")
		}
	}
}

func TestAccountCreationRollsBackOnIdentityFailure(t *testing.T) {
	f := setup(t, fake.Interpreter{})
	ctx := context.Background()
	_, err := f.pool.Exec(ctx, `CREATE FUNCTION reject_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'identity insert failed'; END $$;
        CREATE TRIGGER reject_identity BEFORE INSERT ON auth_identities FOR EACH ROW EXECUTE FUNCTION reject_identity();`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = accounts.NewService(f.pool).Resolve(ctx, accounts.Identity{Issuer: "https://studio.example", Subject: "user_one"})
	if err == nil {
		t.Fatal("expected identity insert failure")
	}
	var count int
	if err := f.pool.QueryRow(ctx, `SELECT count(*) FROM users`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("orphaned user count=%d error=%v", count, err)
	}
}
