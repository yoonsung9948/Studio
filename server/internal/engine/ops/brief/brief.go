package brief

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"
)

type Input struct {
	Prompt string `json:"prompt"`
}

func (i Input) Validate() error {
	if strings.TrimSpace(i.Prompt) == "" {
		return errors.New("prompt is required")
	}
	if !utf8.ValidString(i.Prompt) || utf8.RuneCountInString(i.Prompt) > 10000 {
		return errors.New("prompt must be valid UTF-8 and at most 10000 characters")
	}
	return nil
}

type Brief struct {
	Premise     string   `json:"premise"`
	Characters  []string `json:"characters"`
	Setting     string   `json:"setting"`
	Style       string   `json:"style"`
	Assumptions []string `json:"assumptions"`
	Questions   []string `json:"questions"`
}

func (b Brief) Validate() error {
	if strings.TrimSpace(b.Premise) == "" {
		return errors.New("brief premise is required")
	}
	if b.Characters == nil || b.Assumptions == nil || b.Questions == nil {
		return errors.New("brief lists must not be null")
	}
	return nil
}

type Interpreter interface {
	Interpret(context.Context, Input) (Brief, error)
}

// Fake preserves the prompt without pretending to understand it.
type Fake struct{}

func (Fake) Interpret(ctx context.Context, in Input) (Brief, error) {
	if err := ctx.Err(); err != nil {
		return Brief{}, err
	}
	if err := in.Validate(); err != nil {
		return Brief{}, err
	}
	return Brief{
		Premise:    strings.TrimSpace(in.Prompt),
		Characters: []string{}, Setting: "unspecified", Style: "unspecified",
		Assumptions: []string{"Fake adapter: character, setting, and style extraction is not implemented."},
		Questions:   []string{},
	}, nil
}
