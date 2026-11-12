# dotori studio

A local-first React production workspace for short films, with **Board / Script / Timeline / Review** views of the same episode. The initial studio route is `/projects`. The original floating Home composer submits to the backend. A separate developer demo entry remains available without a backend or paid service.

## Run

Verified with Node 26 and npm. Use a Node version supported by Vite (22.12+ or newer).

```sh
npm ci
npm run dev
```

Open the local address printed by Vite. The development preview used `http://127.0.0.1:5178/`.

```sh
npm run typecheck
npm test
npm run build
npm run preview
```

TypeScript is strict. React, Zustand, Zod, Router, Radix primitives, dnd-kit, resizable panels and Tailwind use the existing installation and lockfile. Clerk authentication uses `@clerk/react` and `@clerk/ui`.


## Frontend environment configuration

Run Vite from `frontend/`. Use `.env.example` as a template, preserving any existing local Clerk configuration. Real login uses `VITE_CLERK_PUBLISHABLE_KEY`, with `VITE_AUTH_BYPASS=false` and `VITE_HOME_WORKFLOW=api` as defaults. Local `.env*` files are ignored; only `.env.example` is committed. Vite reads settings at startup/build time, so restart after changes. All `VITE_*` values are public and must never contain server secrets.

For local UI work, create or update an ignored `.env.development.local`:

```dotenv
VITE_AUTH_BYPASS=true
VITE_HOME_WORKFLOW=demo
DEV_API_PROXY_TARGET=http://localhost:8080
```

Bypass works only in the development server. It never initializes Clerk or calls `/api/v1/me`, and all backend requests are blocked. Home creates local demo drafts without `?mode=demo`; backend job polling stays off. A Local demo badge identifies this mode. Its saved workspace uses `nori-demo-v1:user:development-demo`, separate from every real account. Account/sign-out actions explain how to disable the bypass and restart with Clerk.

`VITE_HOME_WORKFLOW=demo` can also be used with real Clerk sign-in during development. The `?mode=demo` Home override remains development-only. These switches govern Home's workflow; existing local editor/generation prototypes are unchanged.

`DEV_API_PROXY_TARGET` is read only by Vite config, defaults to `http://localhost:8080`, and must be an HTTP(S) origin without a path or credentials. The browser always calls `/api/v1`; production hosting must route `/api` to Go. Request timeouts, polling intervals and domain settings remain code defaults.

Production build environments must supply `VITE_CLERK_PUBLISHABLE_KEY`, disable bypass, and use the API Home workflow. Builds and previews fail for bypass, demo workflow or missing keys, even when a custom build mode or `NODE_ENV=development` is used. Invalid booleans, workflow values and publishable keys produce configuration errors. `.env.development.local` is not loaded by the default production build. Never enable bypass in a common `.env.local` used for both development and builds.

## Connected development

Run Go and Vite in separate terminals. From the repository root, start PostgreSQL using the backend's existing setup, then:

```sh
# Terminal 1: Go (run from server/)
cd server
cp -n .env.example .env  # first run only; preserve your existing configuration
set -a
. ./.env
set +a
go run ./cmd/studio migrate
go run ./cmd/studio
```

```sh
# Terminal 2: Vite (run from frontend/)
cd frontend
npm run dev
```

Vite forwards `/api/*` to `http://localhost:8080` without rewriting paths. The browser client uses `/api/v1` and resolves a fresh Clerk session token for each request, sending it as `Authorization: Bearer …`. Tokens are never copied into local storage. Requests remain abortable, including while waiting for a token; responses from a previous session are discarded. The Go server verifies tokens against its configured Clerk instance and authorized frontend origins. HTTP 401 errors remain visible to workflows and deliberate retries. Production hosting must proxy `/api` to Go too; a static build alone does not supply the backend.

`server/.env.example` sets `FAKE_VIDEO_SAMPLE=testdata/fake-video.mp4`. This repository fixture is a playable two-second H.264 MP4. A local `server/.env` uses the same setting; Go reads exported environment variables, so source it as shown. Run Go from `server/` or use an absolute sample path. Without an override, the backend now uses a bundled playable demo clip.

### Owned server data

After Clerk sign-in and `/me`, `AccountDataProvider` creates an in-memory TanStack Query cache scoped to the internal account ID. API mode loads Projects, project details, Library, and saved Activity from Go, rather than copying them into demo editor records. Explicit development demo mode remains available; `?mode=demo` persists through navigation for that session, and `?mode=api` returns to connected views.

- `/projects`: recent owned projects and media plus the existing interpretation composer.
- `/projects/browse`: paginated project list, server-side title search, and project creation.
- `/projects/{id}/episodes`: server project overview and project Library link. Episodes still require backend persistence; no demo episodes are invented for server projects.
- `/library`: all owned assets, including projectless generations.
- `/projects/{id}/library`: project-scoped assets, paginated by media kind.
- Activity discovers saved history and all queued/running jobs, then uses the existing shared observer for active status checks. Terminal details are fetched when opened, and generated assets link to Library.

Queries share account/resource/filter keys, refresh on focus and reconnect, and expose explicit loading, retry, unavailable, empty, and load-more states. Project creation invalidates project lists; observed generation completion invalidates asset lists. Mutations are never automatically retried. Account replacement aborts old requests and clears the query cache. Zustand retains editor state and the existing workflow/observation checkpoints; it does not become the editable authority for server project/asset records.

The viewer retrieves asset/file metadata and requests five-minute signed links on demand. Links are kept only in memory, renewed before expiry, and media playback position is retained when renewing video/audio URLs. Preview and original files use the same owned URL endpoint. Reopening after clearing browser storage retrieves saved resources from Go again.

Restart the Go server after updating this code: `GET /api/v1/projects` now returns `{items, nextCursor}`, matching the other list endpoints. No additional migration is needed for retrieval/pagination. Production still requires matching Clerk configuration and the existing account/ownership migrations.

### Home → interpretation decision

1. Enter a prompt in the existing floating composer and press Send. Home submits
   the prompt to `POST /api/v1/requests`, which schedules interpretation. It creates a project only when an explicitly
   selected local project needs a backend mapping. The response contains the persisted request and initial job; both IDs are saved locally.
2. The fake interpreter returns `request_interpretation` schema v2: either
   `propose_operation` with an operation and object input, or `clarification_needed`
   with questions. The fake deterministically proposes `generate_video` with the
   original prompt, six seconds, and 768P. It requests a shorter prompt above
   2,000 characters instead of proposing an invalid video request.
3. Home displays the proposed action and arguments. It never submits the proposal,
   generates a video, or spends credits. Interpretation and tool execution are
   separate; there is no combined T2V coordinator.
4. The shared observer, Activity, retries, and reload recovery remain in place.
   An uncertain submission reuses its original key only on explicit retry.
   Older v1 briefs remain readable. Saved requests for retired operations are
   not replayed; their backend job history and artifacts remain intact.

### Central backend job observation

`src/services/job-observer.ts` exports one shared `backendJobObserver`. Workflows subscribe by backend job identity; multiple subscribers share one in-flight GET and one timer per job. Different backend jobs are tracked independently. The interpretation service handles submissions and results, and delegates every status check to this observer.

- Successful active jobs poll every second. Network failures, request timeouts, HTTP 408/425/429 and 5xx responses retry with exponential delays of 1, 2, 4, 8, 16 and at most 30 seconds. A successful check resets backoff. The UI distinguishes **Reconnecting** from a backend job failure and offers **Check now**.
- Success and terminal backend failure both stop automatic polling. The last observed status/result and any observation error are saved under optional `Data.backend.jobs`. A terminal job result can be reused after reload without polling it again.
- Window focus and a return to visible state trigger an immediate refresh of active watched jobs, bypassing backoff without overlapping an in-flight request. Authorization, missing-resource and malformed-response failures require a deliberate retry instead of an automatic retry loop.
- The app-owned Activity service subscribes to known active backend jobs while the studio is open, even when the tray is collapsed or Home is closed. Home shares those same watches rather than starting another polling stream. Closing the app removes the final subscriptions, aborts local GETs and clears timers/listeners. Reopening resumes known persisted jobs with GET. Server jobs continue in Go; no cancellation request is sent. Pausing reply checks affects the Home workflow subscription, while Activity keeps tracking.
- Unknown submission outcomes retain the original idempotency key. Only an explicit **Retry submission** repeats that POST. A deliberately new generation or retry of a terminal backend failure gets a new key. There is no automatic generation retry in the observer.
- The Activity tray includes backend rows and counts, with queued/running/reconnecting/complete/failed status, error messages, **Show**, status-only retry and deliberate generation retry. Backend rows are marked Backend; existing simulated queue rows are marked Demo. Project-scoped views use the persisted local-to-backend project mapping. **Show** restores that job's saved request/brief in Home without submitting a job. Per-job context is optional persisted metadata, so older known jobs can still be watched.
- An uncertain submission with no returned job ID appears as a submission row; **Retry submission** uses its original key. Retrying a terminal failed job creates a new job and new key, retains the failed row, and guards repeat clicks. Backend **Cancel unavailable** explains the missing cancellation endpoint; demo cancellation remains unchanged. The backend exposes paginated `GET /api/v1/jobs`; Activity currently observes jobs known to this browser and does not yet discover other jobs through that endpoint.


Interpretation produces a decision only. It does not create scenes, shots, scripts,
timeline clips, or videos. `generate_video` remains an independent backend operation;
a coordinator to validate and execute decisions can be added later. The remaining
studio tools continue to use the existing demo implementation.

API calls live in `src/api/`; `src/services/interpretation.ts` coordinates calls and state; `src/domain/interpretation.ts` owns the saved workflow shape/result rules. The optional `Data.backend` field stores connected project metadata and the latest interpretation request in the account-specific **`nori-demo-v1:user:<internal-user-id>` version 3** save. Older saves remain valid. Demo editorial IDs, job queues and credit state remain separate. Nothing is charged by the frontend interpretation workflow; backend billing is not implemented.

Only these existing endpoints are called:

- `POST /api/v1/projects`
- `POST /api/v1/requests` (`prompt` and optional `projectId`; returns `{request, job}`)
- `GET /api/v1/jobs/{jobId}`

The backend exposes project GET/list and paginated job listing; the frontend does not yet use them for discovery. The original project picker retains local project choices and can also offer previously API-created projects remembered on this device. It does not pretend a server-wide list is available. Clearing local storage loses this catalog; the backend still retains its projects and jobs. The modules intentionally leave unsupported retrieval/list calls unimplemented until those endpoints exist.

## Studio workspace

The application is a fixed full-height tool: a 48px icon rail, 40px top bar, independently scrolling panels and a bottom Activity tray. Board, Script, Timeline and Review are views over the same episode and shot selection. There are no scene-page or planning-step gates in the primary app.

- **Home:** the original floating chat creates or reuses a backend project, submits a user request, polls the returned interpretation job ID and displays a dismissible reply. The background work grid and composer controls retain their previous design. The developer-only `/projects?mode=demo` entry still creates a local board without API calls.
- **Episode:** the left outline exposes every scene and shot with keyboard/pointer reordering and draggable cast/place assignments. Board shows all shots without pagination; Script pairs writing with a mini-board; Timeline includes ungenerated placeholder clips and duration handles; Review expands playback. The right inspector has registered sections, Simple/Advanced controls and an AI Director tab.
- **Generation:** Draft shots generate stills (8 demo credits); Animate (24 per shot) uses the current still as an optional starting frame. Single shots submit directly. Batches expose scope, operation, blockers and fix actions in a side panel. Spending over 100 credits receives a separate confirmation. Finishing jobs update cards in place. Script/plan approvals are automatic unless Project settings enables strict approvals. Existing takes are retained until explicitly replaced.
- **World:** characters, places, props and notes use a list/detail/inspector arrangement. Character identity, Looks and angles live on one sheet. Every element has shot-usage links and an action to invalidate affected shots. Script speaker names can be added as suggested characters.
- **Library:** media shows origin and usage, with archive/restore and a Renders filter for timeline-manifest exports. Uploads remain session-only.
- **Preferences:** density, appearance and strict approvals live in dialogs. Account and recharge actions live in the account popover/dialog.

## Foundation and architecture

`src/studio/selection.ts` owns transient click, modifier-toggle and anchored range selection. `src/studio/commands.tsx` registers commands shared by main buttons, context menus, keyboard shortcuts and the command palette. `src/studio/inspector.tsx` provides the section registry used for episode, scene, shot, World and media inspectors. Undo uses the existing store history and preserves asynchronous job outputs.

All new editorial, World, generation-readiness and queue orchestration logic lives in `src/domain/workspace.ts`, built on the existing domain commands. The original queue, credits, input snapshots, invalidation, undo and validation remain in place. Animate captures still-frame asset IDs; snapshots also capture camera, script, style and assigned props/notes. No new dependencies were added.

## Routes

- `/projects`: Home, showing all work by default.
- `/projects/browse`: project card browser. Single click selects; double click, Enter, Open, or a touch tap opens the project.
- `/projects/:projectId/episodes`: project Episodes workspace.
- `/projects/:projectId/episodes/:episodeId`: episode workspace; `view=board|script|timeline|review` is supported.
- `/projects/:projectId/world`, `/projects/:projectId/library`: project World and Library workspaces; the sidebar owns project navigation.
- Legacy scene/edit/setup routes redirect into the episode workspace. Old script/scenes/edit query links map to the corresponding new views. Character, assets, exports and bible routes redirect to World or Library; Queue opens the Activity tray; settings/account links open dialogs.

## Persistence and compatibility

Authenticated storage uses **`nori-demo-v1:user:<internal-user-id>`**, format **version 3**. The old unscoped `nori-demo-v1` save remains unassigned. New fields are optional: project strict-approval policy and props/notes, episode style/archive state, shot camera/lock/World assignments, take discard state, media archive state and UI density/inspector preferences. Existing saves remain compatible; versions 1 and 2 retain the original migrations. Uploaded URLs are session-only and require reattachment after reload. Public landing/login/PWA entry behavior is unchanged.

## Verification

The redesign was checked in phases: foundation, episode workspace, Home/project, World/Library/settings, and responsive polish. Existing domain test files remain unchanged. UI tests exercise the new creation, editing, selection, generation, take-use, strict-approval, usage and legacy-route outcomes. Test worker concurrency is bounded to avoid competing full DOM environments exhausting the host.

## Demo limitations

Images and video generation still produce local storyboard placeholders. No external AI, cloud storage, real billing, authentication provider or rendered-video export is connected. Renders are honest JSON timeline manifests. Live providers must enforce their own duration, reference and frame-conditioning capabilities.

## Installable app (PWA)

Production builds emit `manifest.webmanifest` and a Workbox service worker for the installation/update lifecycle. Serve `dist/` over HTTPS (localhost is supported for testing). The browser can install dotori studio as a standalone app; supported browsers show an Install dotori studio tip. On Mac Safari, Install dotori studio explains File → Add to Dock (macOS Sonoma 14 or later). Safari requires this manual browser action; the website cannot open its installation dialog. On iPhone/iPad, the tip explains Safari → Share → Add to Home Screen. App updates wait for the user's Reload action instead of interrupting editing.

dotori studio is online-only. The worker does not precache the app, provide an offline navigation fallback, or cache API responses/media at runtime. If connectivity is lost while the app is open, a connection-required screen replaces the studio; reconnecting restores it. A cold launch without network access may show the browser's own offline page. Existing localStorage persistence is unchanged; it is local draft storage, not offline app support. Uploaded session URLs remain temporary. There is no background generation or offline write queue.

Test using `npm run build` then `npm run preview`, not the development server. Inspect the manifest, icon dimensions and service worker in browser developer tools. Confirm Cache Storage does not contain app-shell/media precaches. Switch offline with the app open to verify the connection-required screen, then reconnect. Rebuild while the app is open and check that a new worker offers Reload / Later. OS installation must be checked on the target devices.

Hosting must serve `/sw.js`, `/manifest.webmanifest`, `/icons/*` and built assets as actual files before the SPA fallback. Use `Cache-Control: no-cache` for `sw.js`, the manifest and `index.html`; hashed `/assets/*` may use long immutable caching. Keep `/api` and `/auth` routes outside the SPA fallback. PWA workers are disabled in development.

## Demo login and profile

Browser and installed-app entry routes use Clerk sessions through `AuthenticationRoot`. `/` remains the public product landing page; `/login` and `/signup` embed Clerk authentication in the existing branded layout. Protected links preserve a local return URL. The existing local demo sign-in flag cannot unlock the running application. `DemoAuthGate` and its dummy sign-in implementation remain separate prototype/test components, and `/projects?mode=demo` selects local generation after real sign-in during development only. The explicit environment bypass described above is separate from this legacy demo gate.

The linked Clerk application is `app_3L1FIsaEy6YLfZa0s1VasVySF3q`. Configure the frontend with `VITE_CLERK_PUBLISHABLE_KEY` in an ignored local environment file, then restart Vite. `clerk env pull` supplies development configuration. Only the publishable key is referenced by client code; `CLERK_SECRET_KEY` belongs on the Go server and must never receive a `VITE_` prefix. The selected application must match the Go server's issuer and secret; its allowed origins must include the development frontend URL.

The existing profile popover uses the Clerk name/avatar and real sign-out. Account settings opens Clerk profile/security management. Starter membership, credits, recharge and local editorial content are still prototype data; Clerk does not turn them into backend billing or server-persisted editorial content. The old demo profile record is ignored for real authentication. The optional `backend.ownerId` field uses the verified internal user ID. All local studio state is isolated per account, while a returning user's own saved jobs can resume.

Verify using `npm test`, `npm run build`, `npx -y clerk@latest doctor`, then sign in with a real development user. No users or authentication-provider settings are created or changed by the integration.

## Public product page and entry routes

`/` is the public product landing page, including for signed-in browser visitors. Its login and studio calls to action lead to `/login`. The page has an interactive sample storyboard, workflow explanation, character/look examples, and expandable questions explaining the demo. The login logo returns to the public site.

The manifest uses `/login` as `start_url`, retaining the existing `/` app ID. Signed-out installed launches open login; an existing signed-in session continues to Projects. A standalone launch at `/` (including older Safari shortcuts) also routes to login instead of the marketing page. `/app` remains a compatible studio entry route. Protected deep links still preserve their destination. Browser registration and installed OS shortcuts can update on different schedules; existing installations may need to be reopened or reinstalled to adopt a new launch URL.

## Product branding

The displayed product name is lowercase **dotori studio**, including page metadata, installation names, wordmarks, accessibility labels, generated media labels and export branding. The existing app ID (`/`) and the two legacy storage identifiers (`nori-demo-v1`, `nori-demo-account-v1`) remain stable so existing installations, saved studio work and demo profiles continue to load. Those identifiers are compatibility details and are not displayed in the interface.


### Home and navigation

The sidebar and full-width banner persist throughout the studio. The banner provides New film, notifications, the account menu and contextual production breadcrumbs. Credits remain available in the account menu. View and generation controls live inside each workspace; the episode outline has its own toggle. The sidebar becomes an accessible icon rail on smaller screens.

Home shows the production hero, film composer and production cards. The separate `/work` browser provides project/media filters, local shot and scene cards, and its original composer. The composer connects to Go by default; no page-level mode switch or extra project-name field is added. `/projects?mode=demo` is a separate developer entry using the same UI and the original local draft service. API project IDs are remembered separately, with optional local-to-backend project mappings. No scene structure is fabricated from an interpretation result.

### Project scope and World browser

The shared sidebar provides Home, Projects, Cast & world, Library and Reviews. Project-scoped destinations use the current production, or ask the user to choose one from global pages. The header breadcrumbs link back to the project and episode. Existing project and character deep links remain supported.

World opens a card grid with Characters, Places, Props, and Notes categories, search, and category-specific Add actions. Select cards to inspect usage, use modifiers for multiple selection, and double-click or choose Open for the full editing sheet. Back restores the category, search, and grid scroll position. Touch taps open cards directly. Character sheets retain identity, looks, angles, generation, and shot-usage actions.

### Selected logo

The selected `d.` monogram is rendered as a font-independent vector by `src/components/Brand.tsx`. The collapsed studio rail shows the non-interactive mark; the expanded rail shows the lowercase wordmark. Product header/footer, the product preview, and login use the same branding. `public/brand/dotori-mark.svg` is the transparent standalone mark; `public/favicon.svg` is the browser tile. Apple (180px), PWA (192px/512px), and maskable (512px) PNG icons use the same geometry, with extra safe-area spacing for the maskable icon. Icon references have a release query so existing caches can refresh.

### Work browser rows

In `/work`, Recent work and Projects are horizontal, independently scrollable card rows above the uncapped All work grid. Each row shows at most 20 cards and has left/right controls beside it; arrows reflect the current scroll boundaries. Recent work follows the current work type and project filters; Projects orders local projects by their latest update. Card selection, modifier selection, box selection and project opening retain the existing tool behavior. The prompt-only floating chat is unchanged.

### Account isolation

The studio waits for a verified backend account from `/api/v1/me` before mounting. Configure the existing Clerk instance on both frontend and backend and apply backend migrations. API requests use Clerk bearer tokens. Local studio caches are isolated by the backend's internal user ID; sign-out/account switching clears active requests, watches, state, and undo history. Old unscoped demo storage is preserved but not assigned to a signed-in user. Generated media links must be requested through `getAssetFileURL`; raw storage paths are not public media URLs. Signed links are not persisted.


## Director's Desk redesign

The charcoal and amber interface uses the **dotori studio** brand throughout. Home, the project browser, World, Library, episode board, authentication surfaces and shot creation share the new theme. Cinematic demo assets and generation prompts are documented in `public/media/director-desk/README.md`.

The shot workbench route is `/projects/:projectId/episodes/:episodeId/shots/:shotId?stage=scene|frame|motion|review`. `src/studio/director-desk/` separates scene planning, navigation, reference previews, direction controls, take review, and creation entry points. Route parameters are checked against the project/episode ownership relationships before rendering any shot media.

Scene setup writes through the existing domain commands. Starting-frame selection persists its asset ID and image-first mode. Lens, angle, lighting, focus, motion intensity, easing, negative prompt and optional seed are validated and included in generation snapshots; camera movement, framing, action, dialogue and duration use the existing shot model. Review previews a specific take, approves it through the domain, and links to the episode timeline. Readiness warnings open the relevant editor or activity view.

For the isolated local preview, start Vite with `VITE_AUTH_BYPASS=true VITE_HOME_WORKFLOW=demo npm run dev -- --port 5175 --strictPort`. This installs the self-contained **The Last Letter** sample only in the development workspace. It does not change an authenticated account. The preview uses the existing simulated generation queue and still-image animatics, not a live image/video provider. Connected creation still uses the authenticated interpretation service and existing job observer; this redesign does not add server-side per-shot generation or editorial persistence endpoints.

Validation: `npm test` and `npm run build`. The workbench tests cover starting-frame gating, craft-setting validation and snapshots, image-to-video approval, cross-project route guards, adding scenes, demo reference readiness and selected-frame continuity.


### Projects home reference implementation

`src/studio/projects-home/` owns the reference-matched home page: the persistent sidebar, full-width header, production hero, film composer, sorting and production menus. `FilmComposer` retains separate idea, script and blank-project drafts. Both idea and script modes use the existing interpretation service in connected accounts; blank projects use `POST /projects`. The isolated demo instead creates an editable local production without spending credits. Server project cards use actual owned projects and honest empty covers when no cover is provided by the API.

The original shot/scene browser remains at `/work`, available from the command palette as “Browse all shots and scenes”. Its filters, multiselection and selection deletion remain available separately from the projects home. All studio routes share the persistent header and sidebar in `src/studio/shell/`, styled by `src/styles/studio-shell.css`.

The development workspace includes editable Night Shift and Paper Planets productions, plus three episodes for The Last Letter. `installHomeProductions` is idempotent and only runs inside development authentication. It does not populate real accounts. Image prompts and asset provenance are in `public/media/director-desk/README.md`.


### Persistent studio shell

`StudioShell` mounts `StudioHeader` and `StudioNavigation` outside the routed workspaces. The same header, sidebar, account menu, New film action, notification toggle, activity tray, settings, and undo notices persist across the project browser, project pages, episode views, shot workbench, World, Library and work browser. Marketing and authentication retain their public layouts.

Navigation highlights the current destination and uses the current production when opening Cast & world, Library or Reviews. Global entries ask for a production when one is required. Connected accounts use their existing project media routes and image/video filters. The header preserves project and episode breadcrumbs on desktop. New film returns from any workspace to Home and focuses its composer while preserving explicit development mode.

The sidebar stays expanded on desktop and becomes an accessible icon rail on smaller screens. Shared chrome styles are separate from projects-home content styles. Route-level tests verify both the DOM identity of the shared shell and continued activity state across navigation.
