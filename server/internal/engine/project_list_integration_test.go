//go:build integration

package engine_test

import (
	"context"
	"errors"
	"nori/studio/server/internal/domain/project"
	"nori/studio/server/internal/platform/apperr"
	"nori/studio/server/internal/providers/fake"
	"testing"
)

func TestOwnedProjectPaginationAndSearch(t *testing.T) {
	f := setup(t, fake.Interpreter{})
	ctx := context.Background()
	bob := secondOwner(t, f)
	for _, title := range []string{"Rain one", "Rain two", "100% film", "Other"} {
		if _, err := f.projects.Create(ctx, f.owner, title); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := f.projects.Create(ctx, bob, "Rain secret"); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(ctx, `UPDATE projects SET created_at='2026-01-01' WHERE owner_user_id=$1`, f.owner); err != nil {
		t.Fatal(err)
	}
	first, err := f.projects.List(ctx, f.owner, project.ListParams{Limit: 1, Search: "rAiN"})
	if err != nil || len(first.Items) != 1 || first.NextCursor == nil {
		t.Fatalf("page=%+v err=%v", first, err)
	}
	second, err := f.projects.List(ctx, f.owner, project.ListParams{Limit: 1, Search: "rain", Cursor: *first.NextCursor})
	if err != nil || len(second.Items) != 1 || second.NextCursor != nil || first.Items[0].ID <= second.Items[0].ID {
		t.Fatalf("second=%+v err=%v", second, err)
	}
	literal, err := f.projects.List(ctx, f.owner, project.ListParams{Search: "%"})
	if err != nil || len(literal.Items) != 1 || literal.Items[0].Title != "100% film" {
		t.Fatalf("literal search=%+v err=%v", literal, err)
	}
	foreign, err := f.projects.List(ctx, bob, project.ListParams{})
	if err != nil || len(foreign.Items) != 1 || foreign.Items[0].Title != "Rain secret" {
		t.Fatalf("ownership=%+v err=%v", foreign, err)
	}
	for _, params := range []project.ListParams{{Limit: -1}, {Limit: 101}, {Cursor: "!"}} {
		_, err := f.projects.List(ctx, f.owner, params)
		var validation *apperr.ValidationError
		if !errors.As(err, &validation) {
			t.Fatalf("invalid params accepted: %+v %v", params, err)
		}
	}
}
