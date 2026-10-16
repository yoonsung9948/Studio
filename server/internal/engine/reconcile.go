package engine

import "context"

// Reconcile persists failures finalized by River after a worker crash.
func (s *JobService) Reconcile(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, `
 WITH stopped AS (
  UPDATE generation_jobs j SET status='failed', error_code='execution_stopped',
   error_message='Job execution stopped before a result was saved.',updated_at=now()
  WHERE j.status IN ('queued','running') AND NOT EXISTS (
   SELECT 1 FROM river_job r WHERE r.id=j.river_job_id
    AND r.state NOT IN ('discarded','cancelled','completed')
  ) RETURNING j.id
 )
 UPDATE job_attempts a SET status='interrupted',finished_at=now()
 FROM stopped WHERE a.job_id=stopped.id AND a.status='running'`)
	return err
}
