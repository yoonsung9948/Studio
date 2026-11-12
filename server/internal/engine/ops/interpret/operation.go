package interpret

import (
	"strings"

	"nori/studio/server/internal/domain/interpretation"
	"nori/studio/server/internal/engine"
	"nori/studio/server/internal/platform/queue"
	"nori/studio/server/internal/providers"
)

const Name = "interpret_request"

func NewOperation(interpreter providers.Interpreter, provider, model string) engine.Operation {
	return engine.Define(engine.Def[interpretation.Input, interpretation.Decision]{
		Name:          Name,
		InputVersion:  1,
		Queue:         queue.LLM,
		Provider:      provider,
		Model:         model,
		OutputKind:    "request_interpretation",
		OutputVersion: 2,
		Normalize:     func(in *interpretation.Input) { in.Prompt = strings.TrimSpace(in.Prompt) },
		Run:           interpreter.Interpret,
	})
}
