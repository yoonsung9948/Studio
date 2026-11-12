package providers

import (
	"context"

	"nori/studio/server/internal/domain/interpretation"
)

type Interpreter interface {
	Interpret(context.Context, interpretation.Input) (interpretation.Decision, error)
}
