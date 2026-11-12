//go:build integration

package engine_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"nori/studio/server/internal/domain/prompt"
	"nori/studio/server/internal/engine"
	"nori/studio/server/internal/engine/ops/enhance"
	"nori/studio/server/internal/engine/ops/video"
	"nori/studio/server/internal/providers/fake"
)

func TestEnhancementPersistsSourceAndBlockers(t *testing.T) {
	op := enhance.NewOperation(fake.Enhancer{}, fake.EnhancerProvider, fake.EnhancerModel)
	f := setup(t, fake.Interpreter{}, op)
	f.start(t)
	ctx := context.Background()
	for _, tc := range []struct {
		key, original string
		blocked       bool
	}{
		{"ready", "She realizes her brother betrayed her. She hides it. No tears.", false},
		{"blocked", strings.Repeat("猫", 2001), true},
	} {
		in := prompt.Input{OriginalPrompt: tc.original, TargetModel: "fake-h3", Task: prompt.TextToVideo, Constraints: []string{"Do not add dialogue."}, Settings: prompt.VideoSettings{DurationSeconds: 6}}
		raw, err := json.Marshal(in)
		if err != nil {
			t.Fatal(err)
		}
		submission := engine.Submission{Operation: enhance.Name, Input: raw}
		job, err := f.service.Submit(ctx, f.owner, tc.key, submission)
		if err != nil {
			t.Fatal(err)
		}
		done := await(t, f, job.ID, "succeeded")
		if len(done.Results) != 1 || done.Results[0].Kind != "prompt_enhancement" || done.Results[0].SchemaVersion != 1 {
			t.Fatalf("artifacts=%+v", done.Results)
		}
		var result prompt.Result
		if err := json.Unmarshal(done.Results[0].Content, &result); err != nil {
			t.Fatal(err)
		}
		if result.Input.OriginalPrompt != tc.original || result.Input.TemplateVersion != 1 || (len(result.UnresolvedConstraints) > 0) != tc.blocked || result.Enhancement.Validate() != nil {
			t.Fatalf("result=%+v", result)
		}
		if tc.blocked && result.GenerationPrompt != "" {
			t.Fatal("blocked result has a usable prompt")
		}
		if !tc.blocked {
			if !strings.HasPrefix(result.GenerationPrompt, tc.original) {
				t.Fatal("source wording lost")
			}
			generation := video.Input{Prompt: result.GenerationPrompt, DurationSeconds: result.Input.Settings.DurationSeconds, Resolution: result.Input.Settings.Resolution}
			if err := generation.Validate(); err != nil {
				t.Fatalf("enhanced result cannot be generated: %v", err)
			}
		}
		if len(done.Attempts) != 1 || done.Attempts[0].Model == nil || *done.Attempts[0].Model != fake.EnhancerModel {
			t.Fatalf("attempts=%+v", done.Attempts)
		}
		replay, err := f.service.Submit(ctx, f.owner, tc.key, submission)
		if err != nil || replay.ID != job.ID {
			t.Fatalf("replay=%+v err=%v", replay, err)
		}
		var executionQueue string
		if err := f.pool.QueryRow(ctx, `SELECT queue FROM river_job WHERE id=(SELECT river_job_id FROM jobs WHERE id=$1)`, job.ID).Scan(&executionQueue); err != nil || executionQueue != "llm" {
			t.Fatalf("queue=%s err=%v", executionQueue, err)
		}
	}
	var count int
	if err := f.pool.QueryRow(ctx, `SELECT count(*) FROM jobs`).Scan(&count); err != nil || count != 2 {
		t.Fatalf("unexpected downstream job: count=%d err=%v", count, err)
	}
}
