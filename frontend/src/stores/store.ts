import { upgradeDemoMedia } from "../mocks/demo-media";
import { migrateProduce } from "../domain/produce";
import { migrateWorkflow } from "../domain/workflow";
import { enhanceStudio } from "../mocks/studio-seed";
import { create } from "zustand";
import { validateRelations } from "../domain/validation";
import { dataSchema, uiSchema } from "../domain/schemas";
import { seed } from "../mocks/seed";
import { active } from "../domain/selectors";
import { type Data, type UI } from "../domain/types";
const KEY = "nori-demo-v1";
let workspaceEpoch = 0;
export const currentWorkspaceEpoch = () => workspaceEpoch;
let workspaceStorageKey: string | undefined = KEY;
const defaultUI: UI = {
  theme: "dark",
  collapsed: false,
  aiOpen: false,
  layouts: {},
  selectedShots: {},
};
export function recover(raw: string | null): {
  data: Data;
  ui: UI;
  resume: boolean;
  notice: string;
} {
  try {
    if (!raw) return { data: seed(), ui: defaultUI, resume: false, notice: "" };
    const saved = JSON.parse(raw);
    if (![1, 2, 3, 4].includes(saved.version)) throw Error();
    if (saved.version === 1) enhanceStudio(saved.data, false);
    if (saved.version < 3) migrateWorkflow(saved.data);
    const d = dataSchema.parse(saved.data);
    if (saved.version < 4) migrateProduce(d);
    upgradeDemoMedia(d);
    validateRelations(d);
    const ui = uiSchema.parse(saved.ui);
    for (const a of Object.values(d.assets))
      if (a.sessionOnly) {
        a.url = "";
        a.missing = true;
      }
    return {
      data: d,
      ui,
      resume: Object.values(d.jobs).some(active),
      notice: "",
    };
  } catch {
    return {
      data: seed(),
      ui: defaultUI,
      resume: false,
      notice:
        "Saved demo data could not be read. A fresh demo has been loaded.",
    };
  }
}
function readSaved(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
const initial = recover(readSaved());
type Editable = Pick<
  Data,
  | "projects"
  | "episodes"
  | "scenes"
  | "shots"
  | "proposals"
  | "characters"
  | "studio"
  | "assets"
>;
const editable = (d: Data): Editable =>
  structuredClone({
    projects: d.projects,
    episodes: d.episodes,
    scenes: d.scenes,
    shots: d.shots,
    proposals: d.proposals,
    characters: d.characters,
    studio: d.studio,
    assets: d.assets,
  });
interface History {
  before: Editable;
  after: Editable;
}
function restoreEdit(data: Data, expected: Editable, desired: Editable): Data {
  const result = structuredClone(data);
  // Apply only properties this edit touched. Later job results and unrelated edits survive.
  for (const group of Object.keys(expected) as (keyof Editable)[]) {
    const current = result[group] as unknown as Record<
      string,
      Record<string, unknown>
    >;
    const old = expected[group] as unknown as Record<
      string,
      Record<string, unknown>
    >;
    const next = desired[group] as unknown as Record<
      string,
      Record<string, unknown>
    >;
    for (const id of new Set([...Object.keys(old), ...Object.keys(next)])) {
      // Approval history is append-only, even when editorial pointers are undone.
      if (group === "studio" && id === "versions") continue;
      if (JSON.stringify(old[id]) === JSON.stringify(next[id])) continue;
      if (!old[id] || !next[id]) {
        if (JSON.stringify(current[id]) === JSON.stringify(old[id])) {
          if (next[id]) current[id] = structuredClone(next[id]);
          else delete current[id];
        }
        continue;
      }
      if (!current[id]) continue;
      for (const key of new Set([
        ...Object.keys(old[id]),
        ...Object.keys(next[id]),
      ])) {
        if (
          (group === "episodes" && key === "scriptHistory") ||
          (group === "scenes" && key === "planHistory")
        )
          continue;
        if (JSON.stringify(old[id][key]) === JSON.stringify(next[id][key]))
          continue;
        if (JSON.stringify(current[id][key]) === JSON.stringify(old[id][key])) {
          if (next[id][key] === undefined) delete current[id][key];
          else current[id][key] = structuredClone(next[id][key]);
        }
      }
    }
  }
  for (const j of Object.values(result.jobs)) {
    if (j.target) continue;
    const shot = result.shots[j.shotId],
      sc = shot ? result.scenes[shot.sceneId] : undefined;
    if (sc) {
      j.sceneId = sc.id;
      j.episodeId = sc.episodeId;
      j.projectId = result.episodes[sc.episodeId].projectId;
    }
  }
  return result;
}
interface Store {
  data: Data;
  ui: UI;
  paused: boolean;
  notice: string;
  noticeId: number;
  storageFailed: boolean;
  past: History[];
  future: History[];
  mutate: (fn: (d: Data) => void, undoable?: boolean) => boolean;
  setUI: (patch: Partial<UI>) => void;
  setNotice: (s: string) => void;
  resume: () => void;
  undo: () => void;
  redo: () => void;
  reset: () => void;
}
export const useStore = create<Store>((set, get) => ({
  data: initial.data,
  ui: { ...initial.ui, aiOpen: false },
  paused: initial.resume,
  notice: initial.notice,
  noticeId: 0,
  storageFailed: false,
  past: [],
  future: [],
  mutate: (fn, undoable = false) => {
    try {
      const prev = get().data;
      const d = structuredClone(prev);
      fn(d);
      for (const p of Object.values(d.projects)) {
        if (
          JSON.stringify(p) !== JSON.stringify(prev.projects[p.id]) ||
          p.episodeIds.some(
            (id) =>
              JSON.stringify(d.episodes[id]) !==
              JSON.stringify(prev.episodes[id]),
          )
        )
          p.updatedAt = Date.now();
      }
      set({
        data: d,
        ...(undoable
          ? {
              past: [
                ...get().past.slice(-29),
                { before: editable(prev), after: editable(d) },
              ],
              future: [],
            }
          : {}),
      });
      return true;
    } catch (e) {
      set({
        notice:
          e instanceof Error
            ? e.message
            : "This action could not be completed.",
      });
      return false;
    }
  },
  setUI: (patch) => set({ ui: { ...get().ui, ...patch } }),
  setNotice: (notice) =>
    set((state) => ({ notice, noticeId: state.noticeId + 1 })),
  resume: () => set({ paused: false }),
  undo: () => {
    const { past, data, future } = get();
    if (!past.length) return;
    const saved = past[past.length - 1];
    set({
      data: restoreEdit(data, saved.after, saved.before),
      past: past.slice(0, -1),
      future: [saved, ...future],
    });
  },
  redo: () => {
    const { past, data, future } = get();
    if (!future.length) return;
    set({
      data: restoreEdit(data, future[0].before, future[0].after),
      past: [...past, future[0]],
      future: future.slice(1),
    });
  },
  reset: () =>
    set({
      data: seed(),
      ui: defaultUI,
      paused: false,
      past: [],
      future: [],
      notice: "Demo restored.",
    }),
}));
let saveFailed = false;
useStore.subscribe((s) => {
  try {
    const data = structuredClone(s.data);
    for (const a of Object.values(data.assets)) if (a.sessionOnly) a.url = "";
    for (const c of Object.values(data.characters))
      if (c.reference.startsWith("blob:")) {
        c.reference = "/media/maya.svg";
        c.approved = false;
      }
    if (workspaceStorageKey)
      localStorage.setItem(
        workspaceStorageKey,
        JSON.stringify({ version: 4, data, ui: s.ui }),
      );
  } catch {
    if (!saveFailed) {
      saveFailed = true;
      queueMicrotask(() => {
        useStore.setState({ storageFailed: true });
        useStore
          .getState()
          .setNotice(
            "Local storage is unavailable or full. Changes are kept in this session only.",
          );
      });
    }
  }
});

/** Replace all in-memory state, including undo history, before mounting another account. */
export function activateWorkspace(ownerId: string | null) {
  workspaceEpoch++;
  for (const asset of Object.values(useStore.getState().data.assets)) {
    if (asset.url.startsWith("blob:")) URL.revokeObjectURL?.(asset.url);
  }
  workspaceStorageKey = ownerId ? `${KEY}:user:${ownerId}` : undefined;
  let raw: string | null = null;
  try {
    if (workspaceStorageKey) raw = localStorage.getItem(workspaceStorageKey);
  } catch {
    /* Use an empty workspace. */
  }
  const restored = recover(raw);
  useStore.setState({
    data: restored.data,
    ui: { ...restored.ui, aiOpen: false },
    paused: restored.resume,
    notice: restored.notice,
    past: [],
    future: [],
    storageFailed: false,
  });
}

export function beginServerWorkspace() {
  workspaceEpoch++;
  workspaceStorageKey = undefined;
  const backend = useStore.getState().data.backend;
  useStore.setState({
    data: {
      projects: {},
      episodes: {},
      scenes: {},
      shots: {},
      takes: {},
      assets: {},
      jobs: {},
      threads: {},
      proposals: {},
      exports: {},
      characters: {},
      credits: 0,
      studio: {
        looks: {},
        references: {},
        versions: {},
        locations: {},
        setups: {},
      },
      backend,
    },
    past: [],
    future: [],
    paused: true,
  });
}
