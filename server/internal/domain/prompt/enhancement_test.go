package prompt

import "testing"

func TestEnhancementRequiresEitherPromptOrBlockers(t *testing.T) {
	for _, tc := range []struct {
		name   string
		result Enhancement
		valid  bool
	}{
		{"ready", Enhancement{"Keep her reaction hidden.", []string{}, []string{}}, true},
		{"blocked", Enhancement{"", []string{}, []string{"Which character speaks?"}}, true},
		{"mixed", Enhancement{"Ignore the missing speaker.", []string{}, []string{"Which character speaks?"}}, false},
		{"empty", Enhancement{"", []string{}, []string{}}, false},
		{"null arrays", Enhancement{GenerationPrompt: "A scene"}, false},
		{"blank explanation", Enhancement{"", []string{}, []string{" "}}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := tc.result.Validate(); (err == nil) != tc.valid {
				t.Fatalf("valid=%v err=%v", tc.valid, err)
			}
		})
	}
}
