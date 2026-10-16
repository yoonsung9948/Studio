package app

import "testing"

func TestLoadConfigQueueOverrides(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/test")
	t.Setenv("QUEUE_VIDEO_WORKERS", "7")
	cfg, err := LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Queues.Video != 7 || cfg.Queues.LLM != 10 {
		t.Fatalf("got %+v", cfg.Queues)
	}
	for _, bad := range []string{"0", "-1", "three"} {
		t.Setenv("QUEUE_VIDEO_WORKERS", bad)
		if _, err := LoadConfig(); err == nil {
			t.Errorf("accepted QUEUE_VIDEO_WORKERS=%q", bad)
		}
	}
}
