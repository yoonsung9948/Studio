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
	Queues      queue.Limits
}

// LoadConfig reads configuration from environment variables.
func LoadConfig() (Config, error) {
	cfg := Config{
		DatabaseURL: os.Getenv("DATABASE_URL"),
		HTTPAddr:    os.Getenv("HTTP_ADDR"),
		Queues:      queue.DefaultLimits(),
	}
	if cfg.DatabaseURL == "" {
		return Config{}, errors.New("DATABASE_URL is required")
	}
	if cfg.HTTPAddr == "" {
		cfg.HTTPAddr = "127.0.0.1:8080"
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
