package app

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"time"

	"github.com/riverqueue/river"
	"nori/studio/server/internal/domain/project"
	"nori/studio/server/internal/engine"
	"nori/studio/server/internal/engine/ops/brief"
	"nori/studio/server/internal/engine/ops/video"
	"nori/studio/server/internal/httpapi"
	"nori/studio/server/internal/platform/blob"
	"nori/studio/server/internal/platform/queue"
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
	registry, err := engine.NewRegistry(
		brief.NewOperation(brief.Fake{}, brief.FakeProvider, brief.FakeModel),
		video.NewOperation(videoModel, files, fakeVideoPollEvery),
	)
	if err != nil {
		return err
	}
	workers := river.NewWorkers()
	river.AddWorker(workers, &engine.Worker{Pool: a.pool, Registry: registry})
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
	server := &http.Server{
		Handler: httpapi.New(httpapi.Services{
			Projects: project.NewService(a.pool),
			Jobs:     jobs,
			Files:    files,
		}, a.logger, a.pool.Ping),
		ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second,
	}
	serveErr := make(chan error, 1)
	go func() { serveErr <- server.Serve(listener) }()
	a.logger.Info("server listening", "address", listener.Addr().String(), "adapter", brief.FakeProvider)
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
				if err := jobs.Reconcile(checkCtx); err != nil && workerCtx.Err() == nil {
					a.logger.Error("reconcile jobs", "error", err)
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
	if err := jobQueue.Stop(shutdown); err != nil {
		workerCancel()
		_ = jobQueue.StopAndCancel(context.Background())
		result = errors.Join(result, err)
	}
	workerCancel()
	<-reconcileDone
	return result
}
