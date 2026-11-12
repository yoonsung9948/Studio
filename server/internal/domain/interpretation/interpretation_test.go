package interpretation

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestInputValidation(t *testing.T) {
	for _, prompt := range []string{"", " \n ", strings.Repeat("a", 10001), string([]byte{0xff})} {
		if err := (Input{Prompt: prompt}).Validate(); err == nil {
			t.Errorf("accepted invalid prompt of length %d", len(prompt))
		}
	}
	if err := (Input{Prompt: strings.Repeat("é", 10000)}).Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestInterpretationValidation(t *testing.T) {
	for _, tc := range []struct {
		name, output string
		valid        bool
	}{
		{"empty", `{}`, false},
		{"proposal", `{"action":"propose_operation","operation":"generate_video","input":{"prompt":"story"},"assumptions":[]}`, true},
		{"clarification", `{"action":"clarification_needed","questions":["What should happen?"],"assumptions":[]}`, true},
		{"unknown action", `{"action":"execute","operation":"generate_video","input":{},"assumptions":[]}`, false},
		{"missing operation", `{"action":"propose_operation","input":{},"assumptions":[]}`, false},
		{"blank operation", `{"action":"propose_operation","operation":" ","input":{},"assumptions":[]}`, false},
		{"null input", `{"action":"propose_operation","operation":"generate_video","input":null,"assumptions":[]}`, false},
		{"array input", `{"action":"propose_operation","operation":"generate_video","input":[],"assumptions":[]}`, false},
		{"mixed actions", `{"action":"propose_operation","operation":"generate_video","input":{},"questions":["Which?"],"assumptions":[]}`, false},
		{"null assumptions", `{"action":"propose_operation","operation":"generate_video","input":{}}`, false},
		{"missing question", `{"action":"clarification_needed","questions":[],"assumptions":[]}`, false},
		{"blank question", `{"action":"clarification_needed","questions":[" "],"assumptions":[]}`, false},
		{"clarification with call", `{"action":"clarification_needed","operation":"generate_video","input":{},"questions":["Which?"],"assumptions":[]}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var out Decision
			if err := json.Unmarshal([]byte(tc.output), &out); err != nil {
				t.Fatal(err)
			}
			if err := out.Validate(); (err == nil) != tc.valid {
				t.Fatalf("Validate()=%v valid=%v", err, tc.valid)
			}
		})
	}
}

func TestClarificationOmitsOperationCall(t *testing.T) {
	data, err := json.Marshal(Decision{Action: ClarificationNeeded, Questions: []string{"What should happen?"}, Assumptions: []string{}})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), `"operation"`) || strings.Contains(string(data), `"input"`) {
		t.Fatalf("unexpected call: %s", data)
	}
}
