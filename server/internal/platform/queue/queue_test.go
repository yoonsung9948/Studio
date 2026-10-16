package queue

import "testing"

func TestDefaultLimitsCoverEveryQueue(t *testing.T) {
	queues, err := DefaultLimits().Configs()
	if err != nil {
		t.Fatal(err)
	}
	if len(queues) != len(Names) {
		t.Fatalf("got %d queues, want %d", len(queues), len(Names))
	}
	for _, name := range Names {
		if queues[name].MaxWorkers < 1 {
			t.Errorf("queue %s has no workers", name)
		}
	}
}

func TestConfigsRejectsEmptyQueue(t *testing.T) {
	limits := DefaultLimits()
	limits.Video = 0
	if _, err := limits.Configs(); err == nil {
		t.Fatal("accepted a queue with no workers")
	}
}

func TestValid(t *testing.T) {
	if !Valid(Render) || Valid("default") {
		t.Fatal("wrong queue validation")
	}
}
