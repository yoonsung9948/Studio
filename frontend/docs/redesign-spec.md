# dotori studio: UI/UX redesign spec

> **How to use this document (instructions for the implementing AI)**
>
> You are implementing a UI/UX redesign of an existing React app called **dotori studio**. This document is the source of truth.
>
> - Read the whole document before writing code. Then read the files listed in §2 before you change them.
> - Implement **phase by phase** (see §17). Finish each phase with `npm run typecheck`, `npm test` and `npm run build` passing before you start the next one.
> - **Do not change domain semantics** (job queue, credits, input snapshots, invalidation, undo, persistence and migration) unless a section explicitly says to. This redesign is mostly a presentation-layer rewrite on top of the existing domain layer in `src/domain/`.
> - Add **no new npm dependencies** unless a section names one. Everything here can be built with what is already installed: React 19, React Router 7, Zustand 5, Zod 4, Radix (dialog, dropdown-menu, tabs, tooltip, slot), dnd-kit, react-resizable-panels 4, lucide-react, Tailwind 4, Vitest and Testing Library.
> - Where this spec and the existing code disagree about **UI**, follow this spec. Where they disagree about **data rules**, follow the code and leave a `// TODO(redesign):` comment that explains the conflict.
> - Write code that matches the existing style: TypeScript strict, function components, `useStore` selectors, mutations through `mutate((d) => …, undoable)`.
> - When you finish a phase, summarize what changed, which files changed, and anything you skipped.

---

## 1. Product context

dotori studio is a local-first web app for making short AI-generated films and series. A **project** contains **episodes**. An episode has a **script**, which is broken into **scenes**, and each scene contains **shots**. Each shot is generated as images and video (**takes**), using **characters** (with **looks** and reference angles), **locations** and other reference media. Approved takes are assembled on a **timeline** and exported.

All AI behavior is currently mocked (`src/services/mock.ts`). Jobs cost demo credits and run through a local queue with 2 concurrent jobs.

### 1.1 Why we are redesigning

Today's app **feels like a website, not a tool**. After an episode is created, the user moves through a chain of pages and approval gates:

`Script tab → Scenes tab → scene page → Plan step → References step → Results step → separate Editor route → back to the Edit tab`

Problems:

1. **The film as a whole is never visible.** The user is always inside one form for one stage of one scene.
2. **Shots are second-class.** They are what users actually generate and review, but they are hidden under "Shot breakdown (optional detail)".
3. **Too many approval gates.** Script approval, plan approval, image approval and video approval all come before the user sees results.
4. **Generate actions are duplicated and inconsistent.** "Generate episode" appears twice, then "Generate scene", "Generate video · 3 shots · 72 cr", "Generate / adjust inputs" and "Generate".
5. **Statuses are inconsistent.** One scene card can show "Choose references", "Plan approved", "Review result" and "Open scene" at the same time.
6. **Website layout.** Pages scroll as a whole, headers are large, marketing taglines appear inside the workspace ("01 / DEVELOP THE STORY", "Shape this moment."), and there are few context menus, little multi-select and few shortcuts.
7. **The scene board doesn't scale.** It shows about one scene card per screen, with pagination of 6 scenes.

### 1.2 What competitors do (design references)

LTX Studio, Morphic, Higgsfield (Popcorn and Cinema Studio), Google Flow, Katalist, Boords, StudioBinder and OpenArt converge on these patterns:

- The **shot is the main unit**. Scenes are groups of shots on **one board**.
- **Script, Board and Timeline are views of the same shots.**
- **Cast, locations and props are reusable "elements"**, detected from the script and attached to shots (`@mentions` or drag-and-drop). Shots inherit them from the scene, with per-shot overrides.
- **Cheap stills first, then animate** the ones you like.
- **One optional review checkpoint**, not a gate at every step.
- **Regenerate in place.** New versions stack on the shot, and an approved version replaces the old one in the edit.
- **Style is set once per project or episode.**
- **An AI director turns a brief into shots**, which the user then edits.
- **Every frame has a status**, and there is a view-only review mode.

---

## 2. Current codebase (read these before changing anything)

```
src/
  main.tsx                     BrowserRouter > PwaControls > DemoAuthGate > App
  app/App.tsx                  Shell: sidebar, topbar, routes, Director panel, ⌘K, queue sheet, toasts
  stores/store.ts              Zustand store: data, ui, mutate(fn, undoable), undo/redo, localStorage "nori-demo-v1" v3
  stores/director.ts           openDirector(prompt): opens the AI Director panel with a prompt
  stores/account.ts            demo account state
  domain/types.ts              Data model (Project, Episode, Scene, Shot, Take, Asset, GenerationJob, Character, StudioData, UI)
  domain/schemas.ts            Zod schemas (dataSchema, uiSchema). UPDATE THESE when types change
  domain/validation.ts         relationship validation
  domain/selectors.ts          active, shotsOfScene, shotsOfEpisode, stage, nextOperation, isBusy, preflight, duration, costFor …
  domain/commands.ts           enqueueGeneration, enqueueExact, approveTake, trimShot, reorderShots, updateScript, cancelJob, retryJob, proposals …
  domain/workflow.ts           scriptApproved, scenePlanApproved, approveScript, updateScenePlan, approveScenePlan, approveEpisodePlans,
                               createPlannedScene, draftScript, planScenes, splitScene, mergeSceneWithNext, sceneWorkflowLabel
  domain/scene-preflight.ts    scenePreflight (blockers/warnings), referenceSnapshot, ensureSetup, updateShotPlan
  domain/generation-inputs.ts  generationInputs, saveGenerationInputs, saveGenerationCast, generationInputSnapshot
  domain/video-workflow.ts     prepareVideoGeneration (auto-approves script and plans for the direct-video path)
  domain/studio-commands.ts    characters, looks, references, locations, versions, approveVersion, setSceneCast, updateDirection …
  domain/studio-selectors.ts   characterReady, lookReady, effectiveCast, versionAsset …
  services/contracts.ts, mock.ts   generationService (queue ticker), directorService, exportService
  components/Actions.tsx       modal system: useActions() → { kind: "confirm" | "form" | "video" | "export" | … }
  components/Sortable.tsx      dnd-kit SortableList/SortableItem
  components/ui/*              Radix-based button, dialog, dropdown-menu, tabs, tooltip
  features/Gallery.tsx         Projects, Episodes, SearchBox, NotFound
  features/Episode.tsx         EpisodePage (Script / Scenes / Edit tabs)                 → REPLACED
  features/SceneWorkspace.tsx  scene page with Plan / References / Results              → REPLACED
  features/EpisodeNavigation.tsx                                                        → REMOVED
  features/Editor.tsx, Player.tsx, ShotDetails.tsx   scene timeline editor, player     → REUSED inside Timeline view
  features/generation/GenerationDialog.tsx (1600 lines) reference/preflight UI         → SPLIT into inspector sections
  features/generation/FrameControls.tsx, ImageWorkspace.tsx, BatchGenerationReview.tsx → REUSED
  features/characters/*        CharacterLibrary, CharacterDetail, MediaVersions        → MOVED into World
  features/Supporting.tsx      Queue, Bible, Assets, Exports, Settings                 → REDISTRIBUTED
  features/Director.tsx, RightPanel.tsx  AI Director chat                              → becomes an inspector tab
  features/account/*, marketing/*  login, profile, product page                        → mostly unchanged
  styles/index.css             ~7,900 lines of hand-written CSS with tokens on :root and [data-theme="light"]
test/                          Vitest + Testing Library tests (domain and full-flow)
```

### 2.1 Domain invariants you must preserve

- `mutate(fn, true)` creates an undo step. Undo must never refund credits or erase approved media or history.
- Every job and take stores an **immutable input snapshot** (`inputs`, `references`). Never rewrite a submitted request.
- Changing the script marks plans and shots for review (`stale`, `sourceScriptRevision`). Changing a plan or direction invalidates generated output. Keep that logic. Only change **how it is shown**.
- `enqueueGeneration` checks `scenePreflight` blockers and credits before charging. Keep the checks. §7.9 changes **when approvals happen**, not whether inputs are validated.
- Storage key `nori-demo-v1` and storage version **3** stay. Any new persisted field must be **optional** in the Zod schema so existing saves load without errors.
- Demo seed scenarios (`src/mocks/seed.ts`, `studio-seed.ts`) must still load and be usable.

---

## 3. Design goals

1. **Feel like a professional tool:** fixed-viewport layout, panels instead of pages, dense, keyboard-driven, selection-based.
2. **A fast simple path:** idea → watchable episode in about 3 clicks, with no forced approvals.
3. **Depth for serious productions:** per-shot control, multi-select batch edits, overrides, a timeline, versions and review.
4. **Room to grow:** new features plug in as a **command**, an **inspector section** or a **view**, never as a new page.
5. **Consistency:** one layout, one status vocabulary and one command system everywhere.

## 4. Design principles (apply to every screen)

| # | Principle | Concretely |
|---|---|---|
| P1 | The window doesn't scroll; panels do | The `body` and app shell are `height: 100dvh; overflow: hidden`. Only panel bodies scroll. |
| P2 | Select, then act | Clicking selects. The inspector shows the selection. Commands act on the selection. |
| P3 | One command system | Buttons, context menus, ⌘K and shortcuts all call the same registered command. |
| P4 | One primary action per level | Episode: **Generate**. Shot: **Redo / Animate**. Everything else is secondary or lives in a "…" menu. |
| P5 | Edit in place and undo | No Save buttons. Fields commit on blur or Enter. Confirm dialogs only for spending credits above a threshold or for permanent deletion. Destructive structural changes show a toast with **Undo**. |
| P6 | One status vocabulary | Draft · Still · Video · Locked, plus badges (see §7.4). |
| P7 | Progressive disclosure | Inspector sections are collapsible, and there is a global **Simple / Advanced** toggle. Advanced controls never appear in Simple mode. |
| P8 | No marketing copy in the workspace | Remove eyebrows and taglines ("EPISODE 01 / YOUR STORY…", "01 / DEVELOP THE STORY", "Shape this moment.", "MAKE IT VISUAL", "REVIEW THE MOMENT"). Explanations live only in empty states and tooltips. |
| P9 | Show cost next to the action | Every button that spends credits shows it, for example "Animate · 24 cr". |
| P10 | Density setting | Comfortable (default) or Compact. Compact reduces padding and row heights by about 25%. |

### 4.1 Copy rules
Use sentence case everywhere. Buttons are verb-first and 1–3 words ("Generate stills", "Animate", "Lock shot"). Don't use "please", "successfully", "simply" or "!". Empty-state headings name the space ("Start your first episode"), followed by one line of body text and a verb CTA.

---

## 5. Information architecture and routes

### 5.1 New structure

```
Home (/projects)
  ├─ New box: start from idea / script / blank
  └─ Recent episodes, then all projects

Project (/projects/:projectId?tab=episodes|world|library)
  ├─ Episodes   list or grid of episodes
  ├─ World      characters · places · props · notes (story bible)
  └─ Library    media · renders (exports)

Episode workspace (/projects/:projectId/episodes/:episodeId?view=board|script|timeline|review&scene=&shot=)

Always available: ⌘K command palette · Activity tray · Account/credits popover
```

### 5.2 Route table

| Route | Component | Notes |
|---|---|---|
| `/` , `/login`, `/app`, `/profile/settings` | unchanged | Product page, login, PWA entry and profile stay as they are. |
| `/projects` | `HomePage` (new) | Replaces `Projects` in `Gallery.tsx`. |
| `/projects/:projectId` | `ProjectPage` (new) | `?tab=episodes` (default), `world` or `library`. |
| `/projects/:projectId/episodes/:episodeId` | `EpisodeWorkspace` (new) | `?view=board` (default), `script`, `timeline` or `review`. `?scene=` and `?shot=` set the selection. |

### 5.3 Legacy redirects (keep old links and tests navigable)

Implement these with a small `<LegacyRedirect>` component that reads params and does `<Navigate replace>`:

| Old | New |
|---|---|
| `/projects/:pid/episodes` | `/projects/:pid?tab=episodes` |
| `/projects/:pid/episodes/:eid?tab=script` | `…/episodes/:eid?view=script` |
| `…?tab=scenes` | `…?view=board` |
| `…?tab=edit` | `…?view=timeline` |
| `/projects/:pid/episodes/:eid/scenes/:sid` (any `step`) | `…/episodes/:eid?view=board&scene=:sid` (append `&shot=` if present) |
| `…/scenes/:sid/edit` | `…/episodes/:eid?view=timeline&scene=:sid` |
| `…/scenes/:sid/setup` | `…/episodes/:eid?view=board&scene=:sid&panel=references` |
| `/projects/:pid/characters` | `/projects/:pid?tab=world&type=character` |
| `/projects/:pid/characters/:cid` (+ `tab`, `look`) | `/projects/:pid?tab=world&type=character&id=:cid` (+ `&section=` and `&look=`) |
| `/projects/:pid/bible` | `/projects/:pid?tab=world&type=note` |
| `/projects/:pid/assets` | `/projects/:pid?tab=library` |
| `/projects/:pid/exports` | `/projects/:pid?tab=library&filter=renders` |
| `/projects/:pid/queue` | `/projects/:pid?tab=episodes&activity=open` (opens the Activity tray expanded) |
| `/projects/:pid/settings` | `/projects/:pid?tab=episodes&dialog=project-settings` |

`scenePreflight` builds `href`s that point to `/…/scenes/:sid/setup`. Either update them to the new URL form or rely on the redirect. Prefer updating them.

---

## 6. Foundation (Phase 1). Build this before any visible screen.

### 6.1 App shell layout

```
┌──────┬───────────────────────────────────────────────────────────────┐
│ Rail │ Top bar (40px): breadcrumb · view switcher · contextual actions │
│ 48px ├───────────────────────────────────────────────────────────────┤
│      │                                                               │
│ icons│        Route content (fills the rest, no page scroll)         │
│      │                                                               │
│      ├───────────────────────────────────────────────────────────────┤
│      │ Activity tray (28px collapsed / up to 40% expanded)           │
└──────┴───────────────────────────────────────────────────────────────┘
```

- **Rail (48px, icons and tooltips):** Home, then (when inside a project) Episodes, World, Library. At the bottom: Activity (with a count badge), ⌘K, theme, and the account avatar (which opens the account/credits popover). This replaces the 226px sidebar and its "WORKSPACE / STORY / LIBRARY / PRODUCTION" sections. Remove the sidebar intro copy ("A little idea…").
- **Top bar:**
  - Left: breadcrumb (`Project ▸ Episode title`). Each segment is a dropdown switcher (project switcher, episode switcher).
  - Center: the route's view switcher, when it has one (Episode: Script · Board · Timeline · Review).
  - Right: a save indicator ("Saved" / "Session only", 12px, muted), credits (`✧ 1,200`), and the route's primary action.
- **Activity tray:** see §13.
- **Mobile (<768px):** the rail becomes a bottom tab bar (Home, Episodes, World, Library, More), and the top bar collapses to the title and primary action. See §16.
- The whole shell is `height: 100dvh; display: grid; grid-template-columns: 48px 1fr; grid-template-rows: 40px 1fr auto; overflow: hidden`.

Create `src/app/Shell.tsx`, `src/app/Rail.tsx`, `src/app/TopBar.tsx` and `src/app/ActivityTray.tsx`. Move routing into `src/app/routes.tsx`. Then slim `App.tsx` down to providers plus the shell.

### 6.2 Workspace store (selection and transient UI). New file `src/stores/workspace.ts`

This store is **not persisted**, except the fields noted below, which go in `ui`.

```ts
export type EntityRef =
  | { kind: "episode"; id: string }
  | { kind: "scene"; id: string }
  | { kind: "shot"; id: string }
  | { kind: "take"; id: string }
  | { kind: "character"; id: string }
  | { kind: "look"; id: string }
  | { kind: "location"; id: string }
  | { kind: "asset"; id: string }
  | { kind: "note"; id: string }      // story bible entries (see §11.4)
  | { kind: "job"; id: string };

interface WorkspaceState {
  selection: EntityRef[];               // ordered; selection[0] is the "primary" selection
  anchor?: EntityRef;                   // for shift-range selection
  hover?: EntityRef;
  inspectorTab: "inspect" | "director" | "comments";
  activityOpen: boolean;
  paletteOpen: boolean;
  select(ref: EntityRef, mode?: "replace" | "toggle" | "range"): void;
  selectMany(refs: EntityRef[]): void;
  clear(): void;
}
```

Rules:
- Click selects ("replace"). Cmd/Ctrl-click toggles. Shift-click selects a range within the same ordered list (the board uses episode shot order).
- `Esc` clears the selection. `Cmd/Ctrl+A` selects all items in the focused view.
- The selection is mirrored to the URL for the **primary** shot or scene (`?shot=` / `?scene=`), so links and reloads restore it. Multi-selection is not put in the URL.
- When a selected entity is deleted, remove it from the selection.

Add these optional persisted fields to the `UI` type **and** to `uiSchema` (each with `.optional()`):

```ts
density?: "comfortable" | "compact";
detail?: "simple" | "advanced";
boardZoom?: number;            // card size step 1–5
boardGroupBy?: "scene" | "none" | "status";
inspectorCollapsed?: Record<string, boolean>; // section id → collapsed
```

The existing `layouts` field stores panel sizes. Keep using it, with keys like `episode-workspace`.

### 6.3 Command registry. New folder `src/commands/`

```ts
// src/commands/types.ts
export interface CommandContext {
  data: Data;
  selection: EntityRef[];
  route: { projectId?: string; episodeId?: string; view?: string };
  mutate: Store["mutate"];
  navigate: (to: string) => void;
  modal: ReturnType<typeof useActions>;
}
export interface Command {
  id: string;                                   // "shot.animate"
  title: string | ((ctx: CommandContext) => string);   // can include cost: "Animate · 72 cr"
  group: "Navigate" | "Generate" | "Edit" | "Structure" | "View" | "Review" | "World" | "Library" | "App";
  icon?: LucideIcon;
  shortcut?: string;                            // "mod+enter", "a", "shift+r"
  when?: (ctx: CommandContext) => boolean;      // visible and enabled?
  disabledReason?: (ctx: CommandContext) => string | undefined;   // shown as a tooltip instead of silently disabling
  run: (ctx: CommandContext) => void | Promise<void>;
}
```

- `registerCommands(cmds: Command[])` and a `useCommands()` hook that returns the commands available in the current context.
- `useCommand(id)` returns `{ run, title, enabled, reason }` for buttons.
- `<CommandMenu items={[...ids]} />` renders a Radix dropdown or context menu from command ids. Use it for all "…" menus and right-click menus.
- A global keyboard handler, `src/commands/keyboard.ts`, maps shortcuts to commands. It ignores keystrokes while focus is in an `input`, `textarea`, `select` or contenteditable, except `mod+…` combos and `Esc`.
- The existing ⌘K dialog in `App.tsx` becomes `CommandPalette.tsx`. It searches **commands and entities**: projects, episodes, scenes ("Go to scene 12"), shots, characters, locations and assets. The query is fuzzy-matched. Results are grouped. ↑↓ moves through them and Enter runs one.

#### 6.3.1 Initial command list (implement all of these)

| id | Title | Shortcut | When |
|---|---|---|---|
| `app.palette` | Command palette | `mod+k` | always |
| `app.undo` / `app.redo` | Undo / Redo | `mod+z` / `shift+mod+z` | always |
| `app.toggleTheme` | Toggle theme | – | always |
| `app.toggleDensity` | Compact density | – | always |
| `app.toggleDetail` | Advanced controls | `shift+mod+a` | always |
| `app.toggleActivity` | Activity | `mod+j` | always |
| `nav.home` / `nav.episodes` / `nav.world` / `nav.library` | Go to … | `g h` / `g e` / `g w` / `g l` | in project for the last three |
| `view.script` / `view.board` / `view.timeline` / `view.review` | Script / Board / Timeline / Review | `1` `2` `3` `4` | in episode |
| `inspector.toggle` | Toggle inspector | `mod+.` | in episode or world |
| `inspector.director` | Ask Director | `mod+i` | in episode or world |
| `episode.generate` | Generate · N cr (§7.9) | `mod+enter` | in episode |
| `shots.generateStills` | Generate stills · N cr | `s` | selection has shots |
| `shots.animate` | Animate · N cr | `v` | selection has shots |
| `shots.redo` | Redo selected · N cr | `r` | selection has shots |
| `shots.lock` / `shots.unlock` | Lock / Unlock | `l` | selection has shots with a video take |
| `takes.accept` | Use this take | `a` | selection has a shot with a candidate, or a take |
| `takes.reject` | Discard take | `x` | candidate present |
| `takes.prev` / `takes.next` | Previous / next take | `[` / `]` | shot selected |
| `shots.add` | Add shot | `n` | in episode |
| `shots.duplicate` | Duplicate shot | `mod+d` | shots selected |
| `shots.delete` | Delete shot | `backspace` | shots selected (toast with Undo, no confirm) |
| `scenes.add` | Add scene | `shift+n` | in episode |
| `scenes.split` | Split scene at shot | – | one shot selected that isn't the first in its scene → `splitScene` (see note) |
| `scenes.mergeNext` | Merge with next scene | – | scene or shot selected |
| `shots.moveUp` / `shots.moveDown` | Move earlier / later | `alt+↑` / `alt+↓` | shots selected |
| `select.all` / `select.none` | Select all / none | `mod+a` / `esc` | in a view |
| `select.next` / `select.prev` | Next / previous item | `→` `↓` / `←` `↑` | in board or timeline |
| `episode.refreshFromScript` | Update shots from script | – | in episode with stale scenes |
| `episode.export` | Export… | `shift+mod+e` | in episode |
| `episode.share` | Copy review link | – | in episode (demo: copies the URL with `?view=review`) |
| `world.newCharacter` / `world.newPlace` / `world.newProp` / `world.newNote` | New … | – | in project |
| `library.upload` | Upload media | `mod+u` | in project |

Note: `splitScene(d, id)` currently splits at a fixed point. Add an optional `atShotId` parameter in `domain/workflow.ts` that moves the shots from `atShotId` onward into the new scene. Keep the current behavior when it's omitted. Add a domain test.

### 6.4 Inspector registry. New folder `src/inspector/`

```ts
export interface InspectorSection {
  id: string;                            // "shot.prompt"
  title: string;                         // "Prompt"
  appliesTo: EntityRef["kind"][];        // ["shot"]
  multi?: boolean;                       // supports multi-selection (batch edit)
  detail?: "simple" | "advanced";        // "advanced" → only shown in Advanced mode
  order: number;
  defaultCollapsed?: boolean;
  render: (props: { refs: EntityRef[] }) => ReactNode;
}
```

- `<Inspector />` reads the selection, picks the sections whose `appliesTo` includes the primary kind (and that set `multi` when more than one item is selected), filters by detail mode, sorts by `order`, and renders each as a collapsible section. Collapsed state is persisted in `ui.inspectorCollapsed`.
- Inspector header: an entity icon and name (editable inline for shot, scene and character), the status chip, and a "…" `CommandMenu` with the relevant commands.
- Tabs at the top of the inspector: **Inspect** · **Director** · (later) **Comments**. The Director tab renders the existing `Director` component (`features/Director.tsx`), scoped to the selection. The separate right-hand Director panel and `RightPanel.tsx` go away. `openDirector(prompt)` must now switch to the Director tab (update `stores/director.ts`).
- With **nothing selected** in an episode, the inspector shows **episode** sections (§7.6).
- With **mixed kinds** selected, show only "N items selected" and the commands that apply to them all.

### 6.5 Panels and layout primitives

- Use `react-resizable-panels` for every multi-panel screen. Persist sizes under `ui.layouts[<screen-id>]`.
- Panels can be collapsed (double-click the separator, or use a command). Minimum sizes: outline 200px, inspector 280px, center 400px.
- Create `src/components/layout/PanelHeader.tsx`, a 36px header holding a title, optional tabs and actions.
- Create `src/components/StatusChip.tsx` (§7.4), `src/components/CostLabel.tsx` and `src/components/EmptyState.tsx` (icon, heading, one line of text, CTA).

### 6.6 Visual system adjustments (`styles/index.css`)

- Keep the existing tokens (`--bg`, `--surface`, `--raised`, `--border`, `--text`, `--muted`, `--accent`, `--green`, `--amber`, `--blue`, `--danger`) and both themes.
- Add density tokens on `:root` and redefine them under `[data-density="compact"]`: `--row-h` (32px / 26px), `--pad` (12px / 8px), `--gap` (8px / 6px), `--card-pad` (8px / 6px). Set `document.documentElement.dataset.density` from `ui.density`.
- Base font size stays 13px. Headings inside the workspace are at most 15px (panel titles 13px/500). Remove the 28–32px page headings everywhere except Home and empty states.
- Write new component styles as small, scoped class blocks or Tailwind utilities. **Delete** CSS for removed components (`.episode-header`, `.workflow-*`, `.scene-plan-*`, `.scene-workspace-*`, `.scene-workflow-nav`, `.scene-result-*`, `.sidebar-intro` and so on) once they're unused. Target: `index.css` shrinks, not grows.
- Focus rings: `outline: 2px solid var(--accent); outline-offset: 2px` on `:focus-visible` for every interactive element.
- Selection style: a 2px `--accent` outline on selected cards and rows, and `--hover` background on hover.

---

## 7. Episode workspace (Phase 2, the core)

File: `src/features/episode/EpisodeWorkspace.tsx`, with subfolders `board/`, `script/`, `timeline/`, `review/`, `outline/` and `inspector-sections/`.

### 7.1 Layout

```
┌ Top bar: Project ▸ Episode ▾ │ [Script][Board][Timeline][Review] │ Saved · ✧1,200 · [Generate · 72 cr] ┐
├──────────────┬──────────────────────────────────────────────┬────────────────────────┤
│ Outline      │ Center view (Board | Script | Timeline |     │ Inspector              │
│ 240px        │ Review)                                      │ 340px                  │
│ (collapsible)│                                              │ [Inspect][Director]    │
│              │                                              │                        │
├──────────────┴──────────────────────────────────────────────┴────────────────────────┤
│ Activity tray                                                                        │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

- Review view hides the outline and inspector (full-screen player).
- Under 1100px, the outline becomes a left drawer and the inspector becomes a right drawer or bottom sheet (§16).
- **Remove** from the episode screen: the episode header block (eyebrow, h1, synopsis, progress row), `EpisodeNavigation`, the section headings, `.workflow-demo-note` and `.script-approval-bar`. The episode title is edited inline in the breadcrumb or in the episode inspector section. The synopsis and target duration live in the episode inspector.

### 7.2 Outline panel (left)

Two stacked sections, each collapsible:

1. **Scenes:** a tree. Scene rows show the number, title, a duration total, and an aggregate status dot (§7.4). Expanding a scene shows its shot rows (number, title, status chip). Behavior:
   - Clicking a row selects that scene or shot and scrolls the center view to it.
   - Rows can be dragged to reorder (dnd-kit). Dragging shots between scenes is allowed: call a new domain function `moveShot(d, shotId, toSceneId, index)` (add it in `domain/commands.ts`; it marks both scenes' plans for review exactly like split/merge do, and updates job ownership the same way `restoreEdit` does).
   - Right-click opens the `CommandMenu` (add shot, duplicate, split here, merge with next, delete).
   - A filter input at the top ("Filter scenes and shots") and a filter menu: All, Needs attention, Draft, Still, Video, Locked.
2. **Cast and places:** characters, locations and props used in this episode (from scene cast and settings). Each row has a thumbnail and name. Rows drag onto a shot card to attach the element to that shot. Clicking a row selects the entity (the inspector shows a compact character or location view, with an "Open in World" link). A "+" button at the end opens a picker over the project's World.

### 7.3 Board view (default)

- **Scene sections:** each scene renders as a header row (sticky inside the scroll container) followed by a responsive grid of **shot cards**.
  - Scene header: `03` · title (inline-editable) · `20s · 4 shots` · aggregate status · actions on hover: `+ Shot`, Generate scene (§7.9), "…" menu.
  - Clicking the scene header selects the scene.
- **Shot card** (width from `boardZoom`, default ~200px, 16:9 or 9:16 thumbnail using the episode aspect ratio):
  - Thumbnail: the current take, else the candidate, else the image take, else a placeholder that shows the shot's action text in muted type.
  - Video takes play on hover (muted). Shift+Space opens a quick-look preview.
  - Bottom strip: `03.2` · shot title (truncated) · duration · `StatusChip`.
  - Corner badges: a **new take** dot (candidate waiting), **needs update** (stale), **failed** (last job failed), a progress ring while generating, and a lock icon if locked.
  - Cast avatars: up to 3 tiny circles (from `effectiveCast`).
  - Interactions:
    - click selects, Cmd-click toggles, Shift-click selects a range
    - double-click opens the inspector's Prompt section with focus in the prompt
    - right-click opens the `CommandMenu`
    - drag to reorder within or across scenes
    - drop a cast/place/asset onto the card to attach it
  - The last card in each scene is a ghost "+" card (Add shot).
- **Toolbar** (top of the board, 36px): Group by (Scene / Status / None) · card size slider · filter (status) · "Select all needing attention" · count ("12 shots · 2 selected").
- **No pagination.** Virtualize rows if there are more than 60 shots (use a simple windowing approach with `IntersectionObserver`; no new dependency).
- **Empty episode:** an `EmptyState` with three options (Write a script, Describe it to the Director, Add shots by hand).

### 7.4 Status model (single source of truth)

Create `src/domain/status.ts`:

```ts
export type ShotStatus = "draft" | "still" | "video" | "locked";
export type ShotFlag = "generating" | "candidate" | "stale" | "failed" | "waiting";

export function shotStatus(d: Data, shotId: string): { status: ShotStatus; flags: ShotFlag[] } {
  // status:
  //   locked  = shot.currentTakeId is an approved video take
  //   video   = has any video take (candidate or unapproved)
  //   still   = has an image take (imageTakeId or image candidate)
  //   draft   = no takes
  // flags:
  //   generating = an active job (queued/running) exists for the shot
  //   waiting    = an active job in state "waiting"
  //   candidate  = shot.candidateTakeId set, or imageTakeId set and that take is unapproved
  //   stale      = shot.stale || the scene's sourceScriptRevision differs from the episode scriptRevision
  //   failed     = the most recent job for the shot is failed
}
export function sceneStatus(d: Data, sceneId: string): { status: ShotStatus; counts: Record<ShotStatus, number>; flags: ShotFlag[] }
// sceneStatus.status = the "lowest" status among its shots (draft < still < video < locked); flags = the union
export function episodeProgress(d: Data, episodeId: string): { counts: Record<ShotStatus, number>; total: number; attention: number }
```

- `StatusChip` labels and colors: **Draft** (neutral, `--muted`), **Still** (`--blue`), **Video** (`--amber`), **Locked** (`--green`, lock icon). Flags show as small badges: "New take", "Needs update" (amber), "Failed" (danger), "Generating" (spinner).
- **Replace every other status label in the UI** with this model. That includes `sceneWorkflowLabel`, `stage()`, "Ready to edit", "Choose references", "Review plan", "Plan approved" and "Draft plan · your approval needed". You may keep those functions for domain use, but no UI may render their strings.
- The top bar shows episode progress as a compact segmented bar (draft/still/video/locked) with a tooltip ("8 of 12 shots locked · 2 need attention").
- Add unit tests for `shotStatus` covering every combination.

### 7.5 Inspector: shot sections (`appliesTo: ["shot"]`)

Order and detail level:

| order | id | Title | Detail | Multi | Content |
|---|---|---|---|---|---|
| 10 | `shot.preview` | (no title) | simple | no | Large preview of the current or candidate take. A **take strip** below it: thumbnails of all takes for the shot (newest first), with Approved, Candidate and Previous-inputs markers. Clicking a take previews it. Buttons: **Use this take** (`approveTake`), **Discard** (clears the candidate, like today's "Reject candidate"), and **Compare** (side-by-side current vs. candidate, reusing the current comparison markup). |
| 20 | `shot.prompt` | Prompt | simple | yes | Textarea bound to `shot.action`, plus dialogue (`shot.dialogue`). Supports `@` mentions (see §7.8). On multi-select, show "Mixed" placeholders, and edits apply to all. Commit on blur via the same mutation the current shot-breakdown textarea uses (bump `revision`, set `stale` if takes exist, bump `planRevision`). Factor that into a domain function `updateShotText(d, id, patch)` in `domain/workflow.ts`. |
| 30 | `shot.cast` | In this shot | simple | yes | Chips for the effective cast (inherited from the scene, shown muted with "from scene") and the location. Add or remove per shot, which writes `castOverride` / `generationOverride.locationId`. A look selector per character. "Reset to scene" clears the overrides. |
| 40 | `shot.camera` | Camera | simple | yes | Framing (`shot.framing`: Wide, Medium, Close-up, Extreme close-up, Over-the-shoulder, POV, Insert, Two-shot), movement (Static, Pan, Tilt, Push in, Pull out, Tracking, Handheld, Crane), and duration in seconds (`targetFrames`/30, 1–30s, via `updateShotPlan`). Framing and movement are stored in `shot.framing` as `"Close-up · Push in"` for now. Leave a TODO to split them into separate fields later. |
| 50 | `shot.frames` | Start and end frames | advanced | no | Reuse `FrameControls` and `ImageWorkspace`. |
| 60 | `shot.references` | References | advanced | no | Per-shot extra references with purpose. Reuse the reference list part of `GenerationDialog`. |
| 70 | `shot.continuity` | Continuity | advanced | no | `dependsOn` selector ("Continues from…"). |
| 80 | `shot.generation` | Generation | advanced | yes | Model (demo), aspect ratio, video mode (direct or image-first). Cost preview. |
| 90 | `shot.history` | Inputs used | advanced | no | Read-only view of the selected take's input snapshot (prompt, cast versions, location, references). |

**Inspector footer (sticky, simple mode too):** the primary button depends on state:
- draft → **Generate still · 8 cr** (secondary: Animate directly · 24 cr)
- still → **Animate · 24 cr** (secondary: Redo still · 8 cr)
- video → **Lock shot** (secondary: Redo · 24 cr)
- locked → **Unlock** (secondary: Redo · 24 cr)

Any blocking preflight issue (from `scenePreflight`) shows **above** the button as an inline message with a fix action (for example "Maya has no approved identity · Open in World"). Don't disable the button silently.

### 7.6 Inspector: scene and episode sections

**Scene** (`appliesTo: ["scene"]`):
- `scene.summary` (simple): title, description (`description`), dialogue, setting description. These replace the Plan step fields. Commit via `updateScenePlan`.
- `scene.cast` (simple): scene cast and location. This replaces the "Who's in the scene?" and "Where does it happen?" sections of `GenerationDialog`. It writes through `saveGenerationCast` / `saveGenerationInputs` / `setLocation`. It shows the suggestions currently computed in `SceneWorkspace` ("Suggested from your plan: Add Maya · Use Apartment").
- `scene.timing` (simple): target duration (`updateScenePlan(d, id, {}, seconds)`) and the shot duration total.
- `scene.direction` (advanced): time, lighting, mood, style, camera and notes (`updateDirection`).
- `scene.references` (advanced): scene-level other references (from `GenerationDialog`).
- `scene.history` (advanced): approved plan versions (the existing `planHistory` list).
- Footer: **Generate scene · N cr** (§7.9) and "…" (split, merge, delete).

**Episode** (nothing selected):
- `episode.summary`: title, synopsis, target duration, aspect ratio.
- `episode.style` (simple): a project/episode **look**: style preset chips (Cinematic, Noir, Anime, Watercolor, Documentary, Custom), plus a free-text style line. Store it in a new optional `Episode.style?: { preset?: string; notes?: string; aspectRatio?: "9:16" | "16:9" | "1:1" }`. Add it to the Zod schema as optional. Feed it into generation inputs as the default `direction.style` (in `generationInputs`/`ensureSetup`, only when the scene's direction style is empty).
- `episode.progress`: counts by status, with a list of "Needs attention" items that link to their shots.
- `episode.approvals` (advanced): the "Require approvals before generating" toggle (§7.9). Show the script and plan approval state only when the toggle is on.
- Footer: **Generate · N cr**.

**Multi-selection** of shots: show `shot.prompt` (batch), `shot.cast`, `shot.camera`, `shot.generation`, plus a footer with "Generate stills (5) · 40 cr", "Animate (5) · 120 cr" and "Lock (5)".

### 7.7 Script view

- Split layout inside the center area: **screenplay editor** on the left (about 60%) and a **scene/shot mini-board** on the right (about 40%) that stays in sync.
- The editor is a monospace textarea at first (keep the `updateScript` on-blur commit). Add:
  - Screenplay-aware helpers: auto-uppercase lines that start with `INT.`/`EXT.`; Tab cycles between Action, Character and Dialogue line formats (simple string transforms on the current line).
  - A scene gutter: next to each `INT./EXT.` heading, show the matching scene number and status dot. Clicking it selects that scene on the right and in the outline.
- Toolbar: **Write with Director** (opens the Director tab with the draft prompt; replaces "Draft new version"), **Update shots from script** (`approveScript` + `planScenes(d, id, ep.sceneIds.length)`, using the same confirm copy as today's "Refresh scene plans"; only shown when the plans are out of date), version menu (script history from `scriptHistory`), and word count / estimated duration.
- When the script changes after shots exist, show a slim inline bar: "Script changed · 3 scenes affected · Update shots". Don't block work.
- Empty script: an `EmptyState` with "Generate a draft from the synopsis" (calls the existing `draftScript` flow), "Paste or import a script", and "Start writing".

### 7.8 `@mentions` and elements

- In shot prompt and scene description fields, typing `@` opens a popover listing the project's characters, locations and props (filter by typing). Choosing one inserts `@Name` and **adds that element to the shot's cast/location** (or to the scene's, for scene fields).
- Render mentions as colored tokens in read-only displays (card tooltips, the history section). The editable textarea can stay plain text with `@Name` (no rich editor needed).
- A plain-text name match (as `SceneWorkspace` does today) produces **suggestions** in the inspector, never automatic attachments.

### 7.9 Generation flow and approvals (behavior change)

**New project setting:** `Project.settings?: { requireApprovals?: boolean; defaultAspectRatio?: …; defaultModel?: "demo" }`. It's optional in the schema. **Default: `requireApprovals` = false.**

Create a domain helper `ensureReadyForGeneration(d, shotIds)` in `domain/video-workflow.ts`:
- If `requireApprovals` is **false**: for each affected scene, call `approveScript` if the script isn't approved, and `approveScenePlan` if the plan isn't approved. This is the same thing `prepareVideoGeneration` already does for the direct path. Then return.
- If `requireApprovals` is **true**: do nothing. Existing `scenePreflight` blockers will surface "Approve the plan" issues, which the UI shows with an **Approve** fix action.

**Unified generate actions:**

| Level | Button (one primary per level) | What it does |
|---|---|---|
| Episode (top bar) | **Generate · N cr** with a split-button menu: "Stills for all draft shots", "Animate all stills", "Generate everything" | Opens a compact **Generate sheet** (§7.10) pre-filled with the selected scope. |
| Scene (header and inspector) | **Generate scene · N cr** | The same sheet, scoped to that scene. |
| Shot(s) (inspector footer, shortcuts) | **Generate still / Animate / Redo · N cr** | Runs `ensureReadyForGeneration` then `enqueueGeneration` (or an operation-specific enqueue) **directly, with no dialog**, unless the cost is above 100 cr or there are blockers. In those cases it opens the sheet. |

**Forcing the operation:** `enqueueExact(d, ids, op)` filters shots by `nextOperation`. For "Generate stills" on shots whose next operation is video, set `shot.requestedOperation = "image"` (the field already exists on `Shot`) and make sure `preflight()`/`nextOperation()` honors `requestedOperation` when present. Read `domain/selectors.ts` `nextOperation` and `preflight` first and keep the existing behavior when `requestedOperation` is undefined. Add domain tests for both operations.

When a job completes, **do not navigate**. Remove the `dotori-generation-results` navigation listeners. The shot card updates and shows the "New take" badge, and the Activity tray shows a "Done · Show" item.

### 7.10 Generate sheet (replaces the "video" modal and the embedded GenerationDialog as the main flow)

A right-side **sheet** (Radix Dialog styled as a 480px side sheet), not a full-screen modal:

1. **Scope:** chips for the scenes and shots included, with counts. Click to remove. Options: "Only shots that need it" (default on: skips locked shots and shots with candidates) / "Everything".
2. **Operation:** Stills (8 cr each) · Video (24 cr each) · Stills then video.
3. **Readiness:** a compact list from `scenePreflight` for each scene in scope: ✓ ready, ⚠ warnings (collapsed), ✕ blockers, each with a one-click fix or a "Show" link that selects the item and closes the sheet. Blocked scenes are excluded from the count, with the reason shown (today's batch logic in `BatchGenerationReview`).
4. **Footer:** total cost, the credits remaining afterwards, and **Generate · N cr**.

Opening the sheet never charges credits. `GenerationDialog.tsx` is decomposed: its cast, location, reference, frame and shot-plan sections move into inspector sections (§7.5/§7.6), and its preflight and cost logic moves into the sheet. Delete `GenerationDialog.tsx` once nothing imports it. Keep `FrameControls` and `ImageWorkspace`.

### 7.11 Timeline view

- Reuse `Player.tsx` and the editor timeline from `Editor.tsx`, but render **one episode timeline**: all shots in episode order, grouped visually by scene (scene labels above the clip lane, alternating subtle background bands).
- Layout: player on top (about 55% height, resizable), timeline below. Selection syncs with the inspector: selecting a clip selects the shot.
- Clip interactions: trim handles (existing `trimShot`), drag to reorder within a scene (`reorderShots`) or across scenes (`moveShot`), right-click `CommandMenu`, and double-click to open the shot in the inspector.
- Shots without an approved video show as a **placeholder clip** at their target duration, with a still thumbnail if one exists and a hatched pattern otherwise, labeled with the status chip. The timeline is never empty once shots exist.
- Toolbar: play/pause (Space), zoom (−/+), a "Show only locked shots" toggle, and the duration readout.
- Reserve vertical space for future audio lanes (render an empty "Audio" lane, 28px, collapsed, labeled "Audio · coming soon" in muted text). This is the extension point for voice and music (see §18).
- Remove the separate `/scenes/:sid/edit` route (it redirects, see §5.3). Fold `Editor.tsx`'s scene-specific chrome into this view and delete what's unused.

### 7.12 Review view

- A full-bleed player of the whole episode (placeholders included), a filmstrip of shots below, and the shot title and status overlaid.
- Keyboard: Space plays or pauses, ← → moves between shots, `a` accepts the candidate, `x` discards it, `l` locks the shot.
- Right panel (collapsible): per-shot notes. These are stored in a new optional `Shot.notes?: string` for now. This is the future comments extension point.
- "Copy review link" copies the current URL with `?view=review` (demo only, no auth).

---

## 8. New episode flow (Phase 3)

Replace the current "New episode" form (in `Gallery.tsx`/`Actions.tsx`) with a **New episode sheet** that has three starts:

1. **From an idea** (default): one large textarea ("A detective finds a recorder that plays tomorrow's conversations…"), optional chips for duration (15s/30s/60s/90s, default 30s), aspect ratio (9:16/16:9/1:1) and style preset. **Create** runs: create the episode → `draftScript` → `approveScript` → `planScenes(d, id, auto count)` → `approveEpisodePlans` (only when `requireApprovals` is false), then navigates to the episode in **Board view**. No credits are spent. The board shows draft shots, and the top bar's primary action reads **Generate stills · N cr**.
2. **From a script:** paste a screenplay (or upload `.txt`/`.fountain`; read it with `FileReader`, no parsing library), then the same planning steps.
3. **Blank:** creates an empty episode and opens Board view with its empty state.

Title is optional. If empty, derive it from the first 5 words of the idea or the first scene heading. Validation: target 3–90s, as today.

---

## 9. Home (Phase 3)

`src/features/home/HomePage.tsx` replaces `Projects`:

- **Top:** a single "Start a story" input (the same as From an idea). Pressing Enter asks which project to use (defaulting to the most recent, or "New project"), then runs §8 flow 1.
- **Templates row:** Short film, Series episode, Ad, Music video, Trailer. Each pre-fills the idea box with a structure hint and a duration.
- **Recent episodes:** up to 8 episode cards (thumbnail from the first shot with a take, title, project name, progress bar, "edited 2h ago"), sorted by `project.updatedAt`, then episode order. Clicking one opens the episode workspace.
- **Projects:** a compact grid (thumbnail, title, episode count, updated date) with "New project". Use the "…" `CommandMenu` for rename, duplicate and delete.
- Remove the large poster cards, the "From the first idea to the final cut" footer card and the "Demo mode" footer copy. A small "Demo" badge in the rail or account popover is enough.

---

## 10. Project page (Phase 3)

`src/features/project/ProjectPage.tsx` with tabs in the top-bar center: **Episodes · World · Library**.

**Episodes tab:**
- Toolbar: search, status filter, Grid/List toggle and **New episode** (primary).
- Grid: episode cards (thumbnail, `01` number, title, synopsis line, progress bar from `episodeProgress`, duration).
- List: a table with columns #, Title, Shots, Locked, Duration, Updated, and "…" actions. Columns sort, and rows multi-select (bulk duplicate or delete through commands).
- Drag to reorder episodes (writes `project.episodeIds`).
- Selecting an episode (single click) shows an **episode inspector** on the right (synopsis, progress, Open button). Double-click opens it.

---

## 11. World (Phase 4)

`src/features/world/WorldPage.tsx` replaces the Characters routes and Story Bible. Its layout matches the episode workspace (list | detail | inspector).

### 11.1 Left: element list
- A type filter (segmented): **Characters · Places · Props · Notes**.
- Search, then a list or grid of elements with a thumbnail, name and status chip (character readiness from `characterStatus`; places and props are ready when a primary image exists).
- "+ New" for the active type. Suggestions box at the top: "**3 new names found in your scripts:** Detective Ruiz, The Landlord, Corner Café · Add". Detect them from scene descriptions, dialogue and screenplay character cues (uppercase lines in the script) that don't match existing elements.

### 11.2 Center: element detail
**Character:** one **sheet** instead of today's Identity / Looks / References tabs:
- Top: the canonical identity portrait (large) and name. A version stack of identity candidates appears beside it (reuse `MediaVersions`/`Portrait`).
- **Looks row:** horizontal cards for each look (primary image, name, ready state) with "+ Look".
- **Reference angles grid:** front, three-quarter, profile, full body and so on, for the selected look (or the identity). Empty slots show "Generate · 8 cr".
- **Appears in:** a list of shots (thumbnail, `03.2`, episode), with flags when the shot used an older identity or look version ("Look changed"). Action: **Update affected shots** marks them stale and selects them in the episode (use the existing `affectedShots`/`markShotsStale`).
- Remove these sections and their copy: "Identity", "Looks", "References" tab bar, and any eyebrow headings.

**Place (location):** a primary image with a version stack, reference images, description, and "Appears in". Backed by `studio.locations`. Create one through `createLocation`. "Generate place image · 8 cr" uses the existing location job.

**Prop (new element type):** a minimal model. Add `StudioData.props?: Record<ID, { id; projectId; name; description; assetId?; referenceAssetIds: ID[]; revision }>` (optional in the schema). The UI is the same as Place. Props can be `@mentioned` and attached to shots as references with purpose `"continuity"`. Generation of props can be a TODO. Uploading is enough for now.

**Note (story bible):** a markdown-ish textarea per note. Migrate `project.bible` into a note titled "Story bible" on first open (don't delete `project.bible`; keep reading and writing it for the first note so existing tests keep working). Notes are passed to the Director as context.

### 11.3 Right: inspector
Character inspector sections: Profile (name, role, appearance, personality, notes → `updateCharacter`), Voice (placeholder for the future, advanced), Generation (look prompts, advanced), and Danger zone (duplicate, delete with confirm, since deletion is permanent).

### 11.4 Routing inside World
`?tab=world&type=character&id=:cid&look=:lid&section=references`. Selecting an element updates the URL.

---

## 12. Library (Phase 4)

`src/features/library/LibraryPage.tsx` replaces Assets and Exports.

- Toolbar: search, a type filter (All, Images, Videos, Audio, Renders), source (Generated, Uploaded), "Used / Unused", Grid/List toggle and **Upload** (primary, reusing the existing upload logic and its 20 MB cap and session-only notice).
- Grid of media cards (thumbnail, title, kind icon, missing-file warning). Multi-select. Drag onto a shot (if a workspace is open in another tab, this isn't needed; drag works from the Episode outline's Cast and places section instead).
- Inspector for an asset: preview, title (editable), **provenance** (`asset.provenance`, the job and take that produced it, its input snapshot summary), **Used in** (shots, characters and locations that reference it), and actions (Reattach file if missing, Download, Delete).
- **Renders filter:** shows `exports` records (title, preset, date, timeline version, draft flag) with Download manifest (`downloadManifest`). The export *action* is the `episode.export` command, which opens the existing export modal.

---

## 13. Activity tray (Phase 1, shell)

Replaces the Activity button and dialog, the Queue page and the recovery banner placement.

- **Collapsed (28px):** at the left, a status summary ("2 generating · 1 waiting · 1 failed", or "No active jobs"); in the middle, the latest event ("The detail · still ready · Show"); at the right, a credits meter and a chevron to expand.
- **Expanded (resizable, up to 40% of the height):** a table of jobs (thumbnail, target such as "03.2 The detail" or "Maya · identity", operation, state with progress bar, cost, attempt, time) with row actions: Cancel (`cancelJob`), Retry (`retryJob`, confirm with cost as today), and **Show** (navigate to the episode and select the shot, or open World for studio jobs; reuse `studioJobPath`). Filters: Active, Failed, Done, All.
- The **recovered paused jobs** notice ("Unfinished jobs were recovered and paused · Resume") appears as a pinned row in the tray, not a page banner.
- Completed jobs raise a non-blocking toast only when the related shot is not visible on screen.
- Keep the `aria-live` status region for completions and failures.

---

## 14. Settings, account and credits (Phase 4)

- **Account popover** (avatar in the rail): name, email, plan (Starter demo), credits with **Recharge** (existing `RechargeDialog`), Profile settings (route `/profile/settings`, unchanged), Preferences, Sign out.
- **Preferences dialog** (from ⌘K or the popover): theme, density, Simple/Advanced default, and a list of keyboard shortcuts generated from the command registry.
- **Project settings dialog** (from the project "…" menu or `?dialog=project-settings`): title, description, cover, default duration, default aspect ratio, **Require approvals before generating**, and danger zone (reset demo, delete project). This replaces the `Settings` page in `Supporting.tsx`.

---

## 15. Interaction details (apply everywhere)

- **Context menus:** every card, row, clip and outline item supports right-click (and long-press on touch) using `CommandMenu`.
- **Multi-select:** works in the board, outline, timeline, World list, Library grid and Episodes list.
- **Drag and drop:** reorder shots, scenes and episodes. Attach elements and assets to shots.
- **Inline rename:** double-click titles (scene header, shot card title, inspector header, World element name). Enter commits, Esc cancels.
- **Toasts:** bottom-center, above the tray, auto-dismiss after 5s, with an optional **Undo** action that calls `useStore.getState().undo()`. Use them for delete, split, merge, move and lock.
- **Confirmations:** only for (a) spending more than 100 cr at once, (b) permanent deletion of characters, projects or episodes, and (c) "Update shots from script" (because it rewrites plans). Everything else is direct and undoable.
- **Tooltips:** every icon-only button has a tooltip with the command title and shortcut.
- **Loading:** skeleton cards and rows, not spinners in the middle of pages.
- **Reduced motion:** respect `prefers-reduced-motion` (already partly handled. Keep it).

---

## 16. Responsive behavior

- **≥1440px:** all three episode panels are visible.
- **1100–1439px:** the outline is collapsed to a 48px icon strip (scene numbers) by default and expands on hover or toggle.
- **768–1099px:** the outline is a left drawer and the inspector is a right drawer (opened by selecting an item or with `mod+.`).
- **<768px (phone): review-and-light-edit mode.**
  - A bottom tab bar replaces the rail.
  - The Board shows one column of shot cards grouped by scene.
  - Tapping a card opens the inspector as a **bottom sheet** (snap points at 40% and 90%).
  - The Timeline view is replaced by Review on phones.
  - The Script view shows the editor only, with the mini-board hidden behind a toggle.
  - The Generate sheet becomes a full-height bottom sheet.
  - The Activity tray becomes a pill above the tab bar that expands to a sheet.
- Every touch target is at least 40px on touch devices.

---

## 17. Implementation phases and acceptance criteria

Each phase must leave the app working, with typecheck, tests and build passing.

### Phase 1: foundation and shell
Build:
- `stores/workspace.ts`, `commands/*` (registry, keyboard, `CommandMenu`, `CommandPalette`), `inspector/*` (registry and `Inspector` shell)
- `Shell`, `Rail`, `TopBar`, `ActivityTray`, `routes.tsx` with legacy redirects
- density tokens, `StatusChip`, `EmptyState`, `CostLabel`
- `domain/status.ts` with tests

Mount the existing pages inside the new shell temporarily so nothing is lost.

**Accept when:**
- The app has no page-level scroll on any route.
- ⌘K finds commands and entities.
- Shortcuts work outside inputs.
- The Activity tray replaces the queue dialog and page.
- Old URLs redirect.
- `shotStatus` tests pass.

### Phase 2: episode workspace
Build `EpisodeWorkspace` with Outline, Board, the Inspector (shot, scene, episode and multi sections), the Generate sheet, Script view, Timeline view and Review view. Add `ensureReadyForGeneration`, the `requireApprovals` setting, `requestedOperation` handling, `moveShot`, `updateShotText`, and the `splitScene` `atShotId` parameter, all with domain tests. Delete `Episode.tsx`, `SceneWorkspace.tsx`, `EpisodeNavigation.tsx`, `RightPanel.tsx` and `SceneSetup.tsx`, and decompose `GenerationDialog.tsx`.

**Accept when** this journey works with **no page navigation** after opening the episode:
1. Open the demo episode "The Unlocked Door" and see all 4 scenes and 12 shots on one board without scrolling past more than 2 screens at default zoom on a 1440×900 viewport.
2. Select a shot. The inspector shows its preview, takes, prompt, cast and camera.
3. Edit the prompt. The card shows "Needs update" if it had takes.
4. Press `s`. A still job starts, the tray shows it, and the card shows progress. When it completes, the card shows "New take".
5. Press `a` to use the take. The status becomes Still.
6. Press `v` to animate, then `a`, then `l`. The status becomes Locked and the shot plays in Timeline.
7. Cmd-click 3 shots, open Generate stills in the inspector footer, and see the batch cost.
8. Switch to Script, edit the script, and see "Script changed · Update shots". Update, and the IDs, takes and timeline trims are preserved (existing domain guarantees).
9. Undo and redo work for every structural edit.
10. With `requireApprovals` on, generating shows the "Approve plan" blocker with a one-click fix.
11. There are no status strings other than the §7.4 vocabulary anywhere in the episode UI.

### Phase 3: Home, new episode and project page
**Accept when:** Home loads in a fixed layout; typing an idea and pressing Enter creates an episode and lands on a filled Board with **0 credits spent**; the Episodes tab supports grid, list, multi-select and reorder.

### Phase 4: World, Library, settings and account
**Accept when:**
- Characters, places, props and notes are all managed in World.
- "Appears in" lists the correct shots.
- "Update affected shots" marks them stale.
- Library shows provenance and "Used in".
- Renders are listed.
- The Settings page is replaced by the dialogs.
- All of these old routes redirect: `characters`, `bible`, `assets`, `exports`, `queue` and `settings`.

### Phase 5: polish
- Responsive behavior (§16), virtualization for large boards, and skeletons.
- An accessibility pass: keyboard-only journeys for Phase 2 steps 2–7, focus management in sheets, and `aria-selected` on selectable cards and rows.
- Delete dead CSS and components.

---

## 18. Extension points (design for these now; don't build them yet)

| Future feature | Where it plugs in |
|---|---|
| Voice, dialogue TTS, lip-sync, music, SFX | Timeline audio lanes (§7.11), a `shot.voice` inspector section, and a character Voice section (§11.3) |
| Real models per shot | `shot.generation` section plus project default (`Project.settings.defaultModel`) |
| Series (many episodes sharing continuity) | A level above Project or a "Series" project type. World is already project-wide |
| Comments and collaboration | An inspector "Comments" tab (reserved in §6.4), pins on cards, and the Review view right panel |
| Alternate cuts / versions | Saved timeline versions, using `episode.timelineVersion` |
| Agentic Director | The Director executes registered **commands** (§6.3), so anything a user can do, the AI can do and undo |
| Infinite canvas for exploration | A 5th episode view (`?view=canvas`) over the same shot data |

---

## 19. Files: create, modify, delete

**Create:**
```
src/app/Shell.tsx, Rail.tsx, TopBar.tsx, ActivityTray.tsx, routes.tsx, LegacyRedirect.tsx
src/stores/workspace.ts
src/commands/types.ts, registry.ts, keyboard.ts, CommandMenu.tsx, CommandPalette.tsx, definitions/*.ts
src/inspector/registry.ts, Inspector.tsx
src/components/StatusChip.tsx, EmptyState.tsx, CostLabel.tsx, layout/PanelHeader.tsx, Toasts.tsx
src/domain/status.ts
src/features/home/HomePage.tsx, NewEpisodeSheet.tsx
src/features/project/ProjectPage.tsx, EpisodesTab.tsx, ProjectSettingsDialog.tsx
src/features/episode/EpisodeWorkspace.tsx
src/features/episode/outline/Outline.tsx
src/features/episode/board/Board.tsx, SceneSection.tsx, ShotCard.tsx, BoardToolbar.tsx
src/features/episode/script/ScriptView.tsx
src/features/episode/timeline/TimelineView.tsx
src/features/episode/review/ReviewView.tsx
src/features/episode/generate/GenerateSheet.tsx
src/features/episode/inspector-sections/shot/*.tsx, scene/*.tsx, episode/*.tsx
src/features/world/WorldPage.tsx, ElementList.tsx, CharacterSheet.tsx, PlaceDetail.tsx, PropDetail.tsx, NoteDetail.tsx
src/features/library/LibraryPage.tsx
src/features/account/AccountPopover.tsx, PreferencesDialog.tsx
src/test/status.test.ts, commands.test.ts, workspace-flow.test.tsx, redirects.test.tsx
```

**Modify:**
```
src/app/App.tsx                    → providers + Shell only
src/domain/types.ts, schemas.ts    → optional: UI.density/detail/boardZoom/boardGroupBy/inspectorCollapsed,
                                     Project.settings, Episode.style, Shot.notes, StudioData.props
src/domain/workflow.ts             → splitScene(atShotId?), updateShotText
src/domain/commands.ts             → moveShot
src/domain/selectors.ts            → honor shot.requestedOperation in nextOperation/preflight
src/domain/video-workflow.ts       → ensureReadyForGeneration
src/domain/generation-inputs.ts    → fall back to Episode.style for direction.style
src/domain/scene-preflight.ts      → hrefs use new URLs
src/stores/director.ts             → openDirector switches the inspector to the Director tab
src/features/Director.tsx          → render inside the inspector tab; scope from the selection
src/features/Player.tsx, Editor.tsx → reused by TimelineView/ReviewView
src/features/characters/*          → reused by CharacterSheet
src/features/Supporting.tsx        → Queue logic → ActivityTray; Assets → Library; Exports → Library renders; Settings → dialog; Bible → Notes
src/styles/index.css               → density tokens, new component styles, delete dead CSS
src/test/*.test.tsx                → update UI flow tests to the new structure (see §20)
```

**Delete (once unused):**
```
src/features/Episode.tsx, SceneWorkspace.tsx, EpisodeNavigation.tsx, RightPanel.tsx, setup/SceneSetup.tsx
src/features/generation/GenerationDialog.tsx (after decomposition), BatchGenerationReview.tsx (logic moves to GenerateSheet)
src/features/Gallery.tsx Projects/Episodes components (keep SearchBox and NotFound or move them to components/)
```

---

## 20. Testing requirements

- **Domain tests stay green and unchanged:** `domain.test.ts`, `workflow.test.ts`, `studio.test.ts`. If a domain function signature changes (for example `splitScene` gains an optional parameter), existing calls must still pass.
- **Add domain tests:** `shotStatus`/`sceneStatus` combinations, `ensureReadyForGeneration` (both settings), `requestedOperation` image/video forcing, `moveShot` (ownership, staleness, undo), `splitScene(atShotId)`, schema loading of a v3 save **without** the new optional fields.
- **UI flow tests** (`flow.test.tsx`, `workflow-flow.test.tsx`, `studio-flow.test.tsx`, `generation-dialog.test.tsx`, `flexible-generation.test.tsx`, `director-entry.test.tsx`): rewrite them against the new UI so each covers the **same user outcome** (for example "script → scenes → generate → approve → appears in edit" becomes "idea → board → `s` → accept → `v` → accept → lock → timeline shows clip"). Keep the assertions about credits, snapshots and invalidation. Query by role and accessible name, not by CSS class.
- **New tests:** `redirects.test.tsx` (each legacy URL from §5.3), `commands.test.ts` (shortcut mapping is ignored inside inputs; `when` gating), and `workspace-flow.test.tsx` (the Phase 2 acceptance journey).
- `product.test.tsx`, `account.test.tsx` and `pwa.test.tsx` should need few or no changes.

---

## 21. Out of scope / don't do

- Don't connect real AI providers, auth, payments or a backend. All mocks stay.
- Don't change the storage key or version, or delete any persisted field.
- Don't add a rich-text editor, canvas library, virtualization library or state library.
- Don't change the marketing page (`/`) or the login page beyond what's needed to route into the new Home.
- Don't introduce new marketing copy inside the app.
- Don't silently disable buttons. Show the reason (tooltip or inline message) with a fix action.
