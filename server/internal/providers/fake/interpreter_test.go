package fake

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"nori/studio/server/internal/domain/interpretation"
)

func TestFakePreservesIntent(t *testing.T) {
	adapter := Interpreter{}
	input := interpretation.Input{Prompt: "  A woman discovers a letter in a café.  "}
	first, err := adapter.Interpret(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	second, err := adapter.Interpret(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(first, second) {
		t.Fatal("fake output must be deterministic")
	}
	var call struct {
		Prompt          string `json:"prompt"`
		DurationSeconds int    `json:"durationSeconds"`
		Resolution      string `json:"resolution"`
	}
	if err := json.Unmarshal(first.Input, &call); err != nil {
		t.Fatal(err)
	}
	if first.Action != interpretation.ProposeOperation || first.Operation != "generate_video" || call.DurationSeconds != 6 || call.Resolution != "768P" {
		t.Fatalf("unexpected proposal %+v", first)
	}
	if call.Prompt != strings.TrimSpace(input.Prompt) {
		t.Fatal("prompt was not preserved")
	}
	if err := first.Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestFakeHonorsCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := (Interpreter{}).Interpret(ctx, interpretation.Input{Prompt: "test"}); err != context.Canceled {
		t.Fatalf("got %v", err)
	}
}

func TestFakeAsksForShorterVideoPrompt(t *testing.T) {
	out, err := (Interpreter{}).Interpret(context.Background(), interpretation.Input{Prompt: strings.Repeat("é", 2001)})
	if err != nil || out.Action != interpretation.ClarificationNeeded || out.Validate() != nil {
		t.Fatalf("got %+v %v", out, err)
	}
}
