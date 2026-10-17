package app

import (
	"errors"
	"fmt"
	"os"
	"strconv"

	"nori/studio/server/internal/platform/queue"
)

type Config struct {
	DatabaseURL string
	HTTPAddr    string
	BlobDir     string // directory for stored media files
	Queues      queue.Limits
	// FakeVideoSample is an .mp4 the fake video model returns for every clip.
	// Optional; without it the fake returns placeholder bytes that do not play.
	FakeVideoSample string
}

// LoadConfig reads configuration from environment variables.
func LoadConfig() (Config, error) {
	cfg := Config{
		DatabaseURL:     os.Getenv("DATABASE_URL"),
		HTTPAddr:        os.Getenv("HTTP_ADDR"),
		BlobDir:         os.Getenv("BLOB_DIR"),
		Queues:          queue.DefaultLimits(),
		FakeVideoSample: os.Getenv("FAKE_VIDEO_SAMPLE"),
	}
	if cfg.DatabaseURL == "" {
		return Config{}, errors.New("DATABASE_URL is required")
	}
	if cfg.HTTPAddr == "" {
		cfg.HTTPAddr = "127.0.0.1:8080"
	}
	if cfg.BlobDir == "" {
		cfg.BlobDir = "data/blobs"
	}
	for env, limit := range map[string]*int{
		"QUEUE_LLM_WORKERS":    &cfg.Queues.LLM,
		"QUEUE_IMAGE_WORKERS":  &cfg.Queues.Image,
		"QUEUE_VIDEO_WORKERS":  &cfg.Queues.Video,
		"QUEUE_RENDER_WORKERS": &cfg.Queues.Render,
	} {
		raw := os.Getenv(env)
		if raw == "" {
			continue
		}
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			return Config{}, fmt.Errorf("%s must be a positive integer", env)
		}
		*limit = n
	}
	return cfg, nil
}
