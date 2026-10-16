# Studio backend

Minimal durable workflow: submit a prompt, execute a fake Claude interpretation, and retrieve a persisted creative brief. No API key is needed.

## Run locally

Requires Go 1.27.1+ and PostgreSQL 17. The optional Compose file starts PostgreSQL on port 5433 with a persistent volume.

```sh
docker compose up -d --wait
export DATABASE_URL='postgres://studio:studio@127.0.0.1:5433/studio?sslmode=disable'
go run ./cmd/studio migrate
go run ./cmd/studio
```

If Docker Compose is unavailable, start PostgreSQL directly instead:

```sh
docker run -d --name nori-studio-postgres \
  -e POSTGRES_USER=studio -e POSTGRES_PASSWORD=studio -e POSTGRES_DB=studio \
  -p 127.0.0.1:5433:5432 \
  -v studio_postgres:/var/lib/postgresql/data postgres:17-alpine
```

Wait until PostgreSQL accepts connections before migrating. On subsequent runs, use `docker start nori-studio-postgres`.

The server binds to `127.0.0.1:8080`. `HTTP_ADDR` overrides this. Environment variables are read from the process; `.env.example` is documentation, not automatically loaded. Migrations are an explicit command, not a side effect of starting the API.

This is a single-user local development server. Authentication and project membership are not implemented. Keep it on loopback until authorization is added. The frontend is unchanged.

## Submit and retrieve work

Create a project:

```sh
curl -sS http://127.0.0.1:8080/api/v1/projects \
  -H 'Content-Type: application/json' \
  -d '{"title":"First film"}'
```

Use its `id` in the submission URL:

```sh
curl -i http://127.0.0.1:8080/api/v1/projects/PROJECT_ID/jobs \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: first-brief' \
  -d '{"operation":"interpret_brief","input":{"prompt":"A woman discovers a letter in a café."}}'
```

The response is `202 Accepted`, with a job ID and a `Location` header. Poll that URL:

```sh
curl -sS http://127.0.0.1:8080/api/v1/jobs/JOB_ID
```

A completed response includes:

```json
{
  "id": "...",
  "projectId": "...",
  "operation": "interpret_brief",
  "inputSchemaVersion": 1,
  "input": {"prompt":"A woman discovers a letter in a café."},
  "status": "succeeded",
  "result": {
    "id": "...",
    "kind": "creative_brief",
    "schemaVersion": 1,
    "content": {
      "premise": "A woman discovers a letter in a café.",
      "characters": [],
      "setting": "unspecified",
      "style": "unspecified",
      "assumptions": ["Fake adapter: character, setting, and style extraction is not implemented."],
      "questions": []
    },
    "createdAt": "..."
  },
  "attempts": [{
    "number": 1,
    "provider": "fake_claude",
    "model": "fake-v1",
    "status": "succeeded",
    "startedAt": "...",
    "finishedAt": "..."
  }],
  "createdAt": "...",
  "updatedAt": "..."
}
```

The fake preserves intent and leaves unknown fields explicit. It does not perform semantic extraction or simulate an actual film script.

### API

| Method | Path | Behavior |
|---|---|---|
| POST | `/api/v1/projects` | Create a project; `201` |
| POST | `/api/v1/projects/{id}/jobs` | Submit or replay work; `202` |
| GET | `/api/v1/jobs/{id}` | Job status, artifact, and attempts; `200` |
| GET | `/healthz` | Process liveness |
| GET | `/readyz` | Database connectivity |

Errors use `{"error":{"code":"...","message":"..."}}`. Validation returns `400`, missing resources `404`, conflicting idempotency keys `409`, and internal failures `500`.

The key is required and scoped to a project. Reusing it with the same normalized input returns the existing job, including its current status. Different input returns a conflict. Prompt whitespace is trimmed before storage. Use a new key to request another result, including after a failed job.

## Boundaries

- `cmd/studio`: parses the command (`studio` or `studio migrate`) and calls `app`.
- `internal/app`: configuration, dependency wiring, and process lifecycle (HTTP server, workers, shutdown).
- `internal/httpapi`: transport and request validation, one file per resource (`projects.go`, `jobs.go`); `respond.go` maps errors to status codes.
- `internal/domain/project`: project creation.
- `internal/engine`: operation registry, job submission, persistence, attempts, the generic worker, and recovery.
- `internal/engine/ops/brief`: the `interpret_brief` operation: typed input/output, the interpreter interface, and the fake adapter.
- `internal/platform/db`: connection pool and embedded application and River migrations.
- `internal/platform/queue`: River client configuration and the four queues: `llm`, `image`, `video` and `render`. Each operation declares its queue (`interpret_brief` runs on `llm`); per-queue concurrency defaults to 10/4/3/2 and can be overridden with `QUEUE_LLM_WORKERS`, `QUEUE_IMAGE_WORKERS`, `QUEUE_VIDEO_WORKERS` and `QUEUE_RENDER_WORKERS`. Limits are per process.
- `internal/platform/apperr`: errors shared across packages (validation, not found, conflict).

`domain` and `platform` never import `engine` or `httpapi`; `app` is the only package that sees every concrete type.

PostgreSQL stores projects, jobs, attempts, artifacts, and River tasks. Jobs identify logical work; attempts identify executions; artifacts contain immutable output. Queue arguments contain only the domain job ID. Workers load the persisted input rather than browser state.

Submission and enqueueing commit together. Result publication, successful attempt state, domain completion, and River completion also commit together. Concurrent submissions sharing an idempotency key are serialized. Attempt numbers fence late results, and a unique producer constraint prevents duplicate artifacts. Reads use a consistent database snapshot.

The fake operation retries failures up to three total attempts with River backoff. Invalid output fails immediately. Attempts abandoned by a crash become interrupted when a replacement starts. River rescues stuck execution after the configured two-minute threshold, subject to its maintenance interval. Exhausted tasks are reconciled to failed domain jobs at startup and every 30 seconds. Polling also exposes terminal queue failures before reconciliation.

Shutdown stops HTTP requests, allows workers to finish, and then cancels outstanding work. The fake is safe to replay. Real paid adapters must add submission reconciliation or provider idempotency before relying on automatic retries; this implementation does not claim exactly-once external execution. Provider task/request columns are reserved for that integration.

To add an operation, implement `engine.Operation` (name, input version, `Canonicalize` for submission validation, `Provider`, and `Run` returning the artifact) in its own package under `internal/engine/ops`, then add it to the registry in `internal/app/serve.go`. One generic worker (`engine.Worker`) runs every operation and owns claiming, attempt fencing, publishing, and failure handling; operations return `*engine.RunError` to choose the failure code and whether to retry. Keep the job envelope and artifact model. Workflow dependencies, approvals, media storage, authentication, and video generation are intentionally deferred.

## Verification

```sh
go test -race ./...
go vet ./...
export TEST_DATABASE_URL='postgres://studio:studio@127.0.0.1:5433/studio?sslmode=disable'
go test -race -tags=integration ./...
```

Integration tests require a local PostgreSQL role that can create databases. Each test creates and drops its own uniquely named database; application tables in the supplied database are not modified. The suite covers the HTTP workflow, concurrent idempotency, rollback of enqueueing, persisted queued work, restart during execution, retries, invalid provider output, and crash reconciliation.
