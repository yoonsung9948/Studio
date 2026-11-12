package app

import (
	_ "embed"
	"fmt"
	"os"
	"time"

	"nori/studio/server/internal/platform/blob"
	"nori/studio/server/internal/providers"
	"nori/studio/server/internal/providers/fake"
	"nori/studio/server/internal/providers/openai"
)

// The fake video model finishes each clip after fakeVideoDelay, and the
// operation checks on it every fakeVideoPollEvery.
const (
	fakeVideoDelay     = 5 * time.Second
	fakeVideoPollEvery = time.Second
)

//go:embed testdata/fake-video.mp4
var defaultVideoSample []byte

// videoModel returns the video provider. Only the fake exists for now; it
// returns FAKE_VIDEO_SAMPLE when set, otherwise the bundled demo clip.
func (a *App) videoModel() (providers.VideoModel, error) {
	model := &fake.Video{Delay: fakeVideoDelay, Sample: defaultVideoSample}
	if a.cfg.FakeVideoSample != "" {
		sample, err := os.ReadFile(a.cfg.FakeVideoSample)
		if err != nil {
			return nil, fmt.Errorf("read FAKE_VIDEO_SAMPLE: %w", err)
		}
		model.Sample = sample
	}
	return model, nil
}

func (a *App) imageModel(files blob.Store) (providers.ImageModel, error) {
	switch a.cfg.ImageProvider {
	case "", "fake":
		return fake.Image{}, nil
	case "openai":
		return openai.NewImage(a.cfg.OpenAIAPIKey, a.cfg.OpenAIImageModel, files, a.pool)
	default:
		return nil, fmt.Errorf("unsupported image provider")
	}
}
