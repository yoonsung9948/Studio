package engine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
)

// JobArgs is the River payload for every operation. It holds only the job ID;
// the worker loads the operation and input from generation_jobs.
type JobArgs struct {
	JobID string `json:"jobId"`
}

func (JobArgs) Kind() string { return "generation_job" }

// Worker runs any registered operation: it claims the job, runs the operation
// outside a transaction, then publishes the result or records the failure.
type Worker struct {
	river.WorkerDefaults[JobArgs]
	Pool     *pgxpool.Pool
	Registry *Registry
}

func (w *Worker) Work(ctx context.Context, task *river.Job[JobArgs]) error {
	tx, err := w.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var inputJSON []byte
	var operation, status string
	var version, previousAttempt int
	err = tx.QueryRow(ctx, `SELECT operation,input_json,status,input_schema_version,active_attempt FROM generation_jobs WHERE id=$1 FOR UPDATE`, task.Args.JobID).Scan(&operation, &inputJSON, &status, &version, &previousAttempt)
	if err != nil {
		return err
	}
	if status == "succeeded" || status == "failed" || task.Attempt <= previousAttempt {
		return nil
	}
	if _, err = tx.Exec(ctx, `UPDATE job_attempts SET status='interrupted',finished_at=now() WHERE job_id=$1 AND status='running'`, task.Args.JobID); err != nil {
		return err
	}
	op, known := w.Registry.Get(operation)
	provider, model := "unknown", "unknown"
	if known {
		provider, model = op.Provider()
	}
	if _, err = tx.Exec(ctx, `INSERT INTO job_attempts(job_id,number,provider,model,status) VALUES($1,$2,$3,$4,'running')`, task.Args.JobID, task.Attempt, provider, model); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE generation_jobs SET status='running',active_attempt=$2,error_code=NULL,error_message=NULL,updated_at=now() WHERE id=$1`, task.Args.JobID, task.Attempt); err != nil {
		return err
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}

	if !known {
		return w.fail(ctx, task, "unsupported_operation", "No worker can run this operation.", false)
	}
	if version != op.InputVersion() {
		return w.fail(ctx, task, "invalid_input", "Stored job input is invalid.", false)
	}
	out, err := op.Run(ctx, inputJSON)
	if err != nil {
		var runErr *RunError
		if errors.As(err, &runErr) {
			return w.fail(ctx, task, runErr.Code, runErr.Message, runErr.Retryable)
		}
		return w.fail(ctx, task, "operation_error", "Operation failed.", true)
	}
	if out.Artifact.Kind == "" || out.Artifact.SchemaVersion < 1 || !json.Valid(out.Artifact.Content) {
		return w.fail(ctx, task, "invalid_output", "Operation returned an invalid artifact.", false)
	}
	tx, err = w.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	// Fence late attempts before publishing their results.
	var active int
	if err = tx.QueryRow(ctx, `SELECT active_attempt FROM generation_jobs WHERE id=$1 FOR UPDATE`, task.Args.JobID).Scan(&active); err != nil {
		return err
	}
	if active != task.Attempt {
		return nil
	}
	if _, err = tx.Exec(ctx, `INSERT INTO artifacts(id,project_id,producer_job_id,kind,schema_version,content_json) SELECT $2,project_id,id,$3,$4,$5 FROM generation_jobs WHERE id=$1 ON CONFLICT(producer_job_id) DO NOTHING`, task.Args.JobID, uuid.NewString(), out.Artifact.Kind, out.Artifact.SchemaVersion, out.Artifact.Content); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE job_attempts SET status='succeeded',provider=COALESCE(NULLIF($3,''),provider),model=COALESCE(NULLIF($4,''),model),finished_at=now() WHERE job_id=$1 AND number=$2`, task.Args.JobID, task.Attempt, out.Provider, out.Model); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE generation_jobs SET status='succeeded',error_code=NULL,error_message=NULL,updated_at=now() WHERE id=$1`, task.Args.JobID); err != nil {
		return err
	}
	if _, err = river.JobCompleteTx[*riverpgxv5.Driver](ctx, tx, task); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (w *Worker) fail(ctx context.Context, task *river.Job[JobArgs], code, message string, retryable bool) error {
	// The worker context may have been canceled during shutdown.
	saveCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	tx, err := w.Pool.Begin(saveCtx)
	if err != nil {
		return err
	}
	defer tx.Rollback(saveCtx)
	var active int
	if err = tx.QueryRow(saveCtx, `SELECT active_attempt FROM generation_jobs WHERE id=$1 FOR UPDATE`, task.Args.JobID).Scan(&active); err != nil {
		return err
	}
	if active != task.Attempt {
		return nil
	}
	terminal := !retryable || task.Attempt >= task.MaxAttempts
	status := "queued"
	if terminal {
		status = "failed"
	}
	if _, err = tx.Exec(saveCtx, `UPDATE job_attempts SET status='failed',error_code=$3,error_message=$4,finished_at=now() WHERE job_id=$1 AND number=$2`, task.Args.JobID, task.Attempt, code, message); err != nil {
		return err
	}
	if _, err = tx.Exec(saveCtx, `UPDATE generation_jobs SET status=$2,error_code=$3,error_message=$4,updated_at=now() WHERE id=$1`, task.Args.JobID, status, code, message); err != nil {
		return err
	}
	if err = tx.Commit(saveCtx); err != nil {
		return err
	}
	failure := errors.New(message)
	if terminal {
		return river.JobCancel(failure)
	}
	return fmt.Errorf("%s: %w", code, failure)
}
