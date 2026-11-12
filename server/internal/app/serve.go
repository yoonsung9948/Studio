package app

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"net"
	"net/http"
	"time"

	"github.com/riverqueue/river"
	"nori/studio/server/internal/accounts"
	"nori/studio/server/internal/assets"
	"nori/studio/server/internal/billing"
	"nori/studio/server/internal/characters"
	"nori/studio/server/internal/domain/project"
	"nori/studio/server/internal/engine"
	"nori/studio/server/internal/engine/ops/enhance"
	imageop "nori/studio/server/internal/engine/ops/image"
	"nori/studio/server/internal/engine/ops/interpret"
	"nori/studio/server/internal/engine/ops/video"
	"nori/studio/server/internal/httpapi"
	"nori/studio/server/internal/platform/blob"
	"nori/studio/server/internal/platform/queue"
	"nori/studio/server/internal/production"
	"nori/studio/server/internal/providers/fake"
	"nori/studio/server/internal/references"
	"nori/studio/server/internal/requests"
)

// Serve runs the HTTP API and the job workers until ctx is cancelled,
// then shuts both down gracefully.
func (a *App) Serve(ctx context.Context) error {
	files, err := blob.NewLocal(a.cfg.BlobDir)
	if err != nil {
		return err
	}
	videoModel, err := a.videoModel()
	if err != nil {
		return err
	}
	var paymentProvider billing.Provider
	if a.cfg.PaymentProvider == "fake" {
		if a.cfg.Environment != "development" && a.cfg.Environment != "test" {
			return errors.New("fake payments are disabled outside development and tests")
		}
		provider, err := billing.NewFake(a.cfg.FakePaymentSecret)
		if err != nil {
			return err
		}
		paymentProvider = provider
	}
	billingService := billing.NewService(a.pool, paymentProvider)
	assetService := assets.NewService(a.pool)
	mediaService := assets.NewMediaService(a.pool, files)
	imageModel, err := a.imageModel(files)
	if err != nil {
		return err
	}
	imageGeneration := imageop.NewGenerate(imageModel, files, assetService)
	generation := video.NewOperation(videoModel, files, fakeVideoPollEvery)
	registry, err := engine.NewRegistry(
		interpret.NewOperation(fake.Interpreter{}, fake.InterpreterProvider, fake.InterpreterModel),
		enhance.NewOperation(fake.Enhancer{}, fake.EnhancerProvider, fake.EnhancerModel),
		generation,
		imageGeneration,
		imageop.NewEdit(imageModel, files, assetService),
	)
	if err != nil {
		return err
	}
	workers := river.NewWorkers()
	river.AddWorker(workers, &engine.Worker{Pool: a.pool, Registry: registry, Publishers: []engine.ResultPublisher{characters.Publish, references.Publish, production.Publish}})
	jobQueue, err := queue.New(a.pool, workers, a.logger, a.cfg.Queues)
	if err != nil {
		return err
	}
	listener, err := net.Listen("tcp", a.cfg.HTTPAddr)
	if err != nil {
		return err
	}
	defer listener.Close()
	// Workers get their own context so shutdown can let running jobs finish before cancelling them.
	workerCtx, workerCancel := context.WithCancel(context.Background())
	defer workerCancel()
	jobs := engine.NewJobService(a.pool, jobQueue, registry)
	startup, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if err := jobs.Reconcile(startup); err != nil {
		return err
	}
	if err := jobQueue.Start(workerCtx); err != nil {
		return fmt.Errorf("start workers (run migrations first): %w", err)
	}
	var authenticate func(http.Handler) http.Handler
	if a.cfg.ClerkSecretKey != "" {
		authenticate = httpapi.ClerkAuthentication(a.cfg.ClerkSecretKey, a.cfg.ClerkIssuer, a.cfg.ClerkAuthorizedParties)
	}
	mediaKey := []byte(a.cfg.MediaSigningKey)
	if len(mediaKey) == 0 {
		mediaKey = make([]byte, 32)
		if _, err := rand.Read(mediaKey); err != nil {
			return err
		}
		a.logger.Warn("MEDIA_SIGNING_KEY is unset; download links will expire on restart")
	}
	downloads, err := httpapi.NewDownloadSigner(mediaKey)
	if err != nil {
		return err
	}
	server := &http.Server{
		Handler: httpapi.New(httpapi.Services{
			References:   references.NewService(a.pool, jobs),
			Production:   production.NewService(a.pool, jobs),
			Media:        mediaService,
			Billing:      billingService,
			Projects:     project.NewService(a.pool),
			Jobs:         jobs,
			Images:       jobs,
			Characters:   characters.NewService(a.pool, jobs, imageGeneration, files),
			Requests:     requests.NewService(a.pool, jobs),
			Files:        files,
			Assets:       assetService,
			Downloads:    downloads,
			Accounts:     accounts.NewService(a.pool),
			Authenticate: authenticate,
		}, a.logger, a.pool.Ping),
		ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 2 * time.Minute, WriteTimeout: 130 * time.Second, IdleTimeout: 60 * time.Second,
	}
	serveErr := make(chan error, 1)
	go func() { serveErr <- server.Serve(listener) }()
	a.logger.Info("server listening", "address", listener.Addr().String(), "adapter", fake.InterpreterProvider)
	reconcileDone := make(chan struct{})
	go func() {
		defer close(reconcileDone)
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-workerCtx.Done():
				return
			case <-ticker.C:
				checkCtx, cancel := context.WithTimeout(workerCtx, 5*time.Second)
				if err := mediaService.Cleanup(checkCtx); err != nil && workerCtx.Err() == nil {
					a.logger.Error("media cleanup failed", "error", err)
				}
				if err := jobs.Reconcile(checkCtx); err != nil && workerCtx.Err() == nil {
					a.logger.Error("reconcile jobs", "error", err)
				}
				cancel()
			}
		}
	}()
	paymentsDone := make(chan struct{})
	go func() {
		defer close(paymentsDone)
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-workerCtx.Done():
				return
			case <-ticker.C:
				ctx, cancel := context.WithTimeout(workerCtx, 10*time.Second)
				if err := billingService.Reconcile(ctx); err != nil {
					a.logger.Error("reconcile payments", "error", err)
				}
				cancel()
			}
		}
	}()
	var result error
	select {
	case <-ctx.Done():
	case err := <-serveErr:
		if !errors.Is(err, http.ErrServerClosed) {
			result = err
		}
	}
	shutdown, cancelShutdown := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancelShutdown()
	if err := server.Shutdown(shutdown); err != nil {
		result = errors.Join(result, err)
		_ = server.Close()
	}
	stopWorkers, cancelStopWorkers := context.WithTimeout(context.Background(), queue.WorkerStopTimeout)
	defer cancelStopWorkers()
	if err := jobQueue.Stop(stopWorkers); err != nil {
		workerCancel()
		_ = jobQueue.StopAndCancel(context.Background())
		result = errors.Join(result, err)
	}
	workerCancel()
	<-reconcileDone
	<-paymentsDone
	return result
}
