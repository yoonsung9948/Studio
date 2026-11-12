package app

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"

	"nori/studio/server/internal/platform/queue"
	"nori/studio/server/internal/providers/openai"
)

type Config struct {
	ImageProvider          string
	OpenAIAPIKey           string
	OpenAIImageModel       string
	Environment            string
	PaymentProvider        string
	FakePaymentSecret      string
	MediaSigningKey        string
	ClerkSecretKey         string
	ClerkIssuer            string
	ClerkAuthorizedParties []string
	DatabaseURL            string
	HTTPAddr               string
	BlobDir                string // directory for stored media files
	Queues                 queue.Limits
	// FakeVideoSample is an .mp4 the fake video model returns for every clip.
	// Optional; defaults to the bundled playable demo clip.
	FakeVideoSample string
}

// LoadConfig reads configuration from environment variables.
func LoadConfig() (Config, error) {
	cfg := Config{
		ImageProvider:     os.Getenv("IMAGE_PROVIDER"),
		OpenAIAPIKey:      os.Getenv("OPENAI_API_KEY"),
		OpenAIImageModel:  os.Getenv("OPENAI_IMAGE_MODEL"),
		Environment:       os.Getenv("APP_ENV"),
		PaymentProvider:   os.Getenv("PAYMENT_PROVIDER"),
		FakePaymentSecret: os.Getenv("PAYMENT_FAKE_SECRET"),
		DatabaseURL:       os.Getenv("DATABASE_URL"),
		MediaSigningKey:   os.Getenv("MEDIA_SIGNING_KEY"),
		ClerkSecretKey:    os.Getenv("CLERK_SECRET_KEY"),
		ClerkIssuer:       os.Getenv("CLERK_ISSUER"),
		HTTPAddr:          os.Getenv("HTTP_ADDR"),
		BlobDir:           os.Getenv("BLOB_DIR"),
		Queues:            queue.DefaultLimits(),
		FakeVideoSample:   os.Getenv("FAKE_VIDEO_SAMPLE"),
	}
	if cfg.ImageProvider == "" {
		cfg.ImageProvider = "fake"
	}
	if cfg.OpenAIImageModel == "" {
		cfg.OpenAIImageModel = openai.DefaultImageModel
	}
	if cfg.ImageProvider != "fake" && cfg.ImageProvider != "openai" {
		return Config{}, errors.New("IMAGE_PROVIDER must be fake or openai")
	}
	if cfg.ImageProvider == "openai" && (strings.TrimSpace(cfg.OpenAIAPIKey) == "" || !openai.SupportedModel(cfg.OpenAIImageModel)) {
		return Config{}, errors.New("OpenAI images require OPENAI_API_KEY and a supported OPENAI_IMAGE_MODEL")
	}
	if cfg.Environment == "" {
		cfg.Environment = "production"
	}
	if cfg.PaymentProvider == "" {
		cfg.PaymentProvider = "disabled"
	}
	if cfg.Environment != "production" && cfg.Environment != "development" && cfg.Environment != "test" {
		return Config{}, errors.New("APP_ENV must be production, development, or test")
	}
	if cfg.PaymentProvider != "disabled" && cfg.PaymentProvider != "fake" {
		return Config{}, errors.New("PAYMENT_PROVIDER must be disabled or fake")
	}
	if cfg.PaymentProvider == "fake" && (cfg.Environment == "production" || len(cfg.FakePaymentSecret) < 32) {
		return Config{}, errors.New("fake payments require APP_ENV=development or test and PAYMENT_FAKE_SECRET of at least 32 bytes")
	}
	if raw := os.Getenv("CLERK_AUTHORIZED_PARTIES"); raw != "" {
		for _, party := range strings.Split(raw, ",") {
			cfg.ClerkAuthorizedParties = append(cfg.ClerkAuthorizedParties, strings.TrimSpace(party))
		}
	}
	if cfg.ClerkSecretKey != "" || cfg.ClerkIssuer != "" || len(cfg.ClerkAuthorizedParties) > 0 {
		if cfg.ClerkSecretKey == "" || cfg.ClerkIssuer == "" || len(cfg.ClerkAuthorizedParties) == 0 {
			return Config{}, errors.New("CLERK_SECRET_KEY, CLERK_ISSUER, and CLERK_AUTHORIZED_PARTIES must be configured together")
		}
		issuer, err := url.Parse(cfg.ClerkIssuer)
		if err != nil || issuer.Scheme != "https" || issuer.Host == "" || issuer.User != nil || issuer.RawQuery != "" || issuer.Fragment != "" || issuer.Path != "" {
			return Config{}, errors.New("CLERK_ISSUER must be an HTTPS origin without a trailing slash")
		}
		for _, party := range cfg.ClerkAuthorizedParties {
			origin, err := url.Parse(party)
			if err != nil || origin.Host == "" || origin.User != nil || origin.RawQuery != "" || origin.Fragment != "" || origin.Path != "" || (origin.Scheme != "https" && !(origin.Scheme == "http" && (origin.Hostname() == "localhost" || origin.Hostname() == "127.0.0.1"))) {
				return Config{}, errors.New("CLERK_AUTHORIZED_PARTIES must contain frontend origins (HTTPS or loopback HTTP)")
			}
		}
	}
	if cfg.MediaSigningKey != "" && len(cfg.MediaSigningKey) < 32 {
		return Config{}, errors.New("MEDIA_SIGNING_KEY must contain at least 32 bytes")
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
