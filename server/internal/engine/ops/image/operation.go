package image

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"image/png"
	"io"
	"strings"
	"time"

	"github.com/google/uuid"
	"nori/studio/server/internal/assets"
	imageinput "nori/studio/server/internal/domain/image"
	"nori/studio/server/internal/engine"
	"nori/studio/server/internal/platform/apperr"
	"nori/studio/server/internal/platform/blob"
	"nori/studio/server/internal/platform/queue"
	"nori/studio/server/internal/providers"
)

const (
	GenerateName  = "generate_image"
	EditName      = "edit_image"
	maxImageBytes = 32 << 20
)

type AssetReader interface {
	Get(context.Context, string, string) (assets.Detail, error)
}

type Operation struct {
	name   string
	model  providers.ImageModel
	store  blob.Store
	assets AssetReader
}

func NewGenerate(model providers.ImageModel, store blob.Store, assets AssetReader) *Operation {
	return &Operation{GenerateName, model, store, assets}
}
func NewEdit(model providers.ImageModel, store blob.Store, assets AssetReader) *Operation {
	return &Operation{EditName, model, store, assets}
}
func (o *Operation) StepTimeout(step string) time.Duration {
	if step == "" {
		return 3 * time.Minute
	}
	return 30 * time.Second
}

func (o *Operation) Name() string               { return o.name }
func (o *Operation) InputVersion() int          { return 1 }
func (o *Operation) Queue() string              { return queue.Image }
func (o *Operation) Provider() (string, string) { return o.model.Name() }

func (o *Operation) Canonicalize(raw json.RawMessage) (json.RawMessage, error) {
	if !json.Valid(raw) {
		return nil, errors.New("invalid image input JSON")
	}
	in, err := engine.DecodeInput(o.name, raw, func(in *imageinput.Input) {
		in.Prompt = strings.TrimSpace(in.Prompt)
		if in.Model == "" {
			in.Model = o.model.Capabilities().Model
		}
		if in.Settings.AspectRatio == "" {
			in.Settings.AspectRatio = "1:1"
		}
		if in.References == nil {
			in.References = []imageinput.Reference{}
		}
		if id, err := uuid.Parse(in.SourceAssetID); err == nil {
			in.SourceAssetID = id.String()
		}
		for i := range in.References {
			if id, err := uuid.Parse(in.References[i].AssetID); err == nil {
				in.References[i].AssetID = id.String()
			}
		}
	})
	if err != nil {
		return nil, err
	}
	if (o.name == EditName) != (in.SourceAssetID != "") {
		return nil, errors.New("sourceAssetId is required only for edit_image")
	}
	if !o.model.Capabilities().Supports(in, o.name == EditName) {
		return nil, errors.New("unsupported image model, settings, or reference count")
	}
	return json.Marshal(in)
}

func (o *Operation) ReferencedAssets(raw json.RawMessage) ([]engine.AssetReference, error) {
	var in imageinput.Input
	if err := json.Unmarshal(raw, &in); err != nil {
		return nil, err
	}
	refs := []engine.AssetReference{}
	if in.SourceAssetID != "" {
		refs = append(refs, engine.AssetReference{ID: in.SourceAssetID, Kind: "image"})
	}
	for _, ref := range in.References {
		refs = append(refs, engine.AssetReference{ID: ref.AssetID, Kind: "image"})
	}
	return refs, nil
}

func (o *Operation) Step(ctx context.Context, run engine.Run) (engine.Outcome, error) {
	canonical, err := o.Canonicalize(run.Input)
	if err != nil {
		return nil, &engine.RunError{Code: "invalid_input", Message: err.Error()}
	}
	var in imageinput.Input
	if err := json.Unmarshal(canonical, &in); err != nil {
		return nil, err
	}
	switch run.Step {
	case "":
		req := providers.ImageRequest{IdempotencyKey: run.JobID, Input: in}
		var opened []blob.Object
		defer func() {
			for _, file := range opened {
				file.Close()
			}
		}()
		load := func(id, role string) (providers.ImageReference, error) {
			detail, err := o.assets.Get(ctx, run.OwnerID, id)
			if err != nil {
				return providers.ImageReference{}, err
			}
			if detail.Kind != "image" {
				return providers.ImageReference{}, apperr.ErrNotFound
			}
			for _, file := range detail.Files {
				if file.Role != "original" {
					continue
				}
				if file.SizeBytes > maxImageBytes || !supportedImage(file.ContentType) {
					return providers.ImageReference{}, providers.ErrRejected
				}
				object, err := o.store.Open(ctx, file.StorageKey)
				if err != nil {
					return providers.ImageReference{}, err
				}
				opened = append(opened, object)
				if object.Info().Size > maxImageBytes {
					return providers.ImageReference{}, providers.ErrRejected
				}
				return providers.ImageReference{AssetID: id, Role: role, ContentType: file.ContentType, Reader: io.LimitReader(object, maxImageBytes+1)}, nil
			}
			return providers.ImageReference{}, apperr.ErrNotFound
		}
		if in.SourceAssetID != "" {
			source, err := load(in.SourceAssetID, "source")
			if err != nil {
				return o.inputFailure(err)
			}
			req.Source = &source
		}
		for _, ref := range in.References {
			loaded, err := load(ref.AssetID, ref.Role)
			if err != nil {
				return o.inputFailure(err)
			}
			req.References = append(req.References, loaded)
		}
		var output providers.ImageOutput
		if o.name == EditName {
			output, err = o.model.Edit(ctx, req)
		} else {
			output, err = o.model.Generate(ctx, req)
		}
		if err != nil {
			return providerFailure(err)
		}
		if output.File == "" || output.ContentType != "image/png" {
			return nil, &engine.RunError{Code: "invalid_output", Message: "Image provider returned an unsupported output."}
		}
		state, err := json.Marshal(output)
		if err != nil {
			return nil, err
		}
		return engine.Next{Step: "store", State: state}, nil
	case "store":
		var output providers.ImageOutput
		if json.Unmarshal(run.State, &output) != nil || output.File == "" || output.ContentType != "image/png" {
			return nil, &engine.RunError{Code: "invalid_state", Message: "Saved image output is invalid."}
		}
		file, err := o.model.Download(ctx, output.File)
		if err != nil {
			return providerFailure(err)
		}
		defer file.Close()
		data, err := io.ReadAll(io.LimitReader(file, maxImageBytes+1))
		if err != nil {
			return providerFailure(err)
		}
		if len(data) > maxImageBytes {
			return nil, &engine.RunError{Code: "invalid_output", Message: "Image output is too large."}
		}
		config, err := png.DecodeConfig(bytes.NewReader(data))
		if err != nil || config.Width < 1 || config.Height < 1 || config.Width > 16384 || config.Height > 16384 {
			return nil, &engine.RunError{Code: "invalid_output", Message: "Provider output is not a supported PNG image."}
		}
		info, err := o.store.Put(ctx, "jobs/"+run.JobID+"/image.png", bytes.NewReader(data))
		if err != nil {
			return nil, &engine.RunError{Code: "storage_error", Message: "Could not store the image.", Retryable: true}
		}
		content, err := json.Marshal(imageinput.Result{FileKey: info.Key, ContentType: output.ContentType, SizeBytes: info.Size, Model: in.Model, SourceAssetID: in.SourceAssetID})
		if err != nil {
			return nil, err
		}
		provider, model := o.model.Name()
		return engine.Done{Provider: provider, Model: model, Artifacts: []engine.ArtifactDraft{{Kind: "image", SchemaVersion: 1, Content: content, Media: &engine.MediaDraft{Kind: "image", FileKey: info.Key, ContentType: output.ContentType, SizeBytes: info.Size, SourceAssetID: in.SourceAssetID}}}}, nil
	default:
		return nil, &engine.RunError{Code: "invalid_state", Message: "Unknown image step."}
	}
}

func supportedImage(contentType string) bool {
	return contentType == "image/png" || contentType == "image/jpeg" || contentType == "image/webp"
}
func (o *Operation) inputFailure(err error) (engine.Outcome, error) {
	if errors.Is(err, apperr.ErrNotFound) || errors.Is(err, blob.ErrNotFound) {
		return nil, &engine.RunError{Code: "reference_unavailable", Message: "An input image is unavailable."}
	}
	if errors.Is(err, providers.ErrRejected) {
		return nil, &engine.RunError{Code: "invalid_reference", Message: "An input image has an unsupported format or size."}
	}
	return nil, &engine.RunError{Code: "reference_error", Message: "Could not read an input image.", Retryable: true}
}
func providerFailure(err error) (engine.Outcome, error) {
	var limited *providers.RateLimitedError
	switch {
	case errors.As(err, &limited):
		after := limited.RetryAfter
		if after <= 0 {
			after = time.Second
		}
		return engine.Wait{After: after}, nil
	case errors.Is(err, providers.ErrUncertain):
		return nil, &engine.RunError{Code: "provider_outcome_unknown", Message: "The provider may have accepted this generation. It was not resubmitted automatically."}
	case errors.Is(err, providers.ErrQuota):
		return nil, &engine.RunError{Code: "provider_quota", Message: "The provider quota or submission limit was reached."}
	case errors.Is(err, providers.ErrRejected):
		return nil, &engine.RunError{Code: "rejected", Message: "The image provider rejected this request."}
	case errors.Is(err, providers.ErrUnauthorized):
		return nil, &engine.RunError{Code: "provider_unauthorized", Message: "The image provider rejected the configured credentials."}
	default:
		return nil, &engine.RunError{Code: "provider_error", Message: "The image provider could not be reached.", Retryable: true}
	}
}
