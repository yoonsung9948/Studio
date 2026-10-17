// Package providers defines what the engine needs from external AI services.
// Each provider (MiniMax, a fake for development, ...) implements these
// interfaces in its own package.
package providers

import (
	"context"
	"io"
)

// VideoRequest asks a video model for one clip.
type VideoRequest struct {
	Prompt          string
	DurationSeconds int
	Resolution      string // e.g. "768P", "2K"
}

type VideoStatus string

const (
	VideoPending   VideoStatus = "pending"
	VideoSucceeded VideoStatus = "succeeded"
	VideoFailed    VideoStatus = "failed"
)

// VideoTask is the state of a submitted generation.
type VideoTask struct {
	Status VideoStatus
	File   string // provider's reference to the finished file, set when succeeded
	Error  string // provider's reason, set when failed
}

// VideoModel generates video asynchronously: submit a task, check it until it
// finishes, then download the file. Errors should be ErrRejected,
// ErrUnauthorized or *RateLimitedError where those apply; anything else is
// treated as a temporary failure.
type VideoModel interface {
	Name() (provider, model string)
	Submit(ctx context.Context, req VideoRequest) (taskID string, err error)
	Check(ctx context.Context, taskID string) (VideoTask, error)
	Download(ctx context.Context, file string) (io.ReadCloser, error)
}
