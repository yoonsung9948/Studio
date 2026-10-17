// Package fake provides stand-ins for paid AI providers, for development and
// tests. They cost nothing and need no API key.
package fake

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"

	"nori/studio/server/internal/providers"
)

// Placeholder is returned when no sample file is configured. It is not a
// playable video; it only lets the job flow be exercised end to end.
var Placeholder = []byte("fake video: set FAKE_VIDEO_SAMPLE to a real .mp4 to get playable output\n")

// Video pretends to be an asynchronous video model. A task finishes Delay
// after it was submitted. The task ID records the submission time, so tasks
// survive server restarts just as a real provider's would.
type Video struct {
	Delay  time.Duration
	Sample []byte           // content of every "generated" file; Placeholder if empty
	Now    func() time.Time // for tests; time.Now if nil
}

const taskPrefix = "fake-"

func (v *Video) Name() (string, string) { return "fake_minimax", "fake-h3" }

func (v *Video) now() time.Time {
	if v.Now != nil {
		return v.Now()
	}
	return time.Now()
}

func (v *Video) Submit(ctx context.Context, req providers.VideoRequest) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if strings.TrimSpace(req.Prompt) == "" {
		return "", fmt.Errorf("%w: empty prompt", providers.ErrRejected)
	}
	return taskPrefix + strconv.FormatInt(v.now().UnixNano(), 10), nil
}

func (v *Video) Check(ctx context.Context, taskID string) (providers.VideoTask, error) {
	if err := ctx.Err(); err != nil {
		return providers.VideoTask{}, err
	}
	submitted, err := strconv.ParseInt(strings.TrimPrefix(taskID, taskPrefix), 10, 64)
	if !strings.HasPrefix(taskID, taskPrefix) || err != nil {
		return providers.VideoTask{Status: providers.VideoFailed, Error: "unknown task"}, nil
	}
	if v.now().Sub(time.Unix(0, submitted)) < v.Delay {
		return providers.VideoTask{Status: providers.VideoPending}, nil
	}
	return providers.VideoTask{Status: providers.VideoSucceeded, File: taskID}, nil
}

func (v *Video) Download(ctx context.Context, _ string) (io.ReadCloser, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	sample := v.Sample
	if len(sample) == 0 {
		sample = Placeholder
	}
	return io.NopCloser(bytes.NewReader(sample)), nil
}
