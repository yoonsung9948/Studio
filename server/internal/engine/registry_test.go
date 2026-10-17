package engine

import (
	"context"
	"encoding/json"
	"testing"
)

type stubOperation struct {
	name    string
	version int
	queue   string
}

func (o stubOperation) Name() string                               { return o.name }
func (o stubOperation) InputVersion() int                          { return o.version }
func (o stubOperation) Queue() string                              { return o.queue }
func (o stubOperation) Provider() (string, string)                 { return "stub", "stub-v1" }
func (o stubOperation) Step(context.Context, Run) (Outcome, error) { return Done{}, nil }
func (o stubOperation) Canonicalize(in json.RawMessage) (json.RawMessage, error) {
	return in, nil
}

func TestRegistryLookup(t *testing.T) {
	r, err := NewRegistry(stubOperation{"a", 1, "llm"}, stubOperation{"b", 2, "video"})
	if err != nil {
		t.Fatal(err)
	}
	if op, ok := r.Get("b"); !ok || op.InputVersion() != 2 {
		t.Fatalf("got %v %v", op, ok)
	}
	if _, ok := r.Get("missing"); ok {
		t.Fatal("found unregistered operation")
	}
}

func TestRegistryRejectsInvalidOperations(t *testing.T) {
	for name, ops := range map[string][]Operation{
		"duplicate":     {stubOperation{"a", 1, "llm"}, stubOperation{"a", 1, "llm"}},
		"empty name":    {stubOperation{"", 1, "llm"}},
		"zero version":  {stubOperation{"a", 0, "llm"}},
		"unknown queue": {stubOperation{"a", 1, "default"}},
	} {
		if _, err := NewRegistry(ops...); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}
