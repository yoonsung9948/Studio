package fake

import (
	"bytes"
	"context"
	"embed"
	"fmt"
	"io"
	"strings"

	"nori/studio/server/internal/providers"
)

const ImageModelName = "fake-image-v1"

//go:embed testdata/image-*.png
var imageSamples embed.FS

type Image struct{}

func (Image) Name() (string, string) { return "fake", ImageModelName }
func (Image) Capabilities() providers.ImageCapabilities {
	return providers.ImageCapabilities{Model: ImageModelName, AspectRatios: []string{"1:1", "16:9", "9:16"}, MaxReferences: 8, Editing: true}
}
func (m Image) Generate(ctx context.Context, req providers.ImageRequest) (providers.ImageOutput, error) {
	return m.result(ctx, req, false)
}
func (m Image) Edit(ctx context.Context, req providers.ImageRequest) (providers.ImageOutput, error) {
	return m.result(ctx, req, true)
}
func (m Image) result(ctx context.Context, req providers.ImageRequest, edit bool) (providers.ImageOutput, error) {
	if err := ctx.Err(); err != nil {
		return providers.ImageOutput{}, err
	}
	if !m.Capabilities().Supports(req.Input, edit) || req.IdempotencyKey == "" || (edit && req.Source == nil) {
		return providers.ImageOutput{}, providers.ErrRejected
	}
	refs := append([]providers.ImageReference{}, req.References...)
	if req.Source != nil {
		refs = append(refs, *req.Source)
	}
	for _, ref := range refs {
		if ref.Reader == nil {
			return providers.ImageOutput{}, providers.ErrRejected
		}
		if _, err := io.Copy(io.Discard, ref.Reader); err != nil {
			return providers.ImageOutput{}, err
		}
	}
	name := strings.ReplaceAll(req.Input.Settings.AspectRatio, ":", "-")
	// Bundled placeholders deliberately do not simulate AI editing.
	return providers.ImageOutput{File: "image-" + name + ".png", ContentType: "image/png"}, nil
}
func (Image) Download(ctx context.Context, file string) (io.ReadCloser, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	switch file {
	case "image-1-1.png", "image-16-9.png", "image-9-16.png":
	default:
		return nil, fmt.Errorf("unknown fake image")
	}
	data, err := imageSamples.ReadFile("testdata/" + file)
	if err != nil {
		return nil, err
	}
	return io.NopCloser(bytes.NewReader(data)), nil
}
