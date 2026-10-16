package main

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"nori/studio/server/internal/app"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(logger); err != nil {
		logger.Error("server stopped", "error", err)
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	migrate := len(os.Args) == 2 && os.Args[1] == "migrate"
	if len(os.Args) > 1 && !migrate {
		return errors.New("usage: studio [migrate]")
	}
	cfg, err := app.LoadConfig()
	if err != nil {
		return err
	}
	startup, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	a, err := app.New(startup, cfg, logger)
	if err != nil {
		return err
	}
	defer a.Close()
	if migrate {
		return a.Migrate(startup)
	}
	return a.Serve(ctx)
}
