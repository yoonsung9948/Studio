# dotori studio

A local-first React production workspace for short films, with **Board / Script / Timeline / Review** views of the same episode. The initial route is `/projects`. No account, API key, backend, or paid service is required.

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

## Studio workspace

The application is a fixed full-height tool: a 48px icon rail, 40px top bar, independently scrolling panels and a bottom Activity tray. Board, Script, Timeline and Review are views over the same episode and shot selection. There are no scene-page or planning-step gates in the primary app.

- **Home:** an idea or screenplay creates an editable board with zero credits spent. Templates, recent episodes and projects share the same entry.
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

The storage key stays **`nori-demo-v1`**, format **version 3**. New fields are optional: project strict-approval policy and props/notes, episode style/archive state, shot camera/lock/World assignments, take discard state, media archive state and UI density/inspector preferences. Existing saves remain compatible; versions 1 and 2 retain the original migrations. Uploaded URLs are session-only and require reattachment after reload. Public landing/login/PWA entry behavior is unchanged.

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

Browser and installed-app entry routes pass through a frontend-only demo gate. `/login` accepts any email/password input, including empty fields; Google and Apple buttons simulate entry without contacting providers. The password is never read or stored. `/app` is the PWA start route; signed-out deep links return to their original route after sign-in.

`nori-demo-account-v1` stores a demo sign-in flag and profile name/email on this device. This is not secure authentication or account isolation: all demo identities use the same existing local studio data. Sign out keeps projects and credit history. The profile menu sits beside the credits in the global top bar. Its menu shows the profile, Starter demo membership, and the live studio credit balance. Recharge adds demo credits without payment; `/profile/settings` edits name/email and exposes membership and session controls. Real auth, subscription billing and paid recharge require backend integration.

## Public product page and entry routes

`/` is the public product landing page, including for signed-in browser visitors. Its login and studio calls to action lead to `/login`. The page has an interactive sample storyboard, workflow explanation, character/look examples, and expandable questions explaining the demo. The login logo returns to the public site.

The manifest uses `/login` as `start_url`, retaining the existing `/` app ID. Signed-out installed launches open login; an existing signed-in session continues to Projects. A standalone launch at `/` (including older Safari shortcuts) also routes to login instead of the marketing page. `/app` remains a compatible studio entry route. Protected deep links still preserve their destination. Browser registration and installed OS shortcuts can update on different schedules; existing installations may need to be reopened or reinstalled to adopt a new launch URL.

## Product branding

The displayed product name is lowercase **dotori studio**, including page metadata, installation names, wordmarks, accessibility labels, generated media labels and export branding. The existing app ID (`/`) and the two legacy storage identifiers (`nori-demo-v1`, `nori-demo-account-v1`) remain stable so existing installations, saved studio work and demo profiles continue to load. Those identifiers are compatibility details and are not displayed in the interface.


### Home and navigation

The left rail expands locally to show labels and projects. The global top bar contains only credits and the existing account menu; view and generation controls live inside the episode workspace. The outline has its own toggle.

Home shows all work with project and media-type filters and a floating draft composer. Projects has its own card browser. Choose Episode, Scene, or Shot, an optional project, and duration. No project creates unfiled work using the same domain engine; it appears on Home and can be filtered to unfiled shots/scenes. Draft creation spends no credits. Optional `Project.unfiled` and `Episode.creationKind` fields remain compatible with the `nori-demo-v1` v3 save format.

### Project scope and World browser

Home and Projects are the only primary global destinations. Project navigation appears under the opened project in the sidebar, with Episodes, World, and Library. Opening unfiled work keeps Home active and does not select a project. Existing project and character deep links remain supported.

World opens a card grid with Characters, Places, Props, and Notes categories, search, and category-specific Add actions. Select cards to inspect usage, use modifiers for multiple selection, and double-click or choose Open for the full editing sheet. Back restores the category, search, and grid scroll position. Touch taps open cards directly. Character sheets retain identity, looks, angles, generation, and shot-usage actions.

### Selected logo

The selected `d.` monogram is rendered as a font-independent vector by `src/components/Brand.tsx`. The collapsed studio rail shows the non-interactive mark; the expanded rail shows the lowercase wordmark. Product header/footer, the product preview, and login use the same branding. `public/brand/dotori-mark.svg` is the transparent standalone mark; `public/favicon.svg` is the browser tile. Apple (180px), PWA (192px/512px), and maskable (512px) PNG icons use the same geometry, with extra safe-area spacing for the maskable icon. Icon references have a release query so existing caches can refresh.
