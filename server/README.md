# Studio backend

Minimal durable workflow: submit a prompt, execute a fake Claude interpretation, and retrieve a persisted request interpretation. No API key is needed.

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

Studio routes require verified Clerk authentication and are scoped to the internal user. Projects remain optional for requests, jobs, and assets. Health checks are public. The frontend uses same-origin `/api/v1` requests.

## Accounts

Migration `006_accounts.sql` adds application users and identity mappings. Clerk owns sign-in and sessions; PostgreSQL owns internal user IDs and account status. There is no local session table or webhook endpoint.

To enable authentication, set all of these before starting the server:

```sh
export CLERK_SECRET_KEY='YOUR_CLERK_SECRET_KEY'
export CLERK_ISSUER='https://your-instance.clerk.accounts.dev'
export CLERK_AUTHORIZED_PARTIES='http://localhost:5173,http://127.0.0.1:5173'
make migrate
make run
```

Use the exact Clerk token issuer (no trailing slash). Authorized parties are comma-separated frontend origins; configure the production HTTPS origin when deploying. Keep the secret key on the backend.

After signing in through Clerk, call:

```sh
curl http://127.0.0.1:8080/api/v1/me \
  -H "Authorization: Bearer $CLERK_SESSION_TOKEN"
```

The endpoint verifies the token signature, expiration, issuer, session ID, and authorized party. On first use it creates a user and identity in one transaction; concurrent requests resolve to the same user. Subsequent calls return the existing profile without overwriting it. Display names start empty because standard Clerk session tokens do not contain profile names; profile editing/synchronization is a separate change. No email-based account linking is performed.

Success returns `{id, displayName, status, createdAt, updatedAt}`. Missing/invalid authentication returns `401`, disabled local accounts return `403`, and unconfigured authentication returns `503`. The frontend uses Clerk sign-in and attaches a fresh bearer token to API requests. It resolves `/me` before displaying user-specific state. Logout is handled through Clerk.

### Ownership and existing data

Stop the old server/workers before applying migration `007_ownership.sql`, then restart with the new code. The migration adds required owners to projects, requests, jobs, and assets. PostgreSQL composite foreign keys prevent cross-owner project/job relationships. Idempotency is scoped by owner and optional project with `NULLS NOT DISTINCT`; projectless submissions are isolated too. Workers read ownership from saved job rows, register media metadata and complete jobs atomically. Client-supplied owner IDs are never accepted. Unknown inputs are rejected by strict request/operation decoding. Image jobs validate owned source/reference assets in SQL before scheduling and resolve their files again using the persisted job owner during execution.

Pre-account development records are preserved under the disabled, unlinked **Unassigned legacy data** account. No signer can authenticate as that account, and workers do not execute its pending jobs. New accounts cannot access that data. Unassigned browser-local data also remains untouched rather than being imported into the first signed-in account.

To deliberately claim server legacy data, first sign in and obtain your internal ID from `/api/v1/me`. With workers stopped, run:

```sh
go run ./cmd/studio claim-legacy YOUR_INTERNAL_USER_ID
```

This administrator-only command transfers quarantined projects, requests, jobs, and assets together. It requires an active existing target account and rolls back on conflicting idempotency keys or other constraints. It does not restart previously failed jobs. It is not exposed through HTTP. Migrations and claims are never run automatically by server startup.

### Private media

Generated media creates an owned `assets` record plus an `asset_files` entry. The corresponding job artifact includes `assetId`. Uploads can use the same ownership model without a producing job; an upload endpoint is not implemented yet.

- `GET /api/v1/assets?limit=20&cursor=...&projectId=...&kind=video` lists only owned assets (`projectId` optional).
- `GET /api/v1/assets/{id}` returns owned asset metadata and original/thumbnail/preview file IDs.
- `GET /api/v1/asset-files/{fileId}/url` checks ownership and returns `{url, expiresAt}` with a five-minute signed URL.
- `GET /api/v1/downloads/{fileId}?token=...` validates that capability and rechecks asset ownership/account status before serving bytes. No bearer header is needed for this short-lived browser media link.
- The older `/api/v1/files/{key}` route now requires a bearer token and an owned registered asset file. Knowing a storage key grants no access.

All media responses use private/no-store caching and support Range and HEAD. Signed URLs are bearer capabilities: anyone holding a valid link can use it until expiry. The frontend requests links on demand and does not persist them.

Set `MEDIA_SIGNING_KEY` to a random secret of at least 32 bytes, shared across backend instances. For example, generate a value with `openssl rand -hex 32` and store it only in the backend environment. Without it, local development uses an ephemeral key and links become invalid after restart.

Storage is currently local, outside the frontend's public directory. No R2/S3 adapter or bucket is configured. Future cloud adapters must use private buckets, with no public bucket URLs or static proxy route that bypasses asset authorization; original, thumbnail, and preview downloads must all follow the same access checks.

The frontend clears pending requests, backend watches, in-memory studio state, selection, and undo history on sign-out/account changes. Local caches are namespaced by the internal user ID returned from `/me`; previous unscoped local data is not adopted. These frontend checks supplement server authorization.


## Submit and retrieve work

Create a project:

```sh
curl -sS http://127.0.0.1:8080/api/v1/projects \
  -H "Authorization: Bearer $CLERK_SESSION_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"title":"First film"}'
```

Use its `id` as the optional `projectId` in the submission body:

```sh
curl -i http://127.0.0.1:8080/api/v1/requests \
  -H "Authorization: Bearer $CLERK_SESSION_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: first-request' \
  -d '{"projectId":"PROJECT_ID","prompt":"A woman discovers a letter in a café."}'
```

The response is `202 Accepted` with `{request, job}`. `Location` identifies the persisted request; `request.interpretationJobId` equals `job.id`. Poll the job for status and results:

```sh
curl -sS http://127.0.0.1:8080/api/v1/jobs/JOB_ID -H "Authorization: Bearer $CLERK_SESSION_TOKEN"
```

A completed response includes:

```json
{
  "id": "...",
  "projectId": "...",
  "operation": "interpret_request",
  "inputSchemaVersion": 1,
  "input": {"prompt":"A woman discovers a letter in a café."},
  "status": "succeeded",
  "results": [{
    "id": "...",
    "kind": "request_interpretation",
    "schemaVersion": 2,
    "content": {
      "action": "propose_operation",
      "operation": "generate_video",
      "input": {
        "prompt": "A woman discovers a letter in a café.",
        "durationSeconds": 6,
        "resolution": "768P"
      },
      "assumptions": ["Fake interpreter: proposes video generation without semantic analysis."]
    },
    "createdAt": "..."
  }],
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

The fake preserves the prompt and deterministically proposes `generate_video` with six seconds at 768P. It does not perform semantic analysis or schedule that proposal. Prompts longer than 2,000 characters produce a clarification decision instead.

### Image generation and editing

Run `make migrate` before restarting the backend to apply `008_asset_sources.sql`.
It links edited assets to their source with an owner-constrained foreign key.

Both endpoints require a Clerk bearer token and an `Idempotency-Key` header:

- `POST /api/v1/images/generations` creates a `generate_image` job.
- `POST /api/v1/images/edits` creates an `edit_image` job.

Generation body:

```json
{
  "prompt": "A quiet cafe at sunset",
  "model": "fake-image-v1",
  "settings": {"aspectRatio": "16:9"},
  "references": [{"assetId": "OWNED_IMAGE_ASSET_UUID", "role": "visual_style"}]
}
```

Only `prompt` is required. The model defaults to `fake-image-v1`, aspect ratio to
`1:1`, and references to an empty list. Supported ratios are `1:1`, `16:9`, and
`9:16`. References are optional (up to eight); supported roles are `identity`,
`visual_style`, `setting`, and `continuity`. Supply asset IDs, never storage keys
or provider URLs. Owned PNG/JPEG/WebP inputs up to 32 MiB are supported.

Editing uses the same fields plus required `sourceAssetId`; `prompt` contains
the editing instructions. Generation rejects `sourceAssetId`. Both bodies accept
optional `projectId`; standalone jobs and cross-project references owned by the
same user are supported. Unknown model settings are rejected.

Both return `202` with `{"job": {...}}` and `Location: /api/v1/jobs/{id}`.
Reuse the key when replaying an uncertain submission; changed input returns
`409`. Keys are scoped by user and optional project. Inaccessible inputs return
`404` without enqueuing work.

Poll the existing job endpoint. On success, its image artifact contains
`assetId`; retrieve the asset and request a signed original-file URL through the
existing media endpoints. Asset responses include nullable `sourceAssetId`.
The original remains unchanged after editing.

The worker checkpoints the provider output before storing it at
`jobs/{jobId}/image.png`. Storage retries repeat the transfer, not generation.
Asset metadata and job completion are committed together. The fake provider
returns bundled PNG placeholders for both generation and editing; it does not
perform AI inference or change the source pixels. Provider implementations must
honor the stable job ID as their submission idempotency key.

This implementation uses the existing local blob store. Sunburst, R2/S3, uploads,
and frontend submission controls are separate integrations.

### API

| Method | Path | Behavior |
|---|---|---|
| POST | `/api/v1/projects` | Create a project; `201` |
| POST | `/api/v1/requests` | Submit or replay a user prompt; optional `projectId`; `202` |
| GET | `/api/v1/requests/{id}` | Saved prompt and initial interpretation job ID; `200` |
| GET | `/api/v1/jobs` | Paginated summaries across all queues; `200` |
| GET | `/api/v1/projects` | Owned project page `{items,nextCursor}`; optional `limit`, `cursor`, and title search `q`; `200` |
| GET | `/api/v1/projects/{id}` | Retrieve a project; `200` |
| GET | `/api/v1/jobs/{id}` | Job status, current step, artifacts, and attempts; `200` |
| GET | `/healthz` | Process liveness |
| GET | `/readyz` | Database connectivity |
| GET | `/api/v1/files/{key}` | A stored media file; supports `Range` (video seeking) and `HEAD`; `404` for missing or invalid keys |

Errors use `{"error":{"code":"...","message":"..."}}`. Validation returns `400`, missing resources `404`, conflicting idempotency keys `409`, and internal failures `500`.

The key is required and scoped to the authenticated owner plus a project when supplied; projectless requests have their own scope within that same owner. Omit `projectId` or send `null` to submit without a project. Reusing it with the same normalized input returns the existing request and its interpretation job, including its current status. Different input returns a conflict. Prompt whitespace is trimmed before storage. Use a new key to request another result, including after a failed job.

## Generate a video

`generate_video` currently uses a fake video model: it costs nothing, finishes each clip after 5 seconds, and returns the file at `FAKE_VIDEO_SAMPLE` (any `.mp4`), or a bundled playable two-second H.264 demo clip if that is unset.

`generate_video` remains registered and callable internally through `JobService.Submit`. Generic public job submission has been removed; Home stops at the interpretation decision. A tool invocation endpoint can be added when tool execution is wired.

Input: `prompt` (up to 2,000 characters), `durationSeconds` (whole number, 4–15) and optional `resolution` (`"768P"`, the default, or `"2K"`). While it runs, the job's `step` shows `poll` and then `download`. The finished job's `results[0].content.fileKey` is the file to fetch from `/api/v1/files/{fileKey}`.

Provider errors are handled by kind: rate limits wait and try again, rejected requests and bad credentials fail at once, and anything else is retried. Each step has its own time limit (30 seconds; 90 for downloads), always under River's 2-minute stuck-job threshold.

## Boundaries

- `cmd/studio`: parses the command (`studio` or `studio migrate`) and calls `app`.
- `internal/app`: configuration, dependency wiring, and process lifecycle (HTTP server, workers, shutdown).
- `internal/httpapi`: transport and request validation, one file per resource (`projects.go`, `jobs.go`, `request.go`); `respond.go` maps errors to status codes.
- `internal/domain/project`: project creation.
- `internal/requests`: persisted user requests and atomic scheduling of their initial interpretation jobs.
- `internal/engine`: operation registry, job submission, persistence, attempts, the generic worker, and recovery.
- `internal/engine/ops/video`: the `generate_video` operation on the `video` queue: submit to the video model, poll until done, download into the blob store. Publishes one `video` artifact whose `fileKey` is served at `/api/v1/files/{fileKey}`.
- `internal/providers`: what the engine needs from AI services (`VideoModel`) and the errors providers return (`ErrRejected`, `ErrUnauthorized`, `RateLimitedError`); `internal/providers/fake` has free stand-ins for development.
- `internal/domain/interpretation`: interpretation input and decision, with validation.
- `internal/engine/ops/interpret`: the `interpret_request` operation.
- `internal/providers/interpreter.go`: the interpreter interface; `internal/providers/fake/interpreter.go` supplies the fake adapter.
- `internal/platform/db`: connection pool and embedded application and River migrations.
- `internal/platform/blob`: media file storage by key (`Store`), with a local-disk implementation rooted at `BLOB_DIR` (default `data/blobs`). Keys are slash-separated paths of letters, digits, `-`, `_` and `.`; the extension sets the content type. Writes are atomic: a file appears only once fully written.
- `internal/platform/queue`: River client configuration and the four queues: `llm`, `image`, `video` and `render`. Each operation declares its queue (`interpret_request` runs on `llm`); per-queue concurrency defaults to 10/4/3/2 and can be overridden with `QUEUE_LLM_WORKERS`, `QUEUE_IMAGE_WORKERS`, `QUEUE_VIDEO_WORKERS` and `QUEUE_RENDER_WORKERS`. Limits are per process.
- `internal/platform/apperr`: errors shared across packages (validation, not found, conflict).

`domain` and `platform` never import `engine` or `httpapi`; `app` is the only package that sees every concrete type.

PostgreSQL stores projects, user requests, jobs, attempts, artifacts, and River tasks. Jobs identify logical work; attempts identify executions; artifacts contain immutable output. Queue arguments contain only the domain job ID. Workers load the persisted input rather than browser state.

Submission and enqueueing commit together. Result publication, successful attempt state, domain completion, and River completion also commit together. Concurrent submissions sharing an idempotency key are serialized. Each execution claims a lease on the job; only the latest claim can publish, so a late or stale execution cannot overwrite results. A unique (job, position) constraint prevents duplicate artifacts. Reads use a consistent database snapshot.

The fake operation retries failures up to three total attempts with River backoff. Invalid output fails immediately. Attempts abandoned by a crash become interrupted when a replacement starts. River rescues stuck execution after the configured two-minute threshold, subject to its maintenance interval. Exhausted tasks are reconciled to failed domain jobs at startup and every 30 seconds. Polling also exposes terminal queue failures before reconciliation.

Shutdown stops HTTP requests, allows workers to finish, and then cancels outstanding work. The fake is safe to replay. Real paid adapters must add submission reconciliation or provider idempotency before relying on automatic retries; this implementation does not claim exactly-once external execution. Provider task/request columns are reserved for that integration.

To add an operation, create a package under `internal/engine/ops` and add it to the registry in `internal/app/serve.go`:

- **One call, one result** (LLM calls, most image calls): use `engine.Define` with typed input and output structs that implement `Validate()`. Define handles strict decoding, validation of input and output, and error codes. `interpret_request` is an example.
- **Anything longer** (async providers, several steps, several queues, several results): implement `engine.Operation` directly. `Step` runs one step and returns an outcome: `engine.Done` publishes artifacts, `engine.Wait` saves state and runs the same step again later without holding a worker slot (for polling a provider), and `engine.Next` saves state and continues with another step, optionally on another queue. A retry resumes from the last saved step, not from the beginning. Use `Run.JobID` as the provider's idempotency key so a repeated step does not start new paid work.

One generic worker (`engine.Worker`) runs every operation and owns claiming, fencing, checkpoints, publishing, and failure handling; operations return `*engine.RunError` to choose the failure code and whether to retry. Waiting does not use up retries; moving to another queue starts a fresh retry budget of three. Keep the job envelope and artifact model. Workflow dependencies, approvals, media storage, authentication, and video generation are intentionally deferred.

## Verification

```sh
go test -race ./...
go vet ./...
export TEST_DATABASE_URL='postgres://studio:studio@127.0.0.1:5433/studio?sslmode=disable'
go test -race -tags=integration ./...
```

Integration tests require a local PostgreSQL role that can create databases. Each test creates and drops its own uniquely named database; application tables in the supplied database are not modified. The suite covers the HTTP workflow, concurrent idempotency, rollback of enqueueing, persisted queued work, restart during execution, retries, invalid provider output, and crash reconciliation.

### Request interpretation rename

Run migrations before starting the updated server. Migration 003 renames stored
`interpret_brief` jobs to `interpret_request`, including queued jobs. The prompt
input remains schema version 1. Submit new requests with `interpret_request`.
New results use `request_interpretation` version 2 and contain an action decision.
Version 1 creative briefs remain historical artifacts; the frontend can still read them.
Completed `creative_brief` artifacts retain their original kind and content.

### Job listing and generalization

Run migration 004 before starting this version: application SQL now uses `jobs`
instead of `generation_jobs`. Existing records and queued River jobs are retained;
the River kind stays unchanged for compatibility. No workspaces are introduced.

`GET /api/v1/jobs` accepts `limit` (default 20, maximum 100), `cursor`, `projectId`,
`status`, and `operation`. Results are ordered by creation time and ID, newest
first. The response is `{ "items": [...], "nextCursor": "..." }`, with
`nextCursor: null` on the last page and `items: []` for an empty result. Keep
filters unchanged when requesting another page. Summaries omit inputs, artifacts,
and attempts; retrieve `/api/v1/jobs/{id}` for details. Project, provider, and model
fields may be null. Provider reporting is optional for local operations.

## Home interpretation

Home calls `POST /api/v1/requests` with a prompt and optional project ID. The request service persists a request and one `interpret_request` job on the `llm` queue in the same transaction. Migration `005_requests.sql` adds request persistence. Its result is a
`request_interpretation` artifact at schema version 2. Input remains version 1.
The interpretation output schema itself is unchanged.

A decision is either:
- `propose_operation`: an operation name, object input, and assumptions.
- `clarification_needed`: nonblank questions and assumptions, with no operation call.

The fake proposes `generate_video`; Home displays the proposal without executing
it. The combined text-to-video operation has been removed. `generate_video`
remains independently available internally through `JobService.Submit`.
Existing version 1 briefs and video artifacts are retained. Saved requests for
retired workflows are not replayed by the frontend.

### Request boundary

`POST /api/v1/requests` accepts `{ "prompt": "A café in the rain", "projectId": null }` and requires `Idempotency-Key`. Clients do not select an operation. `GET /api/v1/requests/{id}` returns the saved request; `GET /api/v1/jobs/{id}` returns execution status and results. `POST /api/v1/jobs` returns 405.

Request creation, the initial job, and River enqueueing commit together. Concurrent replays return the same request and job; conflicting prompts return 409. Existing jobs remain readable and are not backfilled as requests. Clarification messages and automatic tool execution remain subsequent features. Internal prompt enhancement is described below.

## Prompt enhancement

`enhance_prompt` is an internal operation on the `llm` queue. It is registered
alongside interpretation and generation, with a fake LLM adapter. No public job
submission endpoint or database migration is added. Home still returns an
interpretation proposal; tool invocation is not wired to enhancement yet.

Example internal job input:

```json
{
  "originalPrompt": "She realizes her brother betrayed her. She hides it.",
  "targetModel": "fake-h3",
  "task": "text_to_video",
  "constraints": ["No tears.", "Do not add dialogue."],
  "settings": {"durationSeconds": 6, "resolution": "768P"}
}
```

Submit through `JobService.Submit` with operation `enhance_prompt`. Submission
resolves and saves `templateVersion` (currently 1). A caller may explicitly pin
a version. Duration is required; omitted resolution uses the target's default.
Unsupported targets, tasks, versions, and settings are rejected before enqueueing.
Original prompt and constraint wording are retained, including whitespace.

A successful job publishes one `prompt_enhancement` artifact (schema 1):

```json
{
  "input": {
    "originalPrompt": "She realizes her brother betrayed her. She hides it.",
    "targetModel": "fake-h3",
    "task": "text_to_video",
    "constraints": ["No tears.", "Do not add dialogue."],
    "settings": {"durationSeconds": 6, "resolution": "768P"},
    "templateVersion": 1
  },
  "templateId": "fake-h3-text-to-video",
  "generationPrompt": "She realizes her brother betrayed her. She hides it.\n\nRequired constraints:\n- No tears.\n- Do not add dialogue.",
  "assumptions": [],
  "unresolvedConstraints": []
}
```

The fake copies the original prompt verbatim and appends explicit constraints.
It invents no creative details. If that exceeds the target's 2,000-character
limit, it returns an empty generation prompt and a blocking explanation, rather
than truncating requirements. Such a job succeeds: it produced a valid blocked
result. Invalid provider output fails without retries. Generation must only use
results with no unresolved constraints; it is never scheduled by this operation.

Instructions live in `internal/prompts/templates/`, selected by target model and
task. Each version is immutable; add a new file/version to revise instructions,
retaining old versions for pending jobs. Settings limits also belong to the
target's template profile, rather than the general enhancement input.

`providers.PromptEnhancer` is the boundary for a later Sonnet adapter. It receives
system instructions separately from user input and returns structured enhancement
output. The operation owns source/provenance metadata and validates output shape
and target length. Semantic intent preservation requires real-model evaluation;
the fake cannot infer intent, identify conflicting requirements, ask meaningful
clarifications, or judge video fidelity. No paid API is called.

When tool invocation is added, the backend should schedule enhancement before
generation, save the selected enhancement result, and reuse that result for
generation retries. This operation alone does not enforce that future pipeline.

## Owned list retrieval

`GET /api/v1/projects?limit=20&cursor=...&q=film` returns `{items, nextCursor}`. Search is a case-insensitive literal substring, including `%` and `_` as ordinary characters. Limits default to 20 and must be 1–100. Ordering uses descending `(created_at,id)` with an opaque cursor; no total count is returned.

Assets use the same page envelope and support optional `projectId` and `kind` (`image`, `video`, or `audio`). Jobs already support optional project/status/operation filters. All ownership comes from verified authentication, never query parameters. The frontend reads each collection through one account-scoped cache and keeps media URLs separate from saved resource metadata.

## Characters

Apply `009_characters.sql` with `make migrate` before restarting the server.
Characters belong directly to the authenticated user; they do not require a
project. No owner IDs, project IDs, or storage keys are accepted in character
submission bodies. Ownership is checked in SQL and enforced by composite
foreign keys across characters, image versions, assets, and jobs.

| Method | Path | Behavior |
|---|---|---|
| POST | `/api/v1/characters` | Create a character; `201` |
| GET | `/api/v1/characters?limit=20&cursor=...&q=...` | List owned, active characters |
| GET | `/api/v1/characters/{id}` | Details and six view selections |
| PATCH | `/api/v1/characters/{id}` | Update name, appearance, or private notes |
| DELETE | `/api/v1/characters/{id}` | Soft delete; `204` |
| POST | `/api/v1/characters/{id}/generations` | Schedule image candidates; `202` |
| GET | `/api/v1/characters/{id}/generations/{generationId}` | Retrieve a saved batch and its jobs |
| GET | `/api/v1/characters/{id}/versions?view=front&limit=20&cursor=...` | Candidate history with approval/staleness |
| PUT | `/api/v1/characters/{id}/views/{view}/selection` | Select a candidate with `{"versionId":"UUID"}` |
| POST | `/api/v1/characters/{id}/versions/{versionId}/reject` | Reject a candidate and clear its selection; `204` |
| POST | `/api/v1/characters/{id}/uploads` | Upload raw PNG/JPEG/WebP bytes as a front candidate; `201` |

Create with `{"name":"Nori","appearance":"Short black hair and brown eyes","notes":"Private notes"}`.
Name is required (up to 100 characters); appearance (3,000 characters) and notes
(2,000 characters) are optional. Private notes are never included in generated
prompts. `appearanceRevision` increases only when appearance changes, so renaming
or editing notes does not invalidate the identity.

Generation body:

```json
{
  "views": ["front"],
  "count": 2,
  "prompt": "Neutral expression",
  "model": "fake-image-v1",
  "settings": {"aspectRatio": "1:1"}
}
```

Defaults are front view, one candidate, the configured image model, and square
output. `count` is 1–4 per selected view; each candidate gets its own durable
`generate_image` job. Supported view names are `front`, `three_quarter`,
`profile` (left), `right_profile`, `full_body`, and `back`. Additional owned
image references may be supplied using the image API's `references` format.

Generation and uploads require `Idempotency-Key`. Generation keys are scoped by
user and character; replay returns the original batch/jobs even if appearance
has since changed. Different input with the same key returns `409`. Batch
metadata and all image jobs are committed in one transaction. A new request
gets a new key. Upload replay checks the image digest and returns the same
version instead of storing a duplicate. Uploads accept raw image bytes, not
multipart or JSON, and are limited to 5 MiB.

First generate or upload a front candidate, then select it as the canonical
identity. Front generation requires an appearance description. Additional views
require a selected, current identity and automatically reference its exact
image version; an uploaded identity can supply appearance without a text
description. Extra instructions never replace the saved appearance.

The frontend can poll each returned job using the existing job API. Workers
store the image before publishing an asset and character image version. Those
records and job success commit together. Database publication failures retry
from the stored provider checkpoint without generating a new image. Candidates
start as `needs_review`; generation never changes the selected identity/view.
The provider is still fake and returns bundled image placeholders.

Selection rejects outdated appearance or identity lineage with `409`.
Changing identity preserves older versions but marks dependent angles stale.
Lists return `{items,nextCursor}` with limits 1–100 (default 20); inaccessible
or deleted characters return `404` for all character APIs. Soft deletion hides
the character and prevents new work/selections while retaining referenced
media and history. Already scheduled generation still stores its output and
finishes without selecting or reactivating the character. Permanent file
cleanup and project/episode character assignments are separate features.

The current frontend character screens still use local data; these endpoints
are the server contract for wiring those screens next.

## Fake payments and credits

Apply `010_billing.sql` with `make migrate`. Existing in-flight jobs without a
reservation keep their previous behavior; newly submitted image/edit jobs cost
8 credits per result and video jobs cost 24. Interpretation and enhancement
remain free. These are placeholder product prices, not provider cost estimates.
New accounts start with zero server credits. Browser demo balances are not
imported into the server wallet.

Payments default to disabled, and `APP_ENV` defaults to production. To test the
fake checkout locally, export all of these before starting Go:

```sh
export APP_ENV=development
export PAYMENT_PROVIDER=fake
export PAYMENT_FAKE_SECRET="$(openssl rand -hex 32)"
make migrate
make run
```

Keep the same fake secret across restarts when testing event delivery. Production
startup rejects fake payments. Use a separate database for development; fake
purchases create real test ledger records, never real monetary transactions.
No Stripe account, API key, or card information is required.

With normal Clerk sign-in and API mode, Recharge loads the server's credit packs
and opens `/billing/checkout/{purchaseId}`. Simulate success, failure, cancellation,
delayed confirmation, duplicate confirmation, or a full refund. Delayed events
are persisted and processed by the server's reconciliation loop. Reloading the
checkout retrieves the saved purchase. Checkout redirects alone never add
credits. Demo/bypass mode retains its separate local demo-credit dialog.

| Method | Path | Behavior |
|---|---|---|
| GET | `/api/v1/billing/packs` | Payment mode and server-priced packs |
| POST | `/api/v1/billing/checkouts` | `{packId}`, required Idempotency-Key; `201` purchase/checkout URL |
| GET | `/api/v1/billing/purchases` | Owned purchase history; cursor pagination |
| GET | `/api/v1/billing/purchases/{id}` | Owned purchase status |
| GET | `/api/v1/billing/wallet` | Available and reserved credits |
| GET | `/api/v1/billing/entries` | Append-only credit history; cursor pagination |
| POST | `/api/v1/billing/purchases/{id}/simulate` | Fake mode only: `{action}` |

Simulation actions are `paid`, `failed`, `cancelled`, `delayed`, and `refunded`.
All account-facing endpoints require verified authentication. Simulation verifies
purchase ownership, signs a provider event internally, and uses the same event
verification/processing path as provider delivery. Event IDs and purchase grants
are deduplicated. Purchases freeze credits, amount in minor units, and currency;
clients cannot provide those values. List limits default to 20, maximum 100.

Wallet changes and append-only entries commit together. A reservation is created
in the same transaction as its job, and character batches reserve atomically.
Insufficient credits returns `409 insufficient_credits` without queuing work.
Capture shares the artifact/asset/character-version completion transaction, so
neither a charge nor success can survive a failed result publication. Retries
reuse the reservation. Confirmed terminal failures release it; temporary errors
and pauses in browser observation do not. Reconciliation fences jobs discarded
by River and releases their reservations exactly once.

Refunds reverse the purchased credits even when some have been spent or reserved.
Available balance may become negative; further paid jobs are blocked until it is
funded. Existing reservations still settle normally. This prevents a refund from
creating spendable credits. Only full refunds are simulated in this release.

The frontend polls live balances and clears them on account changes. The existing
local editor generation prototypes remain demo-only: they do not debit a server
wallet. Backend image/video jobs and character generations enforce server credits
regardless of their caller. Real provider integration, invoices, subscriptions,
and production payment webhooks remain separate work.

### OpenAI Sunburst images

Run `make migrate` to install migration 011, then configure the backend:

```sh
export IMAGE_PROVIDER=openai
export OPENAI_API_KEY='your-server-side-key'
export OPENAI_IMAGE_MODEL=gpt-image-2.5-sunburst
make run
```

Omit `model` in image requests to use the configured model. Existing image and character endpoints share this adapter. Fake mode remains the default (`IMAGE_PROVIDER=fake`). Pending fake jobs must be drained before changing providers; this release supports one configured image provider per server.

The initial settings are one PNG at medium quality: 1024×1024, 1536×864, or 864×1536. Reference-conditioned generation and editing use the image edits API with privately loaded images. Reference roles are added to the prompt in input order. No mask-based inpainting is exposed yet.

Migration 011 records provider submissions and returned usage separately from user credits. Private response receipts in blob storage allow recovery without generating again. Keep both the database and blob directory persistent. A submission with no recoverable response fails as `provider_outcome_unknown`; it is never blindly resubmitted. Rate-limit responses permit at most three submissions per job. Provider usage may still be charged for uncertain or failed results; customer reservations are released on terminal failure. The existing 8-credit image price is a placeholder, not a provider cost estimate.

Image calls have a three-minute step deadline; River rescue is four minutes and graceful worker shutdown allows 190 seconds. Allow 205 seconds for HTTP draining followed by worker shutdown when stopping the process. Response receipts contain private image data and need the same access restrictions and eventual retention/deletion policy as other private media.

Adapter tests use a local HTTP server and never call paid APIs. To smoke-test a configured account, submit one image job, poll it, and retrieve the owned asset through the existing download endpoint. Then test a reference-conditioned character generation.

### Connected studio persistence

Run `make migrate` before starting this version. Migrations 012 and 013 add owner-scoped production records, revision history, reusable places/props, reference candidates, shot job bindings, upload idempotency, and durable file cleanup.

Authenticated `/assets` uses the character/reference APIs. Characters remain user-owned without a project. Generation, editing, selection, rejection, deletion, and uploads are server-backed. Front identity uploads remain limited to 5 MiB; other media uploads are limited to 32 MiB. Candidate generation never selects a result automatically. Changing a source identity or front view invalidates dependent candidates.

The existing production editor loads and saves through:

- `GET /api/v1/projects/{projectId}/production`
- `PUT /api/v1/projects/{projectId}/production` (expected `revision` in the body)
- `DELETE /api/v1/projects/{projectId}` (archive)
- `POST /api/v1/projects/{projectId}/shots/{shotId}/generations`
- `GET /api/v1/projects/{projectId}/generations` (active shot work)
- `/api/v1/references/{kind}` for reusable `place` and `prop` records; `look`, `cast`, `place_instance`, and `prop_instance` address frozen production subjects for version generation and review.
- `POST /api/v1/assets/uploads` and `DELETE /api/v1/assets/{assetId}` for owned media.

The production document is an editorial aggregate, not a saved frontend workspace: each episode, scene, shot, subject, version, take, setup, reference, export, and media link has its own database row. Relationships and ownership have dedicated columns. Evolving editorial settings use JSONB. Jobs, credits, sessions, signed URLs, and UI preferences are excluded. A transactional aggregate save keeps moves and reordering atomic. Its current bounds are 2 MiB and 2,000 records per resource group.

The frontend projects these records into the existing editor and autosaves after a short pause. Wait for the server save indicator before closing. Pending edits stay in memory after failures, and stale revisions return 409 rather than overwriting another session. Browser-only demo work remains in its original cache and is never imported automatically. Account changes clear the server projection, observers, caches, and pending submissions. Demo mode continues using its original local workflow.

Reusing a library subject creates a production snapshot. Library changes and deletion do not rewrite existing productions. Episode looks can also be scoped explicitly to an episode; legacy project looks remain readable. Takes preserve producing jobs, source inputs, and pinned references. Approval history is append-only, and prior media/version records remain available for historical snapshots. Deleted productions and subjects retain history. Physical deletion is allowed only for unreferenced nongenerated uploads; referenced/generated assets return `asset_in_use`. The cleanup queue retries filesystem deletion after the asset is no longer accessible.

Shot candidate batches reserve credits atomically. Results publish as owned assets and candidates in the worker completion transaction, alongside credit capture. The current video provider remains fake and does not support conditioning; unsupported reference/frame requests are rejected explicitly. H3, server FFmpeg rendering, real payments, pricing quotes, and distributed cost controls are separate follow-up work. The existing browser renderer can upload and persist its final media and export snapshot.

Acceptance coverage is in `internal/engine/production_integration_test.go`, `src/test/server-characters.test.tsx`, and `src/test/production-persistence.test.ts` (the latter two are in the frontend). Integration tests use an isolated PostgreSQL database and fake providers; no paid requests are required.
