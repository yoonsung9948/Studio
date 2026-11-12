import { create } from "zustand";
export type EntityType =
  | "project"
  | "episode"
  | "scene"
  | "shot"
  | "look"
  | "character"
  | "place"
  | "prop"
  | "note"
  | "asset";
export type EntityKey = `${EntityType}:${string}`;
export const entity = (key?: string) => {
  const i = key?.indexOf(":") ?? -1;
  return {
    type: i < 0 ? "episode" : (key!.slice(0, i) as EntityType),
    id: i < 0 ? "" : key!.slice(i + 1),
  };
};
interface Selection {
  keys: EntityKey[];
  anchor?: EntityKey;
  choose(
    key: EntityKey,
    ordered?: EntityKey[],
    modifiers?: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean },
  ): void;
  replace(keys: EntityKey[]): void;
}
export const useSelection = create<Selection>((set, get) => ({
  keys: [],
  choose(key, ordered = [], modifiers = {}) {
    const { keys, anchor } = get();
    if (
      modifiers.shiftKey &&
      anchor &&
      ordered.includes(anchor) &&
      ordered.includes(key)
    ) {
      const [a, b] = [ordered.indexOf(anchor), ordered.indexOf(key)].sort(
        (a, b) => a - b,
      );
      set({ keys: ordered.slice(a, b + 1) });
    } else if (modifiers.metaKey || modifiers.ctrlKey) {
      set({
        keys: keys.includes(key)
          ? keys.filter((k) => k !== key)
          : [...keys, key],
        anchor: key,
      });
    } else set({ keys: [key], anchor: key });
  },
  replace(keys) {
    set({ keys, anchor: keys[0] });
  },
}));
export type WorkspaceView = "board" | "script" | "timeline" | "review";
export const useStudio = create<{
  navigation: boolean;
  outline: boolean;
  account: boolean;
  activity: boolean;
  palette: boolean;
  settings: boolean;
  inspector: boolean;
  inspectorTab: "properties" | "director";
  view: WorkspaceView;
  set(
    fields: Partial<{
      navigation: boolean;
      outline: boolean;
      account: boolean;
      activity: boolean;
      palette: boolean;
      settings: boolean;
      inspector: boolean;
      inspectorTab: "properties" | "director";
      view: WorkspaceView;
    }>,
  ): void;
}>((set) => ({
  navigation: false,
  outline: true,
  account: false,
  activity: false,
  palette: false,
  settings: false,
  inspector: true,
  inspectorTab: "properties",
  view: "board",
  set: (fields) => set(fields),
}));
