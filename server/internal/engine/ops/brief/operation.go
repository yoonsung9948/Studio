package brief

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"

	"nori/studio/server/internal/engine"
	"nori/studio/server/internal/platform/queue"
)

// Name is the operation clients submit.
const Name = "interpret_brief"

// Provider and model recorded for the fake interpreter.
const (
	FakeProvider = "fake_claude"
	FakeModel    = "fake-v1"
)

// Operation runs an Interpreter as an engine operation.
type Operation struct {
	interpreter     Interpreter
	provider, model string
}

func NewOperation(interpreter Interpreter, provider, model string) *Operation {
	return &Operation{interpreter: interpreter, provider: provider, model: model}
}

func (o *Operation) Name() string      { return Name }
func (o *Operation) InputVersion() int { return 1 }
func (o *Operation) Queue() string     { return queue.LLM }

func (o *Operation) Provider() (string, string) { return o.provider, o.model }

func (o *Operation) Canonicalize(raw json.RawMessage) (json.RawMessage, error) {
	var input Input
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&input); err != nil {
		return nil, errors.New("input must contain only a prompt string")
	}
	input.Prompt = strings.TrimSpace(input.Prompt)
	if err := input.Validate(); err != nil {
		return nil, err
	}
	return json.Marshal(input)
}

func (o *Operation) Run(ctx context.Context, raw json.RawMessage) (engine.Output, error) {
	var input Input
	if err := json.Unmarshal(raw, &input); err != nil {
		return engine.Output{}, &engine.RunError{Code: "invalid_input", Message: "Stored job input is invalid."}
	}
	if err := input.Validate(); err != nil {
		return engine.Output{}, &engine.RunError{Code: "invalid_input", Message: err.Error()}
	}
	result, err := o.interpreter.Interpret(ctx, input)
	if err != nil {
		return engine.Output{}, &engine.RunError{Code: "provider_error", Message: "Brief interpretation failed.", Retryable: true}
	}
	if err := result.Validate(); err != nil {
		return engine.Output{}, &engine.RunError{Code: "invalid_output", Message: "Provider returned an invalid creative brief."}
	}
	content, err := json.Marshal(result)
	if err != nil {
		return engine.Output{}, err
	}
	return engine.Output{
		Provider: o.provider,
		Model:    o.model,
		Artifact: engine.ArtifactDraft{Kind: "creative_brief", SchemaVersion: 1, Content: content},
	}, nil
}
