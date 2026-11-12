package fake

import (
	"context"
	"reflect"
	"strings"
	"testing"

	"nori/studio/server/internal/domain/prompt"
	"nori/studio/server/internal/providers"
)

func TestEnhancerPreservesWordingAndExplicitConstraints(t *testing.T) {
	original := "  She realizes her brother betrayed her. She hides it.\nShe says: \"I'm fine.\" No tears.  "
	req := providers.EnhancementRequest{Input: prompt.Input{OriginalPrompt: original, TargetModel: "fake-h3", Task: prompt.TextToVideo, Constraints: []string{"Do not show the brother.", "대사를 바꾸지 마세요."}, Settings: prompt.VideoSettings{DurationSeconds: 6, Resolution: "768P"}, TemplateVersion: 1}, MaxPromptCharacters: 2000}
	got, err := (Enhancer{}).Enhance(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	if got.GenerationPrompt != original+"\n\nRequired constraints:\n- Do not show the brother.\n- 대사를 바꾸지 마세요." || len(got.Assumptions) != 0 || len(got.UnresolvedConstraints) != 0 {
		t.Fatalf("result=%+v", got)
	}
	again, err := (Enhancer{}).Enhance(context.Background(), req)
	if err != nil || !reflect.DeepEqual(got, again) {
		t.Fatalf("nondeterministic result=%+v err=%v", again, err)
	}
	req.Input.Constraints = nil
	got, err = (Enhancer{}).Enhance(context.Background(), req)
	if err != nil || got.GenerationPrompt != original {
		t.Fatalf("rewrote original: %+v err=%v", got, err)
	}
}

func TestEnhancerBlocksRatherThanTruncating(t *testing.T) {
	in := prompt.Input{OriginalPrompt: strings.Repeat("猫", 2001), TargetModel: "fake-h3", Task: prompt.TextToVideo, Settings: prompt.VideoSettings{DurationSeconds: 6, Resolution: "768P"}, TemplateVersion: 1}
	out, err := (Enhancer{}).Enhance(context.Background(), providers.EnhancementRequest{Input: in, MaxPromptCharacters: 2000})
	if err != nil || out.GenerationPrompt != "" || len(out.UnresolvedConstraints) != 1 || out.Validate() != nil {
		t.Fatalf("result=%+v err=%v", out, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := (Enhancer{}).Enhance(ctx, providers.EnhancementRequest{Input: in}); err != context.Canceled {
		t.Fatalf("cancel=%v", err)
	}
}
