package providers

import (
	"context"

	"nori/studio/server/internal/domain/prompt"
)

type EnhancementRequest struct {
	Input               prompt.Input
	SystemPrompt        string
	MaxPromptCharacters int
}

type PromptEnhancer interface {
	Enhance(context.Context, EnhancementRequest) (prompt.Enhancement, error)
}
