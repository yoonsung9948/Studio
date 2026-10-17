package app

import (
	"fmt"
	"os"
	"time"

	"nori/studio/server/internal/providers"
	"nori/studio/server/internal/providers/fake"
)

// The fake video model finishes each clip after fakeVideoDelay, and the
// operation checks on it every fakeVideoPollEvery.
const (
	fakeVideoDelay     = 5 * time.Second
	fakeVideoPollEvery = time.Second
)

// videoModel returns the video provider. Only the fake exists for now; it
// returns the file at FAKE_VIDEO_SAMPLE, or placeholder bytes if none is set.
func (a *App) videoModel() (providers.VideoModel, error) {
	model := &fake.Video{Delay: fakeVideoDelay}
	if a.cfg.FakeVideoSample != "" {
		sample, err := os.ReadFile(a.cfg.FakeVideoSample)
		if err != nil {
			return nil, fmt.Errorf("read FAKE_VIDEO_SAMPLE: %w", err)
		}
		model.Sample = sample
	}
	return model, nil
}
