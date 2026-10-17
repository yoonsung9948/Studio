package engine

import (
	"encoding/json"
	"testing"
	"time"

	"nori/studio/server/internal/platform/queue"
)

func TestCheckOutcome(t *testing.T) {
	valid := []Outcome{
		Done{},
		Done{Artifacts: []ArtifactDraft{{Kind: "k", SchemaVersion: 1, Content: json.RawMessage(`{}`)}}},
		Wait{},
		Wait{State: json.RawMessage(`{"task":"t1"}`), After: 5},
		Next{Step: "render"},
		Next{Step: "render", Queue: "render", State: json.RawMessage(`[]`)},
	}
	for _, o := range valid {
		if problem := checkOutcome(o); problem != "" {
			t.Errorf("%+v rejected: %s", o, problem)
		}
	}
	invalid := []Outcome{
		nil,
		Done{Artifacts: []ArtifactDraft{{Kind: "", SchemaVersion: 1, Content: json.RawMessage(`{}`)}}},
		Done{Artifacts: []ArtifactDraft{{Kind: "k", SchemaVersion: 0, Content: json.RawMessage(`{}`)}}},
		Done{Artifacts: []ArtifactDraft{{Kind: "k", SchemaVersion: 1, Content: json.RawMessage(`{`)}}},
		Wait{After: -1},
		Wait{State: json.RawMessage(`nope`)},
		Next{},
		Next{Step: "render", Queue: "default"},
	}
	for _, o := range invalid {
		if checkOutcome(o) == "" {
			t.Errorf("%+v accepted", o)
		}
	}
}

type timedOp struct {
	Operation
	limit time.Duration
}

func (o timedOp) StepTimeout(string) time.Duration { return o.limit }

func TestStepTimeout(t *testing.T) {
	if got := stepTimeout(stubOperation{}, ""); got != DefaultStepTimeout {
		t.Errorf("default: %s", got)
	}
	if got := stepTimeout(timedOp{limit: 90 * time.Second}, "download"); got != 90*time.Second {
		t.Errorf("custom: %s", got)
	}
	if got := stepTimeout(timedOp{limit: time.Hour}, ""); got != MaxStepTimeout {
		t.Errorf("capped: %s", got)
	}
	if MaxStepTimeout >= queue.RescueAfter {
		t.Fatal("a step could outlive River's stuck-job threshold")
	}
}
