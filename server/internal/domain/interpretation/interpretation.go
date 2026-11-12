package interpretation

import (
	"encoding/json"
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

type Action string

const (
	ProposeOperation    Action = "propose_operation"
	ClarificationNeeded Action = "clarification_needed"
)

// Decision proposes the next action; it never schedules work.
type Decision struct {
	Action      Action          `json:"action"`
	Operation   string          `json:"operation,omitempty"`
	Input       json.RawMessage `json:"input,omitempty"`
	Questions   []string        `json:"questions,omitempty"`
	Assumptions []string        `json:"assumptions"`
}

func (i Decision) Validate() error {
	if i.Assumptions == nil {
		return errors.New("assumptions must not be null")
	}
	switch i.Action {
	case ProposeOperation:
		if strings.TrimSpace(i.Operation) == "" || i.Operation != strings.TrimSpace(i.Operation) {
			return errors.New("proposed operation is required without surrounding whitespace")
		}
		var input map[string]json.RawMessage
		if json.Unmarshal(i.Input, &input) != nil || input == nil {
			return errors.New("operation input must be a JSON object")
		}
		if len(i.Questions) > 0 {
			return errors.New("operation proposal cannot include clarification questions")
		}
	case ClarificationNeeded:
		if i.Operation != "" || len(i.Input) > 0 {
			return errors.New("clarification cannot include an operation call")
		}
		if len(i.Questions) == 0 {
			return errors.New("clarification requires questions")
		}
		for _, question := range i.Questions {
			if strings.TrimSpace(question) == "" {
				return errors.New("clarification questions must not be blank")
			}
		}
	default:
		return errors.New("unsupported interpretation action")
	}
	return nil
}
