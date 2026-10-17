package brief

import (
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

// NewOperation runs an Interpreter as a one-step engine operation.
func NewOperation(interpreter Interpreter, provider, model string) engine.Operation {
	return engine.Define(engine.Def[Input, Brief]{
		Name:          Name,
		InputVersion:  1,
		Queue:         queue.LLM,
		Provider:      provider,
		Model:         model,
		OutputKind:    "creative_brief",
		OutputVersion: 1,
		Normalize:     func(in *Input) { in.Prompt = strings.TrimSpace(in.Prompt) },
		Run:           interpreter.Interpret,
	})
}
