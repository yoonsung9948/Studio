package image

import (
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
)

type Settings struct {
	AspectRatio string `json:"aspectRatio"`
}

type Reference struct {
	AssetID string `json:"assetId"`
	Role    string `json:"role"`
}

type Input struct {
	Prompt        string      `json:"prompt"`
	Model         string      `json:"model"`
	Settings      Settings    `json:"settings"`
	References    []Reference `json:"references"`
	SourceAssetID string      `json:"sourceAssetId,omitempty"`
}

func (in Input) Validate() error {
	if strings.TrimSpace(in.Prompt) == "" || !utf8.ValidString(in.Prompt) || utf8.RuneCountInString(in.Prompt) > 10000 {
		return errors.New("prompt must contain 1-10000 valid UTF-8 characters")
	}
	if in.SourceAssetID != "" {
		if _, err := uuid.Parse(in.SourceAssetID); err != nil {
			return errors.New("invalid source asset ID")
		}
	}
	if len(in.References) > 8 {
		return errors.New("at most 8 reference images are allowed")
	}
	seen := map[Reference]bool{}
	for _, ref := range in.References {
		if _, err := uuid.Parse(ref.AssetID); err != nil {
			return errors.New("invalid reference asset ID")
		}
		switch ref.Role {
		case "identity", "visual_style", "setting", "continuity":
		default:
			return errors.New("unsupported image reference role")
		}
		if seen[ref] {
			return errors.New("duplicate image reference")
		}
		seen[ref] = true
	}
	return nil
}

type Result struct {
	FileKey       string `json:"fileKey"`
	ContentType   string `json:"contentType"`
	SizeBytes     int64  `json:"sizeBytes"`
	Model         string `json:"model"`
	SourceAssetID string `json:"sourceAssetId,omitempty"`
}
