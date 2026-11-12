package prompt

import (
	"errors"
	"strings"
	"unicode/utf8"
)

const TextToVideo = "text_to_video"

// Input records the user's wording and the selected generation target.
type Input struct {
	OriginalPrompt  string        `json:"originalPrompt"`
	TargetModel     string        `json:"targetModel"`
	Task            string        `json:"task"`
	Constraints     []string      `json:"constraints"`
	Settings        VideoSettings `json:"settings"`
	TemplateVersion int           `json:"templateVersion"`
}

type VideoSettings struct {
	DurationSeconds int    `json:"durationSeconds"`
	Resolution      string `json:"resolution"`
}

func (i Input) Validate() error {
	if !text(i.OriginalPrompt, 10000) {
		return errors.New("originalPrompt must contain 1-10000 UTF-8 characters")
	}
	if !text(i.TargetModel, 200) || i.TargetModel != strings.TrimSpace(i.TargetModel) {
		return errors.New("targetModel is required without surrounding whitespace")
	}
	if i.Task != TextToVideo {
		return errors.New("only text_to_video enhancement is supported")
	}
	if i.TemplateVersion < 1 {
		return errors.New("templateVersion must be positive")
	}
	if i.Settings.DurationSeconds < 1 {
		return errors.New("durationSeconds must be positive")
	}
	if !text(i.Settings.Resolution, 200) {
		return errors.New("resolution is required")
	}
	if len(i.Constraints) > 20 {
		return errors.New("at most 20 constraints are supported")
	}
	for _, constraint := range i.Constraints {
		if !text(constraint, 2000) {
			return errors.New("constraints must contain 1-2000 UTF-8 characters")
		}
	}
	return nil
}

// Enhancement is blocked when any constraint remains unresolved.
type Enhancement struct {
	GenerationPrompt      string   `json:"generationPrompt"`
	Assumptions           []string `json:"assumptions"`
	UnresolvedConstraints []string `json:"unresolvedConstraints"`
}

func (e Enhancement) Validate() error {
	if e.Assumptions == nil || e.UnresolvedConstraints == nil {
		return errors.New("assumptions and unresolvedConstraints must be arrays")
	}
	for _, items := range [][]string{e.Assumptions, e.UnresolvedConstraints} {
		if len(items) > 20 {
			return errors.New("at most 20 explanations are supported")
		}
		for _, item := range items {
			if !text(item, 2000) {
				return errors.New("explanations must contain 1-2000 UTF-8 characters")
			}
		}
	}
	if len(e.UnresolvedConstraints) > 0 {
		if e.GenerationPrompt != "" {
			return errors.New("blocked enhancement must not include a generation prompt")
		}
	} else if !text(e.GenerationPrompt, 10000) {
		return errors.New("generationPrompt is required when there are no unresolved constraints")
	}
	return nil
}

type Result struct {
	Input      Input  `json:"input"`
	TemplateID string `json:"templateId"`
	Enhancement
}

func text(value string, limit int) bool {
	return strings.TrimSpace(value) != "" && utf8.ValidString(value) && utf8.RuneCountInString(value) <= limit
}
