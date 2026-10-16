package brief

import (
	"context"
	"reflect"
	"strings"
	"testing"
)

func TestFakePreservesIntent(t *testing.T) {
	adapter := Fake{}
	input := Input{Prompt: "  A woman discovers a letter in a café.  "}
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
	if first.Premise != strings.TrimSpace(input.Prompt) {
		t.Fatal("prompt was not preserved")
	}
	if err := first.Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestInputValidation(t *testing.T) {
	for _, prompt := range []string{"", " \n ", strings.Repeat("a", 10001), string([]byte{0xff})} {
		if err := (Input{Prompt: prompt}).Validate(); err == nil {
			t.Errorf("accepted invalid prompt of length %d", len(prompt))
		}
	}
	if err := (Input{Prompt: strings.Repeat("é", 10000)}).Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestFakeHonorsCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := (Fake{}).Interpret(ctx, Input{Prompt: "test"}); err != context.Canceled {
		t.Fatalf("got %v", err)
	}
}

func TestRejectInvalidOutput(t *testing.T) {
	if err := (Brief{Premise: "story"}).Validate(); err == nil {
		t.Fatal("null lists accepted")
	}
	if err := (Brief{Characters: []string{}, Assumptions: []string{}, Questions: []string{}}).Validate(); err == nil {
		t.Fatal("empty premise accepted")
	}
}
