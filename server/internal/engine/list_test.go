package engine

import (
	"context"
	"encoding/base64"
	"errors"
	"strings"
	"testing"
	"time"

	"nori/studio/server/internal/platform/apperr"
)

func TestCursorRoundTripAndValidation(t *testing.T) {
	job := Job{ID: "00000000-0000-0000-0000-000000000123", CreatedAt: time.Date(2026, 1, 2, 3, 4, 5, 123456000, time.UTC)}
	token, err := encodeCursor(job)
	if err != nil {
		t.Fatal(err)
	}
	cursor, err := decodeCursor(token)
	if err != nil || cursor.ID != job.ID || !cursor.CreatedAt.Equal(job.CreatedAt) {
		t.Fatalf("cursor=%+v err=%v", cursor, err)
	}
	for _, raw := range []string{`{}`, `null`, `{"createdAt":"bad","id":"x"}`, `{"createdAt":"2026-01-01T00:00:00Z","id":"bad"}`, `{"createdAt":"0001-01-01T00:00:00Z","id":"00000000-0000-0000-0000-000000000123"}`} {
		_, err := decodeCursor(base64.RawURLEncoding.EncodeToString([]byte(raw)))
		var invalid *apperr.ValidationError
		if !errors.As(err, &invalid) {
			t.Errorf("accepted %s: %v", raw, err)
		}
	}
	for _, token := range []string{"!", strings.Repeat("a", 1025)} {
		if _, err := decodeCursor(token); err == nil {
			t.Errorf("accepted invalid token")
		}
	}
}

func TestListRejectsInvalidParametersBeforeQuery(t *testing.T) {
	s := &JobService{}
	badID := "bad"
	for _, params := range []ListJobsParams{
		{Limit: -1}, {Limit: 101}, {Cursor: "!"}, {ProjectID: &badID}, {Status: "unknown"},
	} {
		_, err := s.List(context.Background(), "00000000-0000-0000-0000-000000000123", params)
		var invalid *apperr.ValidationError
		if !errors.As(err, &invalid) {
			t.Errorf("params=%+v err=%v", params, err)
		}
	}
}
