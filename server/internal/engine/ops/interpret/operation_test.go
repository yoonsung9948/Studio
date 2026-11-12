package interpret

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"nori/studio/server/internal/domain/interpretation"
	"nori/studio/server/internal/engine"
	"nori/studio/server/internal/platform/queue"
	"nori/studio/server/internal/providers"
	"nori/studio/server/internal/providers/fake"
)

func TestCanonicalizeTrimsAndRejects(t *testing.T) {
	op := NewOperation(fake.Interpreter{}, fake.InterpreterProvider, fake.InterpreterModel)
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

func (f failing) Interpret(context.Context, interpretation.Input) (interpretation.Decision, error) {
	return interpretation.Decision{}, f.err
}

func TestRunReportsArtifactAndFailures(t *testing.T) {
	input := json.RawMessage(`{"prompt":"story"}`)
	outcome, err := NewOperation(fake.Interpreter{}, "p", "m").Step(context.Background(), engine.Run{Input: input})
	done, ok := outcome.(engine.Done)
	if err != nil || !ok || done.Provider != "p" || done.Model != "m" || len(done.Artifacts) != 1 ||
		done.Artifacts[0].Kind != "request_interpretation" || done.Artifacts[0].SchemaVersion != 2 {
		t.Fatalf("got %+v %v", outcome, err)
	}
	var result interpretation.Decision
	if err := json.Unmarshal(done.Artifacts[0].Content, &result); err != nil {
		t.Fatal(err)
	}
	if result.Action != interpretation.ProposeOperation || result.Operation != "generate_video" || !strings.Contains(string(result.Input), `"prompt":"story"`) {
		t.Fatalf("unexpected interpretation: %+v", result)
	}
	for _, tc := range []struct {
		interpreter providers.Interpreter
		code        string
		retryable   bool
	}{
		{failing{errors.New("down")}, "provider_error", true},
		{failing{nil}, "invalid_output", false},
	} {
		_, err := NewOperation(tc.interpreter, "p", "m").Step(context.Background(), engine.Run{Input: input})
		var runErr *engine.RunError
		if !errors.As(err, &runErr) || runErr.Code != tc.code || runErr.Retryable != tc.retryable {
			t.Errorf("got %v, want %s", err, tc.code)
		}
	}
}
