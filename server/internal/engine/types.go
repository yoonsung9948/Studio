package engine

import (
	"encoding/json"
	"time"
)

type Failure struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type Job struct {
	ID                 string          `json:"id"`
	ProjectID          string          `json:"projectId"`
	Operation          string          `json:"operation"`
	InputSchemaVersion int             `json:"inputSchemaVersion"`
	Input              json.RawMessage `json:"input"`
	Status             string          `json:"status"`
	Result             *Artifact       `json:"result,omitempty"`
	Error              *Failure        `json:"error,omitempty"`
	CreatedAt          time.Time       `json:"createdAt"`
	UpdatedAt          time.Time       `json:"updatedAt"`
}

type Artifact struct {
	ID            string          `json:"id"`
	Kind          string          `json:"kind"`
	SchemaVersion int             `json:"schemaVersion"`
	Content       json.RawMessage `json:"content"`
	CreatedAt     time.Time       `json:"createdAt"`
}

type Attempt struct {
	Number     int        `json:"number"`
	Provider   string     `json:"provider"`
	Model      string     `json:"model"`
	Status     string     `json:"status"`
	Error      *Failure   `json:"error,omitempty"`
	StartedAt  time.Time  `json:"startedAt"`
	FinishedAt *time.Time `json:"finishedAt,omitempty"`
}

type JobDetail struct {
	Job
	Attempts []Attempt `json:"attempts"`
}
