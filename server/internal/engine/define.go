package engine

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
)

// Validator is implemented by operation inputs and outputs.
type Validator interface{ Validate() error }

// Def describes a one-step operation with typed input and output: one call,
// one artifact. Define turns it into an Operation.
type Def[In, Out Validator] struct {
	Name          string
	InputVersion  int
	Queue         string
	Provider      string
	Model         string
	OutputKind    string // artifact kind, e.g. "creative_brief"
	OutputVersion int
	// Normalize adjusts input before validation, e.g. trimming whitespace. Optional.
	Normalize func(*In)
	// Run does the work. Return a *RunError to choose the failure code;
	// any other error is reported as a retryable provider error.
	Run func(context.Context, In) (Out, error)
}

// Define builds an Operation from d. It decodes input strictly, validates input
// and output, and maps failures to consistent error codes.
func Define[In, Out Validator](d Def[In, Out]) Operation { return &defined[In, Out]{d} }

type defined[In, Out Validator] struct{ d Def[In, Out] }

func (o *defined[In, Out]) Name() string               { return o.d.Name }
func (o *defined[In, Out]) InputVersion() int          { return o.d.InputVersion }
func (o *defined[In, Out]) Queue() string              { return o.d.Queue }
func (o *defined[In, Out]) Provider() (string, string) { return o.d.Provider, o.d.Model }

func (o *defined[In, Out]) Canonicalize(raw json.RawMessage) (json.RawMessage, error) {
	in, err := o.decode(raw)
	if err != nil {
		return nil, err
	}
	return json.Marshal(in)
}

func (o *defined[In, Out]) decode(raw json.RawMessage) (In, error) {
	return DecodeInput(o.d.Name, raw, o.d.Normalize)
}

// DecodeInput decodes an operation's input strictly (unknown fields are
// rejected), applies normalize if given, and validates the result. Error
// messages are safe to show to clients.
func DecodeInput[In Validator](operation string, raw json.RawMessage, normalize func(*In)) (In, error) {
	var in In
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&in); err != nil {
		return in, fmt.Errorf("input does not match the %s input format", operation)
	}
	if normalize != nil {
		normalize(&in)
	}
	return in, in.Validate()
}

func (o *defined[In, Out]) Step(ctx context.Context, run Run) (Outcome, error) {
	in, err := o.decode(run.Input)
	if err != nil {
		return nil, &RunError{Code: "invalid_input", Message: err.Error()}
	}
	out, err := o.d.Run(ctx, in)
	if err != nil {
		var runErr *RunError
		if errors.As(err, &runErr) {
			return nil, err
		}
		return nil, &RunError{Code: "provider_error", Message: o.d.Name + " failed.", Retryable: true}
	}
	if err := out.Validate(); err != nil {
		return nil, &RunError{Code: "invalid_output", Message: "Provider returned invalid output."}
	}
	content, err := json.Marshal(out)
	if err != nil {
		return nil, err
	}
	return Done{
		Provider:  o.d.Provider,
		Model:     o.d.Model,
		Artifacts: []ArtifactDraft{{Kind: o.d.OutputKind, SchemaVersion: o.d.OutputVersion, Content: content}},
	}, nil
}
