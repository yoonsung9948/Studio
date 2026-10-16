package brief

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"nori/studio/server/internal/engine"
	"nori/studio/server/internal/platform/queue"
)

func TestCanonicalizeTrimsAndRejects(t *testing.T) {
	op := NewOperation(Fake{}, FakeProvider, FakeModel)
	if op.Queue() != queue.LLM {
		t.Fatalf("queue = %q", op.Queue())
	}
	got, err := op.Canonicalize(json.RawMessage(`{"prompt":"  story  "}`))
	if err != nil || string(got) != `{"prompt":"story"}` {
		t.Fatalf("got %s %v", got, err)
	}
	for _, in := range []string{`{"prompt":" "}`, `{"prompt":"a","extra":1}`, `[]`, ``} {
		if _, err := op.Canonicalize(json.RawMessage(in)); err == nil {
			t.Errorf("accepted %q", in)
		}
	}
}

type failing struct{ err error }

func (f failing) Interpret(context.Context, Input) (Brief, error) { return Brief{}, f.err }

func TestRunReportsArtifactAndFailures(t *testing.T) {
	input := json.RawMessage(`{"prompt":"story"}`)
	out, err := NewOperation(Fake{}, "p", "m").Run(context.Background(), input)
	if err != nil || out.Provider != "p" || out.Model != "m" || out.Artifact.Kind != "creative_brief" || out.Artifact.SchemaVersion != 1 {
		t.Fatalf("got %+v %v", out, err)
	}
	for _, tc := range []struct {
		interpreter Interpreter
		code        string
		retryable   bool
	}{
		{failing{errors.New("down")}, "provider_error", true},
		{failing{nil}, "invalid_output", false},
	} {
		_, err := NewOperation(tc.interpreter, "p", "m").Run(context.Background(), input)
		var runErr *engine.RunError
		if !errors.As(err, &runErr) || runErr.Code != tc.code || runErr.Retryable != tc.retryable {
			t.Errorf("got %v, want %s", err, tc.code)
		}
	}
}
