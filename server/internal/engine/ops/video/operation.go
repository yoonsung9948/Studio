// Package video is the generate_video operation: send a prompt to a video
// model, wait for the clip, and store it in the blob store.
package video

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"nori/studio/server/internal/engine"
	"nori/studio/server/internal/platform/blob"
	"nori/studio/server/internal/platform/queue"
	"nori/studio/server/internal/providers"
)

// Name is the operation clients submit.
const Name = "generate_video"

// Steps, in order. Each is checkpointed, so a retry resumes where it failed.
const (
	stepSubmit   = ""         // send the request; get a provider task ID
	stepPoll     = "poll"     // check the task until it finishes
	stepDownload = "download" // copy the finished file into our store
)

// downloadTimeout gives large clips time to transfer.
const downloadTimeout = 90 * time.Second

type Operation struct {
	model     providers.VideoModel
	store     blob.Store
	pollEvery time.Duration
}

// NewOperation generates video with model, stores files in store, and checks
// unfinished tasks every pollEvery.
func NewOperation(model providers.VideoModel, store blob.Store, pollEvery time.Duration) *Operation {
	return &Operation{model: model, store: store, pollEvery: pollEvery}
}

func (o *Operation) Name() string               { return Name }
func (o *Operation) InputVersion() int          { return 1 }
func (o *Operation) Queue() string              { return queue.Video }
func (o *Operation) Provider() (string, string) { return o.model.Name() }

func (o *Operation) StepTimeout(step string) time.Duration {
	if step == stepDownload {
		return downloadTimeout
	}
	return 0
}

func (o *Operation) Canonicalize(raw json.RawMessage) (json.RawMessage, error) {
	in, err := engine.DecodeInput(Name, raw, normalize)
	if err != nil {
		return nil, err
	}
	return json.Marshal(in)
}

func (o *Operation) Step(ctx context.Context, run engine.Run) (engine.Outcome, error) {
	in, err := engine.DecodeInput(Name, run.Input, normalize)
	if err != nil {
		return nil, &engine.RunError{Code: "invalid_input", Message: err.Error()}
	}
	var st state
	if run.State != nil {
		if err := json.Unmarshal(run.State, &st); err != nil {
			return nil, &engine.RunError{Code: "invalid_state", Message: "Saved job state is invalid."}
		}
	}
	switch run.Step {
	case stepSubmit:
		// If the provider accepted the task but the reply was lost, a retry
		// submits again and may be billed twice. Real providers should be
		// given an idempotency key (run.JobID) where their API supports one.
		taskID, err := o.model.Submit(ctx, providers.VideoRequest{Prompt: in.Prompt, DurationSeconds: in.DurationSeconds, Resolution: in.Resolution})
		if err != nil {
			return o.providerFailure(err)
		}
		return engine.Next{Step: stepPoll, State: mustJSON(state{TaskID: taskID})}, nil

	case stepPoll:
		task, err := o.model.Check(ctx, st.TaskID)
		if err != nil {
			return o.providerFailure(err)
		}
		switch task.Status {
		case providers.VideoPending:
			return engine.Wait{After: o.pollEvery}, nil
		case providers.VideoSucceeded:
			return engine.Next{Step: stepDownload, State: mustJSON(state{TaskID: st.TaskID, File: task.File})}, nil
		default:
			message := "Video generation failed."
			if task.Error != "" {
				message = "Video generation failed: " + task.Error
			}
			return nil, &engine.RunError{Code: "generation_failed", Message: message}
		}

	case stepDownload:
		file, err := o.model.Download(ctx, st.File)
		if err != nil {
			return o.providerFailure(err)
		}
		defer file.Close()
		// One file per job: a repeated download overwrites it instead of adding another.
		info, err := o.store.Put(ctx, "jobs/"+run.JobID+"/video.mp4", file)
		if err != nil {
			return nil, &engine.RunError{Code: "storage_error", Message: "Could not store the video.", Retryable: true}
		}
		provider, model := o.model.Name()
		return engine.Done{
			Provider: provider,
			Model:    model,
			Artifacts: []engine.ArtifactDraft{{Kind: "video", SchemaVersion: 1, Content: mustJSON(Result{
				FileKey:         info.Key,
				ContentType:     info.ContentType,
				SizeBytes:       info.Size,
				Prompt:          in.Prompt,
				DurationSeconds: in.DurationSeconds,
				Resolution:      in.Resolution,
				ProviderTaskID:  st.TaskID,
			})}},
		}, nil
	}
	return nil, &engine.RunError{Code: "invalid_state", Message: "Unknown step " + run.Step + "."}
}

// providerFailure turns a provider error into what the engine should do:
// wait out rate limits, stop on rejections, retry anything else.
func (o *Operation) providerFailure(err error) (engine.Outcome, error) {
	var limited *providers.RateLimitedError
	switch {
	case errors.As(err, &limited):
		after := limited.RetryAfter
		if after <= 0 {
			after = o.pollEvery
		}
		return engine.Wait{After: after}, nil
	case errors.Is(err, providers.ErrRejected):
		return nil, &engine.RunError{Code: "rejected", Message: "The video provider rejected this request."}
	case errors.Is(err, providers.ErrUnauthorized):
		return nil, &engine.RunError{Code: "provider_unauthorized", Message: "The video provider rejected the configured credentials."}
	default:
		return nil, &engine.RunError{Code: "provider_error", Message: "The video provider could not be reached.", Retryable: true}
	}
}

func mustJSON(v any) json.RawMessage {
	data, err := json.Marshal(v)
	if err != nil {
		panic(err) // only plain structs are marshalled here
	}
	return data
}
