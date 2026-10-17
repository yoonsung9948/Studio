package queue

import (
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
)

// Client is the River client used to insert and run jobs.
type Client = river.Client[pgx.Tx]

// Queues are split by what limits the work, not by operation.
const (
	LLM    = "llm"    // text model calls: rate-limited API, fast
	Image  = "image"  // image generation: provider concurrency
	Video  = "video"  // video generation: provider concurrency and cost
	Render = "render" // local media processing (FFmpeg): CPU
)

// Names lists every queue the workers serve.
var Names = []string{LLM, Image, Video, Render}

// Limits is the maximum number of jobs each queue runs at once in one process.
// With several worker processes, the provider sees the sum across processes.
type Limits struct {
	LLM, Image, Video, Render int
}

func DefaultLimits() Limits {
	return Limits{LLM: 10, Image: 4, Video: 3, Render: 2}
}

// Configs returns River's queue configuration for these limits.
func (l Limits) Configs() (map[string]river.QueueConfig, error) {
	queues := map[string]river.QueueConfig{}
	for name, n := range map[string]int{LLM: l.LLM, Image: l.Image, Video: l.Video, Render: l.Render} {
		if n < 1 {
			return nil, fmt.Errorf("queue %q needs at least 1 worker, got %d", name, n)
		}
		queues[name] = river.QueueConfig{MaxWorkers: n}
	}
	return queues, nil
}

// Valid reports whether name is one of the queues the workers serve.
func Valid(name string) bool {
	for _, n := range Names {
		if n == name {
			return true
		}
	}
	return false
}

// RescueAfter is how long a job may run before River treats it as stuck and
// retries it. Every single step must finish well within it.
const RescueAfter = 2 * time.Minute

// New creates a River client that runs every queue with the given limits.
func New(pool *pgxpool.Pool, workers *river.Workers, logger *slog.Logger, limits Limits) (*Client, error) {
	queues, err := limits.Configs()
	if err != nil {
		return nil, err
	}
	return river.NewClient(riverpgxv5.New(pool), &river.Config{
		Workers: workers, Queues: queues,
		Logger: logger, JobTimeout: 30 * time.Second, RescueStuckJobsAfter: RescueAfter, SoftStopTimeout: 10 * time.Second,
	})
}
