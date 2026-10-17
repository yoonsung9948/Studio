package engine

import (
	"context"
	"encoding/json"
	"time"

	"nori/studio/server/internal/platform/queue"
)

// Operation is one kind of work the engine can run. The engine owns submission,
// attempts, fencing, checkpoints and publishing; an operation validates its input
// and does the work one step at a time.
//
// Simple operations (one call, one result) should use Define instead of
// implementing Step directly.
type Operation interface {
	// Name is the operation clients submit, e.g. "interpret_brief".
	Name() string
	// InputVersion is stored with each job; stored input with another version is rejected.
	InputVersion() int
	// Queue is the queue the first step runs on, chosen by what limits the work.
	Queue() string
	// Canonicalize validates client input and returns its canonical JSON, so equal
	// requests compare equal for idempotency. Error messages are shown to clients.
	Canonicalize(input json.RawMessage) (json.RawMessage, error)
	// Provider names who runs the operation, recorded on each attempt when it starts.
	Provider() (provider, model string)
	// Step runs the current step and says what happens next. Return a *RunError to
	// control the failure code and whether the attempt is retried; other errors are retried.
	Step(ctx context.Context, run Run) (Outcome, error)
}

const (
	// DefaultStepTimeout limits each step unless the operation implements StepTimeouter.
	DefaultStepTimeout = 30 * time.Second
	// MaxStepTimeout caps any step. It stays below queue.RescueAfter so River
	// never mistakes a running step for a crashed one.
	MaxStepTimeout = 100 * time.Second
)

// StepTimeouter is implemented by operations whose steps need a different time
// limit than DefaultStepTimeout, such as downloading a large file. Values are
// capped at MaxStepTimeout; zero means the default.
type StepTimeouter interface {
	StepTimeout(step string) time.Duration
}

func stepTimeout(op Operation, step string) time.Duration {
	t := DefaultStepTimeout
	if st, ok := op.(StepTimeouter); ok {
		if custom := st.StepTimeout(step); custom > 0 {
			t = custom
		}
	}
	return min(t, MaxStepTimeout)
}

// Run is what one step receives. Operations never get the database.
type Run struct {
	// JobID is stable across steps, retries and queues; use it as a provider's
	// idempotency key so a repeated step does not start (and pay for) new work.
	JobID string
	// Attempt counts tries of the whole job; resuming after Wait or Next keeps it.
	Attempt int
	Input   json.RawMessage
	// Step is "" for the first step, then whatever the previous Next named.
	Step string
	// State is what the previous step saved with Wait or Next; nil at first.
	State json.RawMessage
}

// Outcome says what happens after a step: Done, Wait or Next.
type Outcome interface{ isOutcome() }

// Done finishes the job and publishes its artifacts.
type Done struct {
	Provider  string // who actually did the work, if different from Operation.Provider
	Model     string
	Artifacts []ArtifactDraft
}

// Wait checkpoints State and runs the same step again after After, without
// holding a worker slot. Use it to poll an asynchronous provider. Waiting does
// not count against the job's retries. Nil State keeps the previous state.
type Wait struct {
	State json.RawMessage
	After time.Duration
}

// Next checkpoints State and continues with another step. An empty Queue stays
// on the current queue; another queue moves the job there (with a fresh retry budget).
type Next struct {
	Step  string
	Queue string
	State json.RawMessage
}

func (Done) isOutcome() {}
func (Wait) isOutcome() {}
func (Next) isOutcome() {}

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

// checkOutcome describes why the worker cannot carry out an outcome, or returns "".
// Such outcomes are bugs in the operation, so the job fails without retrying.
func checkOutcome(o Outcome) string {
	switch o := o.(type) {
	case Done:
		for _, a := range o.Artifacts {
			if a.Kind == "" || a.SchemaVersion < 1 || !json.Valid(a.Content) {
				return "Operation returned an invalid artifact."
			}
		}
	case Wait:
		if o.After < 0 || (o.State != nil && !json.Valid(o.State)) {
			return "Operation returned an invalid wait."
		}
	case Next:
		if o.Step == "" || (o.Queue != "" && !queue.Valid(o.Queue)) || (o.State != nil && !json.Valid(o.State)) {
			return "Operation returned an invalid next step."
		}
	default:
		return "Operation returned no outcome."
	}
	return ""
}
