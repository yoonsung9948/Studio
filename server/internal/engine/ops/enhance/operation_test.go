package enhance

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"nori/studio/server/internal/domain/prompt"
	"nori/studio/server/internal/engine"
	"nori/studio/server/internal/platform/queue"
	"nori/studio/server/internal/providers"
	"nori/studio/server/internal/providers/fake"
)

const input = `{"originalPrompt":"She hides her reaction.","targetModel":"fake-h3","task":"text_to_video","settings":{"durationSeconds":6}}`

type enhancerFunc func(context.Context, providers.EnhancementRequest) (prompt.Enhancement, error)

func (f enhancerFunc) Enhance(ctx context.Context, in providers.EnhancementRequest) (prompt.Enhancement, error) {
	return f(ctx, in)
}

func TestCanonicalizePinsTemplateAndPreservesOriginal(t *testing.T) {
	op := NewOperation(fake.Enhancer{}, "p", "m")
	if op.Queue() != queue.LLM {
		t.Fatal(op.Queue())
	}
	raw := json.RawMessage(strings.Replace(input, "She hides her reaction.", "  She hides her reaction.  ", 1))
	canonical, err := op.Canonicalize(raw)
	if err != nil {
		t.Fatal(err)
	}
	var in prompt.Input
	if err := json.Unmarshal(canonical, &in); err != nil {
		t.Fatal(err)
	}
	if in.OriginalPrompt != "  She hides her reaction.  " || in.TemplateVersion != 1 || in.Constraints == nil || in.Settings.Resolution != "768P" {
		t.Fatalf("input=%+v", in)
	}
	for _, bad := range []string{
		strings.Replace(input, "fake-h3", "unknown", 1),
		strings.Replace(input, "text_to_video", "image_to_video", 1),
		strings.Replace(input, "6", "30", 1),
		strings.Replace(input, "She hides her reaction.", " ", 1),
		strings.Replace(input, `"settings":`, `"templateVersion":99,"settings":`, 1),
		strings.Replace(input, `"settings":`, `"extra":true,"settings":`, 1),
		strings.Replace(input, `"settings":`, `"constraints":[" "],"settings":`, 1),
	} {
		if _, err := op.Canonicalize(json.RawMessage(bad)); err == nil {
			t.Errorf("accepted %s", bad)
		}
	}
}

func TestProviderReceivesInstructionsWithoutOwningOriginal(t *testing.T) {
	calls := 0
	op := NewOperation(enhancerFunc(func(_ context.Context, in providers.EnhancementRequest) (prompt.Enhancement, error) {
		calls++
		if !strings.Contains(in.SystemPrompt, "Faithfulness") || in.MaxPromptCharacters != 2000 || in.Input.TemplateVersion != 1 || in.Input.Settings.DurationSeconds != 6 {
			t.Fatalf("request=%+v", in)
		}
		in.Input.Constraints[0] = "Changed by adapter"
		return prompt.Enhancement{GenerationPrompt: "She hides her reaction.", Assumptions: []string{}, UnresolvedConstraints: []string{}}, nil
	}), "fake_claude", "enhancer-v1")
	raw := strings.Replace(input, `"settings":`, `"constraints":["No tears."],"settings":`, 1)
	canonical, err := op.Canonicalize(json.RawMessage(raw))
	if err != nil {
		t.Fatal(err)
	}
	outcome, err := op.Step(context.Background(), engine.Run{Input: canonical})
	done, ok := outcome.(engine.Done)
	if err != nil || !ok || len(done.Artifacts) != 1 || done.Artifacts[0].Kind != "prompt_enhancement" || done.Artifacts[0].SchemaVersion != 1 || done.Provider != "fake_claude" || done.Model != "enhancer-v1" || calls != 1 {
		t.Fatalf("outcome=%+v err=%v", outcome, err)
	}
	var result prompt.Result
	if err := json.Unmarshal(done.Artifacts[0].Content, &result); err != nil {
		t.Fatal(err)
	}
	if result.Input.Constraints[0] != "No tears." || result.Input.OriginalPrompt != "She hides her reaction." || result.TemplateID != "fake-h3-text-to-video" {
		t.Fatalf("source mutated: %+v", result)
	}
}

func TestProviderFailuresAndInvalidOutput(t *testing.T) {
	valid := prompt.Enhancement{GenerationPrompt: "She hides her reaction.", Assumptions: []string{}, UnresolvedConstraints: []string{}}
	for _, tc := range []struct {
		name   string
		output prompt.Enhancement
		err    error
		code   string
		retry  bool
	}{
		{"network", valid, errors.New("secret"), "provider_error", true},
		{"rejection", valid, providers.ErrRejected, "rejected", false},
		{"credentials", valid, providers.ErrUnauthorized, "provider_unauthorized", false},
		{"malformed", prompt.Enhancement{}, nil, "invalid_output", false},
		{"too long", prompt.Enhancement{GenerationPrompt: strings.Repeat("x", 2001), Assumptions: []string{}, UnresolvedConstraints: []string{}}, nil, "invalid_output", false},
		{"mixed", prompt.Enhancement{GenerationPrompt: "Guess", Assumptions: []string{}, UnresolvedConstraints: []string{"Missing intent"}}, nil, "invalid_output", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			op := NewOperation(enhancerFunc(func(context.Context, providers.EnhancementRequest) (prompt.Enhancement, error) {
				return tc.output, tc.err
			}), "p", "m")
			canonical, err := op.Canonicalize(json.RawMessage(input))
			if err != nil {
				t.Fatal(err)
			}
			_, err = op.Step(context.Background(), engine.Run{Input: canonical})
			var runErr *engine.RunError
			if !errors.As(err, &runErr) || runErr.Code != tc.code || runErr.Retryable != tc.retry {
				t.Fatalf("error=%v", err)
			}
		})
	}
	op := NewOperation(enhancerFunc(func(context.Context, providers.EnhancementRequest) (prompt.Enhancement, error) {
		return prompt.Enhancement{}, &providers.RateLimitedError{RetryAfter: 2 * time.Second}
	}), "p", "m")
	canonical, _ := op.Canonicalize(json.RawMessage(input))
	out, err := op.Step(context.Background(), engine.Run{Input: canonical})
	wait, ok := out.(engine.Wait)
	if err != nil || !ok || wait.After != 2*time.Second {
		t.Fatalf("wait=%+v err=%v", out, err)
	}
	// A stored job must already identify an immutable template version.
	if _, err := op.Step(context.Background(), engine.Run{Input: json.RawMessage(input)}); err == nil {
		t.Fatal("executed unpinned input")
	}
}
