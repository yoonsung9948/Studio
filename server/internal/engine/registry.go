package engine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"nori/studio/server/internal/platform/queue"
)

// Operation is one kind of work the engine can run, such as interpreting a brief.
// The engine owns submission, attempts, fencing and publishing; an operation
// only validates its input and does the work.
type Operation interface {
	// Name is the operation clients submit, e.g. "interpret_brief".
	Name() string
	// InputVersion is stored with each job; stored input with another version is rejected.
	InputVersion() int
	// Queue is the queue its jobs run on (queue.LLM, queue.Image, queue.Video or queue.Render),
	// chosen by what limits the work.
	Queue() string
	// Canonicalize validates client input and returns its canonical JSON, so equal
	// requests compare equal for idempotency. Error messages are shown to clients.
	Canonicalize(input json.RawMessage) (json.RawMessage, error)
	// Provider names who runs the operation, recorded on each attempt when it starts.
	Provider() (provider, model string)
	// Run does the work for canonical input. Return a *RunError to control the
	// failure code and whether the attempt is retried; other errors are retried.
	Run(ctx context.Context, input json.RawMessage) (Output, error)
}

// Output is what a successful run publishes.
type Output struct {
	Provider string
	Model    string
	Artifact ArtifactDraft
}

// ArtifactDraft is an artifact before it is stored.
type ArtifactDraft struct {
	Kind          string
	SchemaVersion int
	Content       json.RawMessage
}

// RunError is a failure an operation reports. Code and Message are stored on the
// job and shown to clients.
type RunError struct {
	Code      string
	Message   string
	Retryable bool
}

func (e *RunError) Error() string { return e.Code + ": " + e.Message }

// Registry maps operation names to operations.
type Registry struct {
	ops map[string]Operation
}

func NewRegistry(ops ...Operation) (*Registry, error) {
	r := &Registry{ops: make(map[string]Operation, len(ops))}
	for _, op := range ops {
		name := op.Name()
		if name == "" {
			return nil, errors.New("operation name is empty")
		}
		if _, ok := r.ops[name]; ok {
			return nil, fmt.Errorf("operation %q registered twice", name)
		}
		if op.InputVersion() < 1 {
			return nil, fmt.Errorf("operation %q has input version below 1", name)
		}
		if !queue.Valid(op.Queue()) {
			return nil, fmt.Errorf("operation %q uses unknown queue %q", name, op.Queue())
		}
		r.ops[name] = op
	}
	return r, nil
}

func (r *Registry) Get(name string) (Operation, bool) {
	op, ok := r.ops[name]
	return op, ok
}
