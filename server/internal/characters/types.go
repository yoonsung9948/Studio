package characters

import (
	"strings"
	"time"
	"unicode/utf8"

	imageinput "nori/studio/server/internal/domain/image"
	"nori/studio/server/internal/engine"
	"nori/studio/server/internal/platform/apperr"
)

var views = []string{"front", "three_quarter", "profile", "right_profile", "full_body", "back"}

func validView(view string) bool {
	for _, v := range views {
		if v == view {
			return true
		}
	}
	return false
}

func invalid(message string) error { return &apperr.ValidationError{Message: message} }

func conflict(code, message string) error { return &apperr.ConflictError{Code: code, Message: message} }

type Character struct {
	ID                 string    `json:"id"`
	Name               string    `json:"name"`
	Appearance         string    `json:"appearance"`
	Notes              string    `json:"notes"`
	AppearanceRevision int       `json:"appearanceRevision"`
	CreatedAt          time.Time `json:"createdAt"`
	UpdatedAt          time.Time `json:"updatedAt"`
}

type View struct {
	Type              string  `json:"type"`
	SelectedVersionID *string `json:"selectedVersionId"`
	Stale             bool    `json:"stale"`
}

type Detail struct {
	Character
	CanonicalVersionID *string `json:"canonicalVersionId"`
	Views              []View  `json:"views"`
}

type CreateInput struct {
	Name       string `json:"name"`
	Appearance string `json:"appearance"`
	Notes      string `json:"notes"`
}

type UpdateInput struct {
	Name       *string `json:"name"`
	Appearance *string `json:"appearance"`
	Notes      *string `json:"notes"`
}

func (in *CreateInput) normalize() error {
	in.Name = strings.TrimSpace(in.Name)
	in.Appearance = strings.TrimSpace(in.Appearance)
	for _, field := range []struct {
		name, value string
		max         int
	}{{"name", in.Name, 100}, {"appearance", in.Appearance, 3000}, {"notes", in.Notes, 2000}} {
		if !utf8.ValidString(field.value) || utf8.RuneCountInString(field.value) > field.max {
			return invalid(field.name + " is too long or contains invalid UTF-8")
		}
	}
	if in.Name == "" {
		return invalid("name is required")
	}
	return nil
}

type Version struct {
	ID                      string    `json:"id"`
	CharacterID             string    `json:"characterId"`
	View                    string    `json:"view"`
	AssetID                 string    `json:"assetId"`
	ProducerJobID           *string   `json:"producerJobId"`
	AppearanceRevision      int       `json:"appearanceRevision"`
	SourceIdentityVersionID *string   `json:"sourceIdentityVersionId"`
	Prompt                  string    `json:"prompt"`
	Approval                string    `json:"approval"`
	Stale                   bool      `json:"stale"`
	CreatedAt               time.Time `json:"createdAt"`
}

type GenerateInput struct {
	SourceVersionID string                 `json:"sourceVersionId,omitempty"`
	Views           []string               `json:"views"`
	Count           int                    `json:"count"`
	Prompt          string                 `json:"prompt"`
	Model           string                 `json:"model"`
	Settings        imageinput.Settings    `json:"settings"`
	References      []imageinput.Reference `json:"references"`
}

type Generation struct {
	ID          string       `json:"id"`
	CharacterID string       `json:"characterId"`
	CreatedAt   time.Time    `json:"createdAt"`
	Jobs        []engine.Job `json:"jobs"`
}
