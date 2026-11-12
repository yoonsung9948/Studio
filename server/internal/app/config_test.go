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

func TestClerkConfiguration(t *testing.T) {
	for _, tc := range []struct {
		name, key, issuer, parties string
		valid                      bool
	}{
		{"disabled", "", "", "", true},
		{"missing issuer", "test-secret", "", "http://localhost:5173", false},
		{"missing key", "", "https://test.clerk.accounts.dev", "http://localhost:5173", false},
		{"missing parties", "test-secret", "https://test.clerk.accounts.dev", "", false},
		{"valid", "test-secret", "https://test.clerk.accounts.dev", "http://localhost:5173, https://studio.example", true},
		{"insecure issuer", "test-secret", "http://test.clerk.accounts.dev", "http://localhost:5173", false},
		{"issuer path", "test-secret", "https://test.clerk.accounts.dev/path", "http://localhost:5173", false},
		{"insecure frontend", "test-secret", "https://test.clerk.accounts.dev", "http://studio.example", false},
		{"blank party", "test-secret", "https://test.clerk.accounts.dev", "http://localhost:5173,", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("DATABASE_URL", "postgres://localhost/test")
			t.Setenv("CLERK_SECRET_KEY", tc.key)
			t.Setenv("CLERK_ISSUER", tc.issuer)
			t.Setenv("CLERK_AUTHORIZED_PARTIES", tc.parties)
			_, err := LoadConfig()
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v error=%v", tc.valid, err)
			}
		})
	}
}

func TestFakePaymentsRequireDevelopment(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/test")
	t.Setenv("PAYMENT_PROVIDER", "fake")
	t.Setenv("PAYMENT_FAKE_SECRET", "01234567890123456789012345678901")
	t.Setenv("APP_ENV", "")
	if _, err := LoadConfig(); err == nil {
		t.Fatal("fake payments enabled by default")
	}
	t.Setenv("APP_ENV", "production")
	if _, err := LoadConfig(); err == nil {
		t.Fatal("fake payments enabled in production")
	}
	t.Setenv("APP_ENV", "development")
	if _, err := LoadConfig(); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PAYMENT_FAKE_SECRET", "short")
	if _, err := LoadConfig(); err == nil {
		t.Fatal("accepted missing fake payment secret")
	}
}

func TestImageConfiguration(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/test")
	t.Setenv("IMAGE_PROVIDER", "")
	t.Setenv("OPENAI_IMAGE_MODEL", "")
	cfg, err := LoadConfig()
	if err != nil || cfg.ImageProvider != "fake" || cfg.OpenAIImageModel != "gpt-image-2.5-sunburst" {
		t.Fatalf("%+v %v", cfg, err)
	}
	t.Setenv("IMAGE_PROVIDER", "openai")
	t.Setenv("OPENAI_API_KEY", "")
	if _, err := LoadConfig(); err == nil {
		t.Fatal("accepted missing credentials")
	}
	t.Setenv("OPENAI_API_KEY", "test-key")
	if _, err := LoadConfig(); err != nil {
		t.Fatal(err)
	}
	t.Setenv("OPENAI_IMAGE_MODEL", "unrecognized")
	if _, err := LoadConfig(); err == nil {
		t.Fatal("accepted unsupported model")
	}
	t.Setenv("IMAGE_PROVIDER", "unknown")
	if _, err := LoadConfig(); err == nil {
		t.Fatal("accepted unsupported provider")
	}
}
