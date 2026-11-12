package enhance

import (
	"context"
	"encoding/json"
	"errors"
	"time"
	"unicode/utf8"

	"nori/studio/server/internal/domain/prompt"
	"nori/studio/server/internal/engine"
	"nori/studio/server/internal/platform/queue"
	"nori/studio/server/internal/prompts"
	"nori/studio/server/internal/providers"
)

const Name = "enhance_prompt"

type Operation struct {
	enhancer providers.PromptEnhancer
	provider string
	model    string
}

func NewOperation(enhancer providers.PromptEnhancer, provider, model string) *Operation {
	return &Operation{enhancer: enhancer, provider: provider, model: model}
}

func (o *Operation) Name() string               { return Name }
func (o *Operation) InputVersion() int          { return 1 }
func (o *Operation) Queue() string              { return queue.LLM }
func (o *Operation) Provider() (string, string) { return o.provider, o.model }

func (o *Operation) Canonicalize(raw json.RawMessage) (json.RawMessage, error) {
	in, err := engine.DecodeInput(Name, raw, func(in *prompt.Input) {
		if in.Constraints == nil {
			in.Constraints = []string{}
		}
		if template, ok := prompts.EnhancementTemplate(in.TargetModel, in.Task, in.TemplateVersion); ok {
			in.TemplateVersion = template.Version
			if in.Settings.Resolution == "" {
				in.Settings.Resolution = template.DefaultResolution
			}
		}
	})
	if err != nil {
		return nil, err
	}
	template, ok := prompts.EnhancementTemplate(in.TargetModel, in.Task, in.TemplateVersion)
	if !ok {
		return nil, errors.New("unsupported enhancement model, task, or template version")
	}
	if err := template.ValidateInput(in); err != nil {
		return nil, err
	}
	return json.Marshal(in)
}

func (o *Operation) Step(ctx context.Context, run engine.Run) (engine.Outcome, error) {
	in, err := engine.DecodeInput[prompt.Input](Name, run.Input, nil)
	if err != nil {
		return nil, &engine.RunError{Code: "invalid_input", Message: err.Error()}
	}
	template, ok := prompts.EnhancementTemplate(in.TargetModel, in.Task, in.TemplateVersion)
	if !ok {
		return nil, &engine.RunError{Code: "invalid_input", Message: "Unsupported enhancement model, task, or template version."}
	}
	if err := template.ValidateInput(in); err != nil {
		return nil, &engine.RunError{Code: "invalid_input", Message: err.Error()}
	}
	providerInput := in
	providerInput.Constraints = append([]string{}, in.Constraints...)
	output, err := o.enhancer.Enhance(ctx, providers.EnhancementRequest{Input: providerInput, SystemPrompt: template.SystemPrompt, MaxPromptCharacters: template.MaxPromptCharacters})
	if err != nil {
		var limited *providers.RateLimitedError
		switch {
		case errors.As(err, &limited):
			after := limited.RetryAfter
			if after <= 0 {
				after = time.Second
			}
			return engine.Wait{After: after}, nil
		case errors.Is(err, providers.ErrRejected):
			return nil, &engine.RunError{Code: "rejected", Message: "The enhancement provider rejected the request."}
		case errors.Is(err, providers.ErrUnauthorized):
			return nil, &engine.RunError{Code: "provider_unauthorized", Message: "The enhancement provider rejected the configured credentials."}
		default:
			return nil, &engine.RunError{Code: "provider_error", Message: "Prompt enhancement failed.", Retryable: true}
		}
	}
	if err := output.Validate(); err != nil || utf8.RuneCountInString(output.GenerationPrompt) > template.MaxPromptCharacters {
		return nil, &engine.RunError{Code: "invalid_output", Message: "The enhancement provider returned an invalid result."}
	}
	content, err := json.Marshal(prompt.Result{Input: in, TemplateID: template.ID, Enhancement: output})
	if err != nil {
		return nil, err
	}
	return engine.Done{Provider: o.provider, Model: o.model, Artifacts: []engine.ArtifactDraft{{Kind: "prompt_enhancement", SchemaVersion: 1, Content: content}}}, nil
}
