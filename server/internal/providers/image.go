package providers

import (
	"context"
	"io"
	"slices"

	imageinput "nori/studio/server/internal/domain/image"
)

type ImageCapabilities struct {
	Model         string
	AspectRatios  []string
	MaxReferences int
	Editing       bool
}

func (c ImageCapabilities) Supports(in imageinput.Input, edit bool) bool {
	return in.Model == c.Model && slices.Contains(c.AspectRatios, in.Settings.AspectRatio) && len(in.References) <= c.MaxReferences && (!edit || c.Editing)
}

// Readers are valid only during Generate or Edit. No browser URLs reach the provider.
type ImageReference struct {
	AssetID     string
	Role        string
	ContentType string
	Reader      io.Reader
}

type ImageRequest struct {
	IdempotencyKey string
	Input          imageinput.Input
	References     []ImageReference
	Source         *ImageReference
}

type ImageOutput struct {
	File        string `json:"file"`
	ContentType string `json:"contentType"`
}

// File is a durable handle saved before the download step. Implementations must
// reuse stored results and never blindly resubmit uncertain paid work.
type ImageModel interface {
	Name() (provider, model string)
	Capabilities() ImageCapabilities
	Generate(context.Context, ImageRequest) (ImageOutput, error)
	Edit(context.Context, ImageRequest) (ImageOutput, error)
	Download(context.Context, string) (io.ReadCloser, error)
}
