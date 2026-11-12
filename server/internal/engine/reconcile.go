package engine

import (
	"context"
	"github.com/jackc/pgx/v5"
	"nori/studio/server/internal/billing"
)

// Reconcile fences stopped executions and releases their unsettled reservations.
func (s *JobService) Reconcile(ctx context.Context) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, `UPDATE jobs j SET status='failed',lease=NULL,error_code='execution_stopped',error_message='Job execution stopped before a result was saved.',updated_at=now()
 WHERE j.status IN ('queued','running') AND NOT EXISTS(SELECT 1 FROM river_job r WHERE r.id=j.river_job_id AND r.state NOT IN ('discarded','cancelled','completed')) RETURNING j.id::text,j.owner_user_id::text`)
	if err != nil {
		return err
	}
	type stopped struct{ id, owner string }
	jobs, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (stopped, error) {
		var j stopped
		err := row.Scan(&j.id, &j.owner)
		return j, err
	})
	if err != nil {
		return err
	}
	for _, j := range jobs {
		if _, err := tx.Exec(ctx, `UPDATE job_attempts SET status='interrupted',finished_at=now() WHERE job_id=$1 AND status='running' AND EXISTS(SELECT 1 FROM jobs WHERE id=$1 AND owner_user_id=$2)`, j.id, j.owner); err != nil {
			return err
		}
		if err := billing.Release(ctx, tx, j.owner, j.id); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
