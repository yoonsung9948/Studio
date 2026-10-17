package engine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
)

// maxAttempts is the River retry budget for a job, and again after each move to another queue.
const maxAttempts = 3

// JobArgs is the River payload for every operation. It holds only the job ID;
// the worker loads the operation, input and checkpoint from generation_jobs.
type JobArgs struct {
	JobID string `json:"jobId"`
}

func (JobArgs) Kind() string { return "generation_job" }

// Worker runs one step of any registered operation per River execution: it
// claims the job, runs the step outside a transaction, then carries out the
// step's outcome (publish, wait or continue) or records the failure.
type Worker struct {
	river.WorkerDefaults[JobArgs]
	Pool     *pgxpool.Pool
	Registry *Registry
}

// claim is what an execution holds after claiming a job.
type claim struct {
	lease   string // fences writes: only the latest claim may save results
	attempt int
	op      Operation // nil if the operation is not registered
	version int
	input   json.RawMessage
	step    string
	state   json.RawMessage
}

// Timeout disables River's job timeout: Work applies a deadline to each step
// instead, because steps of one operation need very different limits.
func (w *Worker) Timeout(*river.Job[JobArgs]) time.Duration { return -1 }

func (w *Worker) Work(ctx context.Context, task *river.Job[JobArgs]) error {
	claimCtx, cancelClaim := context.WithTimeout(ctx, 10*time.Second)
	c, err := w.claim(claimCtx, task)
	cancelClaim()
	if err != nil || c == nil {
		return err
	}
	if c.op == nil {
		return w.fail(ctx, task, c, "unsupported_operation", "No worker can run this operation.", false)
	}
	if c.version != c.op.InputVersion() {
		return w.fail(ctx, task, c, "invalid_input", "Stored job input is invalid.", false)
	}
	stepCtx, cancelStep := context.WithTimeout(ctx, stepTimeout(c.op, c.step))
	outcome, err := c.op.Step(stepCtx, Run{JobID: task.Args.JobID, Attempt: c.attempt, Input: c.input, Step: c.step, State: c.state})
	cancelStep()
	if err != nil {
		var runErr *RunError
		if errors.As(err, &runErr) {
			return w.fail(ctx, task, c, runErr.Code, runErr.Message, runErr.Retryable)
		}
		return w.fail(ctx, task, c, "operation_error", "Operation failed.", true)
	}
	if problem := checkOutcome(outcome); problem != "" {
		return w.fail(ctx, task, c, "invalid_outcome", problem, false)
	}
	// Results must be saved even if shutdown cancelled the step's context.
	saveCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	switch o := outcome.(type) {
	case Done:
		return w.publish(saveCtx, task, c, o)
	case Wait:
		return w.wait(saveCtx, c, task.Args.JobID, o)
	case Next:
		return w.next(saveCtx, task, c, o)
	}
	return nil
}

// claim takes the job's lease. It continues the current attempt when resuming
// after Wait or Next, and starts a new attempt otherwise (first run, retry, or
// recovery after a crash). It returns nil when this execution should do nothing.
func (w *Worker) claim(ctx context.Context, task *river.Job[JobArgs]) (*claim, error) {
	tx, err := w.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var operation, status string
	var riverJobID int64
	var continuing bool
	c := &claim{lease: uuid.NewString()}
	err = tx.QueryRow(ctx, `SELECT operation,input_json,status,input_schema_version,active_attempt,river_job_id,step,state,continuing FROM generation_jobs WHERE id=$1 FOR UPDATE`, task.Args.JobID).
		Scan(&operation, &c.input, &status, &c.version, &c.attempt, &riverJobID, &c.step, &c.state, &continuing)
	if err != nil {
		return nil, err
	}
	// A finished job, or a River job replaced by a move to another queue, has nothing to do.
	if status == "succeeded" || status == "failed" || riverJobID != task.ID {
		return nil, nil
	}
	if op, ok := w.Registry.Get(operation); ok {
		c.op = op
	}
	if continuing {
		_, err = tx.Exec(ctx, `UPDATE generation_jobs SET lease=$2,continuing=false,updated_at=now() WHERE id=$1`, task.Args.JobID, c.lease)
	} else {
		c.attempt++
		provider, model := "unknown", "unknown"
		if c.op != nil {
			provider, model = c.op.Provider()
		}
		if _, err = tx.Exec(ctx, `UPDATE job_attempts SET status='interrupted',finished_at=now() WHERE job_id=$1 AND status='running'`, task.Args.JobID); err != nil {
			return nil, err
		}
		if _, err = tx.Exec(ctx, `INSERT INTO job_attempts(job_id,number,provider,model,status) VALUES($1,$2,$3,$4,'running')`, task.Args.JobID, c.attempt, provider, model); err != nil {
			return nil, err
		}
		_, err = tx.Exec(ctx, `UPDATE generation_jobs SET status='running',active_attempt=$2,lease=$3,continuing=false,error_code=NULL,error_message=NULL,updated_at=now() WHERE id=$1`, task.Args.JobID, c.attempt, c.lease)
	}
	if err != nil {
		return nil, err
	}
	return c, tx.Commit(ctx)
}

// holdsLease locks the job row and reports whether c is still the latest claim.
// A stale execution (one replaced by a retry or recovery) must not write results.
func holdsLease(ctx context.Context, tx pgx.Tx, jobID string, c *claim) (bool, error) {
	var lease *string
	if err := tx.QueryRow(ctx, `SELECT lease::text FROM generation_jobs WHERE id=$1 FOR UPDATE`, jobID).Scan(&lease); err != nil {
		return false, err
	}
	return lease != nil && *lease == c.lease, nil
}

// publish stores the artifacts and completes the job and its River job together.
func (w *Worker) publish(ctx context.Context, task *river.Job[JobArgs], c *claim, done Done) error {
	tx, err := w.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if ok, err := holdsLease(ctx, tx, task.Args.JobID, c); err != nil || !ok {
		return err
	}
	for i, a := range done.Artifacts {
		if _, err = tx.Exec(ctx, `INSERT INTO artifacts(id,project_id,producer_job_id,position,kind,schema_version,content_json) SELECT $2,project_id,id,$3,$4,$5,$6 FROM generation_jobs WHERE id=$1 ON CONFLICT(producer_job_id,position) DO NOTHING`, task.Args.JobID, uuid.NewString(), i, a.Kind, a.SchemaVersion, a.Content); err != nil {
			return err
		}
	}
	if _, err = tx.Exec(ctx, `UPDATE job_attempts SET status='succeeded',provider=COALESCE(NULLIF($3,''),provider),model=COALESCE(NULLIF($4,''),model),finished_at=now() WHERE job_id=$1 AND number=$2`, task.Args.JobID, c.attempt, done.Provider, done.Model); err != nil {
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

// wait checkpoints the state and snoozes the River job, freeing the worker slot.
// The next execution resumes the same step and attempt.
func (w *Worker) wait(ctx context.Context, c *claim, jobID string, o Wait) error {
	tx, err := w.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if ok, err := holdsLease(ctx, tx, jobID, c); err != nil || !ok {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE generation_jobs SET state=COALESCE($2,state),continuing=true,updated_at=now() WHERE id=$1`, jobID, jsonOrNil(o.State)); err != nil {
		return err
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	return river.JobSnooze(o.After)
}

// next checkpoints the step and state. On the same queue the River job is
// snoozed to run again at once; on another queue a new River job takes over
// in the same transaction, so the job is never left without one.
func (w *Worker) next(ctx context.Context, task *river.Job[JobArgs], c *claim, o Next) error {
	tx, err := w.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if ok, err := holdsLease(ctx, tx, task.Args.JobID, c); err != nil || !ok {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE generation_jobs SET step=$2,state=$3,continuing=true,updated_at=now() WHERE id=$1`, task.Args.JobID, o.Step, jsonOrNil(o.State)); err != nil {
		return err
	}
	if o.Queue == "" || o.Queue == task.Queue {
		if err = tx.Commit(ctx); err != nil {
			return err
		}
		return river.JobSnooze(0)
	}
	moved, err := river.ClientFromContext[pgx.Tx](ctx).InsertTx(ctx, tx, JobArgs{JobID: task.Args.JobID}, &river.InsertOpts{Queue: o.Queue, MaxAttempts: maxAttempts})
	if err != nil {
		return fmt.Errorf("move job to queue %s: %w", o.Queue, err)
	}
	if _, err = tx.Exec(ctx, `UPDATE generation_jobs SET river_job_id=$2 WHERE id=$1`, task.Args.JobID, moved.Job.ID); err != nil {
		return err
	}
	if _, err = river.JobCompleteTx[*riverpgxv5.Driver](ctx, tx, task); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// fail records a failed attempt. A retryable failure with retries left returns
// an error so River retries; the retry resumes from the last checkpointed step.
func (w *Worker) fail(ctx context.Context, task *river.Job[JobArgs], c *claim, code, message string, retryable bool) error {
	// The worker context may have been canceled during shutdown.
	saveCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	tx, err := w.Pool.Begin(saveCtx)
	if err != nil {
		return err
	}
	defer tx.Rollback(saveCtx)
	if ok, err := holdsLease(saveCtx, tx, task.Args.JobID, c); err != nil || !ok {
		return err
	}
	terminal := !retryable || task.Attempt >= task.MaxAttempts
	status := "queued"
	if terminal {
		status = "failed"
	}
	if _, err = tx.Exec(saveCtx, `UPDATE job_attempts SET status='failed',error_code=$3,error_message=$4,finished_at=now() WHERE job_id=$1 AND number=$2`, task.Args.JobID, c.attempt, code, message); err != nil {
		return err
	}
	if _, err = tx.Exec(saveCtx, `UPDATE generation_jobs SET status=$2,error_code=$3,error_message=$4,continuing=false,updated_at=now() WHERE id=$1`, task.Args.JobID, status, code, message); err != nil {
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

// jsonOrNil stores empty JSON as SQL NULL.
func jsonOrNil(v json.RawMessage) any {
	if len(v) == 0 {
		return nil
	}
	return v
}
