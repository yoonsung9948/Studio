package video

import (
	"errors"
	"strings"
	"unicode/utf8"
)

// Input is what clients submit for generate_video.
type Input struct {
	Prompt          string `json:"prompt"`
	DurationSeconds int    `json:"durationSeconds"`
	Resolution      string `json:"resolution"` // "768P" (default) or "2K"
}

// Limits follow MiniMax H3: whole seconds from 4 to 15, at 768P or 2K.
const (
	minSeconds      = 4
	maxSeconds      = 15
	maxPromptLength = 2000
)

var resolutions = map[string]bool{"768P": true, "2K": true}

func normalize(in *Input) {
	in.Prompt = strings.TrimSpace(in.Prompt)
	if in.Resolution == "" {
		in.Resolution = "768P"
	}
}

func (in Input) Validate() error {
	if in.Prompt == "" {
		return errors.New("prompt is required")
	}
	if !utf8.ValidString(in.Prompt) || utf8.RuneCountInString(in.Prompt) > maxPromptLength {
		return errors.New("prompt must be valid UTF-8 and at most 2000 characters")
	}
	if in.DurationSeconds < minSeconds || in.DurationSeconds > maxSeconds {
		return errors.New("durationSeconds must be a whole number from 4 to 15")
	}
	if !resolutions[in.Resolution] {
		return errors.New(`resolution must be "768P" or "2K"`)
	}
	return nil
}

// Result is the content of the "video" artifact. The file is served at
// /api/v1/files/{fileKey}.
type Result struct {
	FileKey         string `json:"fileKey"`
	ContentType     string `json:"contentType"`
	SizeBytes       int64  `json:"sizeBytes"`
	Prompt          string `json:"prompt"`
	DurationSeconds int    `json:"durationSeconds"`
	Resolution      string `json:"resolution"`
	ProviderTaskID  string `json:"providerTaskId"`
}

// state is what the job remembers between steps.
type state struct {
	TaskID string `json:"taskId"`
	File   string `json:"file,omitempty"`
}
