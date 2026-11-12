//go:build integration

package engine_test

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"nori/studio/server/internal/accounts"
	"nori/studio/server/internal/billing"
	"nori/studio/server/internal/characters"
	"nori/studio/server/internal/engine"
	imageop "nori/studio/server/internal/engine/ops/image"
	"nori/studio/server/internal/httpapi"
	"nori/studio/server/internal/platform/apperr"
	"nori/studio/server/internal/providers"
	"nori/studio/server/internal/providers/fake"
)

func paymentFixture(t *testing.T) (*fixture, *billing.Service) {
	t.Helper()
	f, _, _, _ := characterFixture(t)
	if _, err := f.pool.Exec(context.Background(), `UPDATE credit_wallets SET available=0 WHERE owner_user_id=$1`, f.owner); err != nil {
		t.Fatal(err)
	}
	provider, err := billing.NewFake(strings.Repeat("k", 32))
	if err != nil {
		t.Fatal(err)
	}
	return f, billing.NewService(f.pool, provider)
}
func buyCredits(t *testing.T, s *billing.Service, owner, key string) billing.Purchase {
	t.Helper()
	p, err := s.Checkout(context.Background(), owner, key, "small")
	if err != nil {
		t.Fatal(err)
	}
	p, err = s.Simulate(context.Background(), owner, p.ID, "paid")
	if err != nil {
		t.Fatal(err)
	}
	return p
}
func walletIs(t *testing.T, s *billing.Service, owner string, available, reserved int64) {
	t.Helper()
	w, err := s.Wallet(context.Background(), owner)
	if err != nil || w.Available != available || w.Reserved != reserved {
		t.Fatalf("wallet=%+v expected %d/%d err=%v", w, available, reserved, err)
	}
}
func TestFakeCheckoutCreditsExactlyOnce(t *testing.T) {
	ctx := context.Background()
	f, s := paymentFixture(t)
	p, err := s.Checkout(ctx, f.owner, "checkout", "small")
	if err != nil {
		t.Fatal(err)
	}
	replay, err := s.Checkout(ctx, f.owner, "checkout", "small")
	if err != nil || replay.ID != p.ID {
		t.Fatal("duplicate purchase")
	}
	walletIs(t, s, f.owner, 0, 0)
	if _, err := s.Checkout(ctx, f.owner, "checkout", "large"); err == nil {
		t.Fatal("checkout key changed pack")
	}
	for range 2 {
		if _, err := s.Simulate(ctx, f.owner, p.ID, "paid"); err != nil {
			t.Fatal(err)
		}
	}
	walletIs(t, s, f.owner, 250, 0)
	if _, err := s.Simulate(ctx, f.owner, p.ID, "failed"); err != nil {
		t.Fatal(err)
	}
	walletIs(t, s, f.owner, 250, 0)
	for range 2 {
		if _, err := s.Simulate(ctx, f.owner, p.ID, "refunded"); err != nil {
			t.Fatal(err)
		}
	}
	walletIs(t, s, f.owner, 0, 0)
	if _, err := s.Simulate(ctx, f.owner, p.ID, "paid"); err != nil {
		t.Fatal(err)
	}
	walletIs(t, s, f.owner, 0, 0)
	entries, err := s.Entries(ctx, f.owner, billing.ListParams{})
	if err != nil || len(entries.Items) != 2 {
		t.Fatalf("%+v %v", entries, err)
	}
	if _, err := f.pool.Exec(ctx, `DELETE FROM credit_entries WHERE owner_user_id=$1`, f.owner); err == nil {
		t.Fatal("ledger allowed deletion")
	}
	bob := secondOwner(t, f)
	if _, err := s.Purchase(ctx, bob, p.ID); !errors.Is(err, apperr.ErrNotFound) {
		t.Fatal("foreign purchase visible")
	}
	if _, err := s.Simulate(ctx, bob, p.ID, "paid"); !errors.Is(err, apperr.ErrNotFound) {
		t.Fatal("foreign simulation allowed")
	}
	page, err := s.Purchases(ctx, f.owner, billing.ListParams{Limit: 1})
	if err != nil || len(page.Items) != 1 {
		t.Fatal(err)
	}
}
func TestDelayedPaymentSurvivesRestart(t *testing.T) {
	ctx := context.Background()
	f, s := paymentFixture(t)
	p, err := s.Checkout(ctx, f.owner, "delayed", "small")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Simulate(ctx, f.owner, p.ID, "delayed"); err != nil {
		t.Fatal(err)
	}
	walletIs(t, s, f.owner, 0, 0)
	if _, err := f.pool.Exec(ctx, `UPDATE payment_events SET available_at=now() WHERE payload->>'purchaseId'=$1`, p.ID); err != nil {
		t.Fatal(err)
	}
	provider, err := billing.NewFake(strings.Repeat("k", 32))
	if err != nil {
		t.Fatal(err)
	}
	restored := billing.NewService(f.pool, provider)
	for range 2 {
		if err := restored.Reconcile(ctx); err != nil {
			t.Fatal(err)
		}
	}
	walletIs(t, restored, f.owner, 250, 0)
}
func TestGenerationReservesAndCapturesCredits(t *testing.T) {
	ctx := context.Background()
	f, s := paymentFixture(t)
	in := engine.Submission{Operation: imageop.GenerateName, Input: []byte(`{"prompt":"A cafe"}`)}
	if _, err := f.service.Submit(ctx, f.owner, "unfunded", in); !errors.Is(err, billing.ErrInsufficientCredits) {
		t.Fatal(err)
	}
	var queued int
	if err := f.pool.QueryRow(ctx, `SELECT count(*) FROM river_job`).Scan(&queued); err != nil || queued != 0 {
		t.Fatal("unfunded job queued")
	}
	buyCredits(t, s, f.owner, "fund")
	job, err := f.service.Submit(ctx, f.owner, "image", in)
	if err != nil {
		t.Fatal(err)
	}
	walletIs(t, s, f.owner, 242, 8)
	replay, err := f.service.Submit(ctx, f.owner, "image", in)
	if err != nil || replay.ID != job.ID {
		t.Fatal(err)
	}
	walletIs(t, s, f.owner, 242, 8)
	f.start(t)
	done := await(t, f, job.ID, "succeeded")
	if len(done.Results) != 1 || done.Results[0].AssetID == nil {
		t.Fatal("charged without an asset")
	}
	walletIs(t, s, f.owner, 242, 0)
	entries, err := s.Entries(ctx, f.owner, billing.ListParams{})
	if err != nil || len(entries.Items) != 3 {
		t.Fatalf("%+v %v", entries, err)
	}
}
func TestConcurrentGenerationsCannotOverspend(t *testing.T) {
	ctx := context.Background()
	f, s := paymentFixture(t)
	if _, err := f.pool.Exec(ctx, `UPDATE credit_wallets SET available=8 WHERE owner_user_id=$1`, f.owner); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, key := range []string{"one", "two"} {
		wg.Add(1)
		go func(key string) {
			defer wg.Done()
			_, err := f.service.Submit(ctx, f.owner, key, engine.Submission{Operation: imageop.GenerateName, Input: []byte(`{"prompt":"A cafe"}`)})
			results <- err
		}(key)
	}
	wg.Wait()
	a, b := <-results, <-results
	if !((a == nil && errors.Is(b, billing.ErrInsufficientCredits)) || (b == nil && errors.Is(a, billing.ErrInsufficientCredits))) {
		t.Fatalf("%v %v", a, b)
	}
	walletIs(t, s, f.owner, 0, 8)
}
func TestFailedJobsReleaseReservationsOnce(t *testing.T) {
	ctx := context.Background()
	f, s := paymentFixture(t)
	buyCredits(t, s, f.owner, "fund")
	job, err := f.service.Submit(ctx, f.owner, "stopped", engine.Submission{Operation: imageop.GenerateName, Input: []byte(`{"prompt":"A cafe"}`)})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(ctx, `UPDATE river_job SET state='discarded',finalized_at=now() WHERE id=(SELECT river_job_id FROM jobs WHERE id=$1 AND owner_user_id=$2)`, job.ID, f.owner); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := f.service.Reconcile(ctx); err != nil {
			t.Fatal(err)
		}
	}
	walletIs(t, s, f.owner, 250, 0)
}
func TestCharacterBatchCreditReservationIsAtomic(t *testing.T) {
	ctx := context.Background()
	f, s := paymentFixture(t)
	if _, err := f.pool.Exec(ctx, `UPDATE credit_wallets SET available=8 WHERE owner_user_id=$1`, f.owner); err != nil {
		t.Fatal(err)
	}
	op := imageop.NewGenerate(fake.Image{}, nil, nil)
	charactersService := characters.NewService(f.pool, f.service, op, nil)
	c, err := charactersService.Create(ctx, f.owner, characters.CreateInput{Name: "Nori", Appearance: "Short hair"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := charactersService.Generate(ctx, f.owner, c.ID, "batch", characters.GenerateInput{Count: 2}); !errors.Is(err, billing.ErrInsufficientCredits) {
		t.Fatal(err)
	}
	walletIs(t, s, f.owner, 8, 0)
	for _, table := range []string{"jobs", "character_generation_batches", "credit_reservations"} {
		var count int
		if err := f.pool.QueryRow(ctx, "SELECT count(*) FROM "+table).Scan(&count); err != nil || count != 0 {
			t.Fatalf("partial batch in %s", table)
		}
	}
}
func TestRefundWithReservedCreditsCannotCreateSpendableBalance(t *testing.T) {
	ctx := context.Background()
	f, s := paymentFixture(t)
	p := buyCredits(t, s, f.owner, "fund")
	job, err := f.service.Submit(ctx, f.owner, "image", engine.Submission{Operation: imageop.GenerateName, Input: []byte(`{"prompt":"A cafe"}`)})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Simulate(ctx, f.owner, p.ID, "refunded"); err != nil {
		t.Fatal(err)
	}
	walletIs(t, s, f.owner, -8, 8)
	f.start(t)
	await(t, f, job.ID, "succeeded")
	walletIs(t, s, f.owner, -8, 0)
	if _, err := f.service.Submit(ctx, f.owner, "another", engine.Submission{Operation: imageop.GenerateName, Input: []byte(`{"prompt":"A cafe"}`)}); !errors.Is(err, billing.ErrInsufficientCredits) {
		t.Fatal("refund debt could spend")
	}
}

func TestBillingHTTPRejectsClientPricesAndOwners(t *testing.T) {
	f, s := paymentFixture(t)
	api := httpapi.New(httpapi.Services{Billing: s, Accounts: accounts.NewService(f.pool), Authenticate: fixtureAuthentication}, slog.New(slog.NewTextHandler(io.Discard, nil)), f.pool.Ping)
	for _, body := range []string{`{"packId":"small","credits":999999}`, `{"packId":"small","amountMinor":1}`, `{"packId":"small","ownerUserId":"other"}`, `null`} {
		req := httptest.NewRequest("POST", "/api/v1/billing/checkouts", strings.NewReader(body))
		req.Header.Set("Idempotency-Key", "tampered")
		response := httptest.NewRecorder()
		api.ServeHTTP(response, req)
		if response.Code != 400 {
			t.Fatalf("accepted untrusted checkout: %d %s", response.Code, response.Body)
		}
	}
	req := httptest.NewRequest("POST", "/api/v1/billing/checkouts", strings.NewReader(`{"packId":"small"}`))
	req.Header.Set("Idempotency-Key", "valid")
	response := httptest.NewRecorder()
	api.ServeHTTP(response, req)
	if response.Code != 201 {
		t.Fatalf("checkout: %d %s", response.Code, response.Body)
	}
	walletIs(t, s, f.owner, 0, 0)
}

type rejectedCreditImage struct{ fake.Image }

func (rejectedCreditImage) Generate(context.Context, providers.ImageRequest) (providers.ImageOutput, error) {
	return providers.ImageOutput{}, providers.ErrRejected
}
func TestTerminalGenerationFailureReleasesCredits(t *testing.T) {
	ctx := context.Background()
	op := imageop.NewGenerate(rejectedCreditImage{}, nil, nil)
	f := setup(t, fake.Interpreter{}, op)
	s := billing.NewService(f.pool, nil)
	job, err := f.service.Submit(ctx, f.owner, "reject", engine.Submission{Operation: imageop.GenerateName, Input: []byte(`{"prompt":"A cafe"}`)})
	if err != nil {
		t.Fatal(err)
	}
	walletIs(t, s, f.owner, 999992, 8)
	f.start(t)
	await(t, f, job.ID, "failed")
	walletIs(t, s, f.owner, 1000000, 0)
}
func TestCreditCaptureFailureRollsBackPublishedResults(t *testing.T) {
	ctx := context.Background()
	f, s := paymentFixture(t)
	buyCredits(t, s, f.owner, "fund")
	_, err := f.pool.Exec(ctx, `CREATE FUNCTION fail_capture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='capture' THEN RAISE EXCEPTION 'test capture failure'; END IF; RETURN NEW; END $$;
 CREATE TRIGGER fail_capture BEFORE INSERT ON credit_entries FOR EACH ROW EXECUTE FUNCTION fail_capture()`)
	if err != nil {
		t.Fatal(err)
	}
	job, err := f.service.Submit(ctx, f.owner, "image", engine.Submission{Operation: imageop.GenerateName, Input: []byte(`{"prompt":"A cafe"}`)})
	if err != nil {
		t.Fatal(err)
	}
	f.start(t)
	deadline := time.Now().Add(5 * time.Second)
	failed := false
	var riverID int64
	for time.Now().Before(deadline) {
		var state string
		if err := f.pool.QueryRow(ctx, `SELECT r.id,r.state::text FROM river_job r JOIN jobs j ON j.river_job_id=r.id WHERE j.id=$1 AND j.owner_user_id=$2`, job.ID, f.owner).Scan(&riverID, &state); err != nil {
			t.Fatal(err)
		}
		if state == "retryable" {
			failed = true
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !failed {
		t.Fatal("did not observe capture failure")
	}
	walletIs(t, s, f.owner, 242, 8)
	detail, err := f.service.Get(ctx, f.owner, job.ID)
	if err != nil || detail.Status == "succeeded" || len(detail.Results) != 0 {
		t.Fatal("published without capture")
	}
	var count int
	if err := f.pool.QueryRow(ctx, `SELECT count(*) FROM assets WHERE producer_job_id=$1 AND owner_user_id=$2`, job.ID, f.owner).Scan(&count); err != nil || count != 0 {
		t.Fatal("partial assets survived failed capture")
	}
	if _, err := f.pool.Exec(ctx, `DROP TRIGGER fail_capture ON credit_entries`); err != nil {
		t.Fatal(err)
	}
	if _, err := f.queue.JobRetry(ctx, riverID); err != nil {
		t.Fatal(err)
	}
	await(t, f, job.ID, "succeeded")
	walletIs(t, s, f.owner, 242, 0)
}
