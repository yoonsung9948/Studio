# dotori studio

A local-first React prototype for creating short films through an episode workflow: **Script → Scenes → Edit**. The initial route is `/projects`. No account, API key, backend, or paid service is required.

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

TypeScript is strict. React, Zustand, Zod, Router, Radix primitives, dnd-kit, resizable panels and Tailwind use the existing installation and lockfile. No new dependencies were needed for this workflow.

## Episode workflow

1. **Create an episode.** Name it, describe the story and choose a 3–90-second target. Creation opens its Script view.
2. **Script.** Write a screenplay or use **Generate script** for a local demonstration draft based on the episode premise. Edit it, then choose **Create scene plans**. This saves the current script as the approved source, with approved versions retained in history.
3. **Create scene plans.** Choose a scene count and generate a breakdown. The action becomes **Refresh scene plans** once plans exist. The mock reads screenplay scene headings and paragraphs. Each scene receives detailed action, any recognized dialogue, a setting description, duration and an optional shot breakdown. Planning a new episode creates draft scenes; refreshing existing plans keeps their scene/shot IDs, takes, selections and timeline edits.
4. **Review plans.** Scenes unlocks once plans exist. The board shows generated shot media, with approval, add, refresh and generation actions together above the list and six-scene pagination below. It supports reorder, add, split and merge. Click a scene to open its creative plan, never directly into the video editor. Review action, dialogue, setting, direction, lighting/camera details and timing. Approve individual plans or all plans from the board.
5. **References.** After approval, the scene workspace offers persistent character/Look cards, setting selection, image/video/audio references with purposes, and optional shot-specific overrides. Name matches suggest existing characters and settings for the user to add. Selection is saved as it changes. Character Studio links return to the same scene.
6. **Generate.** A compact summary beside reference selection shows preflight, chosen inputs, output settings, current-step cost and Generate. On mobile the action bar stays at the bottom and preflight expands. The far-right workspace panel is exclusively AI Director. Batch generation uses a readiness summary with links into each scene; it never embeds a second asset-selection flow.
7. **Results.** Generation returns to the same scene's Results view. Follow queued/waiting/running jobs, cancel or explicitly retry, compare a candidate with the current take, approve images before video work, approve results for Edit, or keep the original. Previous takes remain visible. Obsolete candidates cannot replace current work.
8. **Edit.** The tab unlocks with the first approved video take. Approved results appear automatically in the episode Edit view. Preview the episode, reorder scenes and open an individual scene editor for shot order, playback, source in/out trims and take history. Scenes without approved footage show a useful return-to-scene message. Export remains a JSON timeline manifest, not rendered video.

Changing an approved script marks its scene plans and existing output for review. Changing a scene's creative plan or direction invalidates that scene's plan approval; reference changes invalidate affected generation output while leaving plan approval separate. Script approval, scene-plan approval, reference readiness and result approval are distinct states. Generation and retries enforce the approval/readiness boundary before any charge. Current footage stays on the timeline through revisions.

Splitting moves existing shots into two plans, both requiring review. Merging combines adjacent scenes and preserves moved shots' reference inputs as overrides. Both operations retain takes and update job ownership. Each resulting scene must fit the 3–90-second range, with 1–30-second shot targets. Altering a scene duration redistributes generation targets without replacing existing timeline trims.

## Routes and components

- `/projects/:projectId/episodes/:episodeId?tab=script|scenes|edit`: `EpisodePage`, with shared `EpisodeNavigation`.
- `/projects/:projectId/episodes/:episodeId/scenes/:sceneId?step=plan|references|results`: persistent `SceneWorkspace`.
- `/projects/:projectId/episodes/:episodeId/scenes/:sceneId/edit`: existing `Editor`, available after footage is approved.
- `/projects/:projectId/episodes/:episodeId/scenes/:sceneId/setup`: compatibility link opening scene References.
- Reference URLs optionally include `shot`, `replace=1`, and a frozen Director `proposal` ID. Single-scene generation actions navigate to References. Multi-scene actions open `BatchGenerationReview`.
- `GenerationDialog` is the retained reusable selection component, now embedded within scene References. `RightPanel` renders AI Director only. `ShotDetails` belongs to the editor.
- `/projects/:projectId/characters` and `/projects/:projectId/characters/:characterId`: searchable character library and Identity / Looks / References studio. `?tab=looks&look=:id` opens a specific Look.
- Existing Assets, Story Bible, queue, exports and settings remain available.

## Characters and references

An identity job creates three pending candidates for 24 demo credits. Explicit approval sets the canonical identity and reuses that asset as an approved front reference. **One valid approved reference is enough** to use the character. Additional angles are optional unless explicitly selected as required for a scene/shot.

Looks inherit the approved identity and require an approved primary image. Identity changes invalidate older Look/reference anchors. Replacements preserve previous versions and approved footage and flag affected shots. Additional Look angles snapshot their approved Look anchor. `MediaVersions`, `Portrait`, and `GenerationActivity` provide candidate comparison, approval, history and progress.

Settings can be selected, uploaded, or created as named drafts from scene References. **Generate setting image · 8 demo cr** uses the shared queue; approval happens in the reference workspace. Other references can serve visual style, setting, camera movement, continuity or sound. Missing files or incompatible media purposes block submission.

## Queue, costs and generation requests

There is one app-level scheduler with two concurrent jobs globally. Jobs survive route changes, support cancellation and explicit retry, retain failed attempts, and prevent duplicate active charges. Reload recovers unfinished work paused and offers Resume. Jobs do not run while the browser is closed.

Image, reference, Look and setting jobs cost 8 demo credits; video jobs cost 24. Identity work creates three candidates for 24. Only the currently eligible step is charged. Continuation video jobs wait for approved source footage. Batch confirmation excludes blocked scenes and lists why.

Each job and resulting take retains immutable input snapshots: approved script/plan revisions, prompt and shot action/dialogue, selected setting asset, direction, duration, aspect ratio, additional reference asset IDs/purposes, and character/Look/reference version IDs. Later edits cannot rewrite a submitted request. The existing mock represents video with still-image holds; generated source spans cover at least eight seconds or the requested shot target, whichever is longer.

## Persistence and migration

The normalized Zustand store remains under `nori-demo-v1`; the stored format is now **version 3**. Versions 1 and 2 migrate additively. Existing production is imported with script/plan approval snapshots so users can continue their existing work. Scripts, scene/shot IDs, trims, takes, characters, reference choices, jobs, credits, conversations and exports remain intact. New episodes require explicit approvals. Version-3 reloads preserve unapproved revisions rather than approving them again.

Zod validates shapes, and relationship validation checks IDs and continuation cycles. Invalid storage loads a visible recovery notice. Storage failures show Session only. Single-browser editing is intended; simultaneous tabs are not synchronized.

Undo/redo is session-local, preserves unrelated job results, and does not refund credits or erase approved media/script/plan history. New scene planning and confirmed structural operations are saved directly. Uploads use session object URLs, capped at 20 MB; their metadata survives reload, and missing media must be reattached in Assets. No media blobs are stored in localStorage.

## Demo scenarios and limitations

Midnight Secrets / The Unlocked Door contains four imported scene plans. The Arrival has approved takes; The Message can generate video; The Discovery needs a selected reference reviewed; The Confrontation demonstrates an unfinished identity and failed/waiting work. Existing saved scene selections take precedence over reset fixtures. Before the Rain is a complete approved animatic fixture. Create a new episode to try the entire Script → Scenes → Edit sequence without resetting saved work.

All bundled art is original labeled SVG placeholder media recorded in `public/media/manifest.json`. Script drafting, scene planning and Director responses are deterministic local demonstrations. No real AI, Seedance integration, model-specific multimodal conditioning, cloud storage, authentication, collaboration, purchases, caption rendering, video export or social publishing is connected. The adapter supports one candidate per shot. Aspect ratio is recorded as a request setting, not a change to episode timeline format. Provider adapters belong behind `src/services` contracts; the present mocks make no provider calls.

## Verification

64 tests across seven files cover existing queue/timeline/character/export regressions and the new workflow: explicit script/plan approvals, upstream invalidation, refresh preserving IDs, split/merge ownership and reference preservation, v2→v3 migration, immutable generation snapshots, independent duplicates, and a full interaction journey from script generation through approved footage appearing in Edit. Tests also verify that scene clicks open plans, reference selection requires plan approval, single-scene generation stays on the scene page and batch review links back to persistent inputs.

`npm run typecheck`, `npm test`, and `npm run build` pass. The production build has a non-blocking large-chunk advisory (about 800 kB minified); route splitting remains a production optimization. Desktop and 390px mobile browser checks cover the new navigation, scene plan/reference layout, mobile action bar, results and Edit. This is a visual/interaction smoke check, not a cross-browser certification or accessibility audit.

## Accessibility and hosting

Radix handles dialog focus/dismissal and keyboard menus. Episode and scene navigation use real links/buttons with current-state attributes; keyboard dnd-kit handles and move buttons support reorder. Numeric trims use integer frames, and resizable panels support keyboard controls. Cmd/Ctrl+K opens navigation; Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z undo/redo outside fields; Space plays/pauses a focused preview; Escape dismisses dialogs. Dark and light modes share tokens; narrow layouts put AI Director in a drawer.

`npm run build` produces `dist/`. Static hosting must fall back to `index.html` for application routes. Vite development and preview support direct links.

## Installable app (PWA)

Production builds emit `manifest.webmanifest` and a Workbox service worker for the installation/update lifecycle. Serve `dist/` over HTTPS (localhost is supported for testing). The browser can install dotori studio as a standalone app; supported browsers show an Install dotori studio tip. On Mac Safari, Install dotori studio explains File → Add to Dock (macOS Sonoma 14 or later). Safari requires this manual browser action; the website cannot open its installation dialog. On iPhone/iPad, the tip explains Safari → Share → Add to Home Screen. App updates wait for the user's Reload action instead of interrupting editing.

dotori studio is online-only. The worker does not precache the app, provide an offline navigation fallback, or cache API responses/media at runtime. If connectivity is lost while the app is open, a connection-required screen replaces the studio; reconnecting restores it. A cold launch without network access may show the browser's own offline page. Existing localStorage persistence is unchanged; it is local draft storage, not offline app support. Uploaded session URLs remain temporary. There is no background generation or offline write queue.

Test using `npm run build` then `npm run preview`, not the development server. Inspect the manifest, icon dimensions and service worker in browser developer tools. Confirm Cache Storage does not contain app-shell/media precaches. Switch offline with the app open to verify the connection-required screen, then reconnect. Rebuild while the app is open and check that a new worker offers Reload / Later. OS installation must be checked on the target devices.

Hosting must serve `/sw.js`, `/manifest.webmanifest`, `/icons/*` and built assets as actual files before the SPA fallback. Use `Cache-Control: no-cache` for `sw.js`, the manifest and `index.html`; hashed `/assets/*` may use long immutable caching. Keep `/api` and `/auth` routes outside the SPA fallback. PWA workers are disabled in development.

## Demo login and profile

Browser and installed-app entry routes pass through a frontend-only demo gate. `/login` accepts any email/password input, including empty fields; Google and Apple buttons simulate entry without contacting providers. The password is never read or stored. `/app` is the PWA start route; signed-out deep links return to their original route after sign-in.

`nori-demo-account-v1` stores a demo sign-in flag and profile name/email on this device. This is not secure authentication or account isolation: all demo identities use the same existing local studio data. Sign out keeps projects and credit history. The sidebar profile strip appears below Project Settings and remains accessible when collapsed or in mobile navigation. Its menu shows the profile, Starter demo membership, and the live studio credit balance. Recharge adds demo credits without payment; `/profile/settings` edits name/email and exposes membership and session controls. Real auth, subscription billing and paid recharge require backend integration.

## Public product page and entry routes

`/` is the public product landing page, including for signed-in browser visitors. Its login and studio calls to action lead to `/login`. The page has an interactive sample storyboard, workflow explanation, character/look examples, and expandable questions explaining the demo. The login logo returns to the public site.

The manifest uses `/login` as `start_url`, retaining the existing `/` app ID. Signed-out installed launches open login; an existing signed-in session continues to Projects. A standalone launch at `/` (including older Safari shortcuts) also routes to login instead of the marketing page. `/app` remains a compatible studio entry route. Protected deep links still preserve their destination. Browser registration and installed OS shortcuts can update on different schedules; existing installations may need to be reopened or reinstalled to adopt a new launch URL.

## Product branding

The displayed product name is lowercase **dotori studio**, including page metadata, installation names, wordmarks, accessibility labels, generated media labels and export branding. The existing app ID (`/`) and the two legacy storage identifiers (`nori-demo-v1`, `nori-demo-account-v1`) remain stable so existing installations, saved studio work and demo profiles continue to load. Those identifiers are compatibility details and are not displayed in the interface.

## Contextual AI Director

Episodes default to Script; explicit Scenes/Edit links keep their selected destination. The Director starts closed and has no top-banner toggle. Draft new version opens its composer for a discussion without immediately replacing the script; Edit with AI opens a scene-scoped composer. Desktop panels slide in and resize without remounting the working document; narrow layouts use a drawer. Reduced-motion preferences disable the animation. Reference-card candidate approval actions stack within their card at every viewport width.

The top project action is consistently Export: in an episode it opens export options; elsewhere in the project it opens Exports. Locked episode step URLs fall back to the available step. Existing footage and scene plans remain accessible through subsequent revisions.

+
+## Flexible video generation and frame conditioning
+
+Script is the primary entry point. Create scene plans and Generate episode sit together above the screenplay. Generate episode opens the shared reference/preflight dialog directly, preparing an approved internal breakdown when needed; the explicit planning path still lets the user review plans first. Generating from a revised script refreshes the source plans while preserving IDs, references, takes and edits. Opening the dialog never charges credits. Scenes uses the same dialog, and individual scene headers offer Generate scene beside Edit with AI.
+
+The new video flow generates directly from scene descriptions and multimodal references. Image generation is optional. Per-shot starting and ending frame asset IDs are distinct from character, setting and other references, persist through the schema, and are captured in job/take input snapshots. Invalid, cross-project or missing frames are rejected before video submission. Existing legacy image-first data and commands remain supported.
+
+Choose from assets and Upload image stay inside the video dialog. Create image with AI opens a focused composition workspace: large central preview, candidate alternatives underneath, and an image-focused AI Director on the right with inherited reference context. Image generation queues a normal local image job at the displayed cost. Use as starting/ending frame explicitly attaches the selected image and returns to the preserved video selections; Back returns without applying it. Uploads remain session-only and need reattachment after reload. The current demo accepts both frame positions; provider capabilities must be enforced when real video adapters are connected.
+
+Generation remains local simulated storyboard output; no real image/video model or billing is connected. Tests cover direct script-to-video submission, optional image creation and return, shot-isolated frame application, missing-frame rejection, immutable conditioning snapshots and credit accounting.
+