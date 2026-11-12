package characters

import (
	"bytes"
	"context"
	"strings"
	"testing"

	imageop "nori/studio/server/internal/engine/ops/image"
	"nori/studio/server/internal/providers/fake"
)

func TestCharacterValidation(t *testing.T) {
	for _, in := range []CreateInput{{Name: " "}, {Name: strings.Repeat("a", 101)}, {Name: "Nori", Appearance: strings.Repeat("a", 3001)}, {Name: "Nori", Notes: strings.Repeat("a", 2001)}} {
		if err := in.normalize(); err == nil {
			t.Fatalf("accepted invalid character %+v", in)
		}
	}
	in := CreateInput{Name: " Nori ", Appearance: " Short hair ", Notes: "private"}
	if err := in.normalize(); err != nil || in.Name != "Nori" || in.Appearance != "Short hair" {
		t.Fatalf("%+v %v", in, err)
	}
}

func TestGenerationValidationAndPrompt(t *testing.T) {
	service := NewService(nil, nil, imageop.NewGenerate(fake.Image{}, nil, nil), nil)
	for _, in := range []GenerateInput{{Count: 5}, {Count: -1}, {Views: []string{"front", "front"}}, {Views: []string{"sideways"}}, {Prompt: strings.Repeat("x", 2001)}, {Model: "unsupported"}} {
		if _, err := service.normalizeGeneration(in); err == nil {
			t.Fatalf("accepted %+v", in)
		}
	}
	in, err := service.normalizeGeneration(GenerateInput{})
	if err != nil || in.Model != fake.ImageModelName || in.Count != 1 || len(in.Views) != 1 || in.Views[0] != "front" {
		t.Fatalf("%+v %v", in, err)
	}
	prompt := generationPrompt("short black hair", "profile", "neutral expression")
	for _, text := range []string{"short black hair", "Left profile", "neutral expression"} {
		if !strings.Contains(prompt, text) {
			t.Fatalf("missing %q", text)
		}
	}
}

func TestUploadValidation(t *testing.T) {
	for _, raw := range [][]byte{nil, []byte("not an image"), bytes.Repeat([]byte{1}, MaxUploadBytes+1)} {
		if _, _, err := uploadFormat(raw); err == nil {
			t.Fatal("accepted invalid upload")
		}
	}
	sample, err := (fake.Image{}).Download(context.Background(), "image-1-1.png")
	if err != nil {
		t.Fatal(err)
	}
	defer sample.Close()
	var data bytes.Buffer
	if _, err := data.ReadFrom(sample); err != nil {
		t.Fatal(err)
	}
	contentType, extension, err := uploadFormat(data.Bytes())
	if err != nil || contentType != "image/png" || extension != ".png" {
		t.Fatalf("%s %s %v", contentType, extension, err)
	}
}
