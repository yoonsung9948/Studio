package fake

import (
	"context"
	"strings"
	"unicode/utf8"

	"nori/studio/server/internal/domain/prompt"
	"nori/studio/server/internal/providers"
)

const (
	EnhancerProvider = "fake_claude"
	EnhancerModel    = "fake-enhancer-v1"
)

// Enhancer preserves text verbatim; it does not perform semantic interpretation.
type Enhancer struct{}

func (Enhancer) Enhance(ctx context.Context, req providers.EnhancementRequest) (prompt.Enhancement, error) {
	if err := ctx.Err(); err != nil {
		return prompt.Enhancement{}, err
	}
	if err := req.Input.Validate(); err != nil {
		return prompt.Enhancement{}, err
	}
	result := prompt.Enhancement{GenerationPrompt: req.Input.OriginalPrompt, Assumptions: []string{}, UnresolvedConstraints: []string{}}
	if len(req.Input.Constraints) > 0 {
		result.GenerationPrompt += "\n\nRequired constraints:\n- " + strings.Join(req.Input.Constraints, "\n- ")
	}
	if utf8.RuneCountInString(result.GenerationPrompt) > req.MaxPromptCharacters {
		result.GenerationPrompt = ""
		result.UnresolvedConstraints = append(result.UnresolvedConstraints, "The prompt and explicit constraints exceed the target's character limit; shorten or split the request without discarding requirements.")
	}
	return result, nil
}
