package prompts

import (
	_ "embed"
	"errors"
	"fmt"
	"slices"

	"nori/studio/server/internal/domain/prompt"
)

// Template versions are immutable; changing instructions requires a new version.
type Template struct {
	ID                  string
	Version             int
	TargetModel         string
	Task                string
	SystemPrompt        string
	MaxPromptCharacters int
	MinDurationSeconds  int
	MaxDurationSeconds  int
	DefaultResolution   string
	Resolutions         []string
}

//go:embed templates/fake-h3-text-to-video-v1.txt
var fakeVideoInstructions string

// EnhancementTemplate returns the selected version, or the current version when version is zero.
func EnhancementTemplate(model, task string, version int) (Template, bool) {
	if model != "fake-h3" || task != "text_to_video" || (version != 0 && version != 1) {
		return Template{}, false
	}
	return Template{
		ID: "fake-h3-text-to-video", Version: 1, TargetModel: model, Task: task,
		SystemPrompt: fakeVideoInstructions, MaxPromptCharacters: 2000,
		MinDurationSeconds: 4, MaxDurationSeconds: 15,
		DefaultResolution: "768P", Resolutions: []string{"768P", "2K"},
	}, true
}

func (t Template) ValidateInput(in prompt.Input) error {
	if in.Settings.DurationSeconds < t.MinDurationSeconds || in.Settings.DurationSeconds > t.MaxDurationSeconds {
		return fmt.Errorf("durationSeconds must be between %d and %d for the target model", t.MinDurationSeconds, t.MaxDurationSeconds)
	}
	if !slices.Contains(t.Resolutions, in.Settings.Resolution) {
		return errors.New("unsupported resolution for the target model")
	}
	return nil
}
