import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { useStudio, useSelection } from "./selection";
export interface StudioCommand {
  id: string;
  label: string;
  shortcut?: string;
  reason?: string;
  fix?: () => void;
  run(): void;
}
interface Registry {
  commands: StudioCommand[];
  register(scope: string, commands: StudioCommand[]): () => void;
  execute(id: string): void;
}
const Context = createContext<Registry>({
  commands: [],
  register: () => () => {},
  execute: () => {},
});
export const useCommands = () => useContext(Context);
export function CommandProvider({ children }: { children: ReactNode }) {
  const [scopes, setScopes] = useState<Record<string, StudioCommand[]>>({});
  const register = useCallback((scope: string, commands: StudioCommand[]) => {
    setScopes((s) => ({ ...s, [scope]: commands }));
    return () =>
      setScopes((s) => {
        const copy = { ...s };
        delete copy[scope];
        return copy;
      });
  }, []);
  const commands = useMemo(() => Object.values(scopes).flat(), [scopes]);
  const currentCommands = useRef(commands);
  currentCommands.current = commands;
  const execute = useCallback((id: string) => {
    const c = currentCommands.current.find((c) => c.id === id);
    if (!c) return;
    if (c.reason) {
      c.fix?.();
      return;
    }
    c.run();
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useStudio.getState().set({ palette: !useStudio.getState().palette });
        return;
      }
      const el = e.target as HTMLElement;
      if (
        el?.closest?.("input,textarea,select,[contenteditable=true]") ||
        el?.closest?.("[role=dialog]")
      )
        return;
      const shortcut = `${e.metaKey || e.ctrlKey ? "Mod+" : ""}${e.shiftKey ? "Shift+" : ""}${e.key.toLowerCase()}`;
      const c = commands.find(
        (c) => c.shortcut?.toLowerCase() === shortcut.toLowerCase(),
      );
      if (c) {
        e.preventDefault();
        execute(c.id);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [commands, execute]);
  return (
    <Context.Provider value={{ commands, register, execute }}>
      {children}
      <CommandPalette />
    </Context.Provider>
  );
}
export function useRegisterCommands(scope: string, commands: StudioCommand[]) {
  const { register } = useCommands();
  useEffect(() => register(scope, commands), [register, scope, commands]);
}
export function CommandButton({
  id,
  children,
  className = "",
  icon = false,
  current = false,
}: {
  id: string;
  children?: ReactNode;
  className?: string;
  icon?: boolean;
  current?: boolean;
}) {
  const { commands, execute } = useCommands();
  const c = commands.find((c) => c.id === id);
  if (!c) return null;
  return (
    <span className="st-command-wrap">
      <button
        className={`st-button ${icon ? "st-icon" : ""} ${className}`}
        aria-label={c.label}
        aria-current={current ? "page" : undefined}
        title={`${c.label}${c.shortcut ? ` (${c.shortcut.replace("Mod", "⌘")})` : ""}${c.reason ? ` — ${c.reason}` : ""}`}
        onClick={() => execute(id)}
      >
        {children ?? c.label}
      </button>
      {c.reason && !icon && (
        <small>
          {c.reason}
          {c.fix && (
            <button className="st-text-button" onClick={c.fix}>
              Fix
            </button>
          )}
        </small>
      )}
    </span>
  );
}
function CommandPalette() {
  const { commands, execute } = useCommands(),
    open = useStudio((s) => s.palette);
  const [query, setQuery] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(palette) => useStudio.getState().set({ palette })}
    >
      <DialogContent className="st-dialog">
        <DialogTitle>Commands</DialogTitle>
        <DialogDescription>Search actions and destinations.</DialogDescription>
        <input
          autoFocus
          aria-label="Search commands"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type a command…"
        />
        <div className="st-command-list">
          {commands
            .filter((c) => c.label.toLowerCase().includes(query.toLowerCase()))
            .map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  useStudio.getState().set({ palette: false });
                  execute(c.id);
                }}
              >
                <span>
                  {c.label}
                  {c.reason && <small>{c.reason}</small>}
                </span>
                <kbd>{c.shortcut?.replace("Mod", "⌘")}</kbd>
              </button>
            ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
export function CommandMenu({
  ids,
  children,
  onSelect,
  className = "",
}: {
  ids: string[];
  children: ReactNode;
  onSelect?: () => void;
  className?: string;
}) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null,
  );
  const { commands, execute } = useCommands();
  const selected = useSelection((s) => s.keys);
  const menuIds = selected.length
    ? [...new Set([...ids, "selection.delete"])]
    : ids;
  return (
    <div
      className={`st-context-target ${className}`}
      onKeyDown={(e) => {
        if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
          e.preventDefault();
          e.stopPropagation();
          onSelect?.();
          if (!ids.length && !useSelection.getState().keys.length) return;
          const r = (e.target as HTMLElement).getBoundingClientRect();
          setPosition({ x: r.left + 20, y: r.top + 20 });
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onSelect?.();
        if (!ids.length && !useSelection.getState().keys.length) return;
        setPosition({ x: e.clientX, y: e.clientY });
      }}
    >
      {children}
      <DropdownMenu
        open={!!position}
        onOpenChange={(v) => {
          if (!v) setPosition(null);
        }}
      >
        <DropdownMenuTrigger
          aria-label="Selection actions"
          className="st-context-anchor"
          tabIndex={-1}
          aria-hidden="true"
          style={{ left: position?.x, top: position?.y }}
        />
        <DropdownMenuContent>
          {menuIds.map((id) => {
            const c = commands.find((c) => c.id === id);
            return (
              c && (
                <DropdownMenuItem
                  key={id}
                  className={`dropdown-item ${id === "selection.delete" ? "st-menu-delete" : ""}`}
                  onSelect={() => execute(id)}
                >
                  {c.label}
                  {c.shortcut && (
                    <small>{c.shortcut.replace("Mod", "⌘")}</small>
                  )}
                  {c.reason && <small> — {c.reason}</small>}
                </DropdownMenuItem>
              )
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
