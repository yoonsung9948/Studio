package fake

import (
	"context"
	"encoding/json"
	"strings"
	"unicode/utf8"

	"nori/studio/server/internal/domain/interpretation"
)

const (
	InterpreterProvider = "fake_claude"
	InterpreterModel    = "fake-v1"
)

// Interpreter preserves the prompt without pretending to understand it.
type Interpreter struct{}

func (Interpreter) Interpret(ctx context.Context, in interpretation.Input) (interpretation.Decision, error) {
	if err := ctx.Err(); err != nil {
		return interpretation.Decision{}, err
	}
	if err := in.Validate(); err != nil {
		return interpretation.Decision{}, err
	}
	prompt := strings.TrimSpace(in.Prompt)
	assumptions := []string{"Fake interpreter: proposes video generation without semantic analysis."}
	if utf8.RuneCountInString(prompt) > 2000 {
		return interpretation.Decision{Action: interpretation.ClarificationNeeded, Questions: []string{"Please shorten the video prompt to at most 2,000 characters."}, Assumptions: assumptions}, nil
	}
	input, err := json.Marshal(struct {
		Prompt          string `json:"prompt"`
		DurationSeconds int    `json:"durationSeconds"`
		Resolution      string `json:"resolution"`
	}{Prompt: prompt, DurationSeconds: 6, Resolution: "768P"})
	if err != nil {
		return interpretation.Decision{}, err
	}
	return interpretation.Decision{Action: interpretation.ProposeOperation, Operation: "generate_video", Input: input, Assumptions: assumptions}, nil
}
