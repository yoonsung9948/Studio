import { create } from "zustand";
import {
  getProduction,
  saveProduction,
  archiveProduction,
  type ProductionDocument,
} from "../api/production";
import { getAsset, getAssetFileURL } from "../api/assets";
import { useStore } from "../stores/store";
import { applyProduction, productionDocument } from "./production-document";
export const useProductionSave = create<{ pending: boolean; error?: string }>(
  () => ({ pending: false }),
);
interface Loaded {
  revision: number;
  saved: string;
  running?: Promise<void>;
}
let current: ProductionSync | undefined;
export const productionSync = () => current;
export class ProductionSync {
  private loaded = new Map<string, Loaded>();
  private stopped = false;
  private loads = new Map<string, number>();
  private refreshPending = new Set<string>();
  private applying = false;
  private timer?: ReturnType<typeof setTimeout>;
  private controller = new AbortController();
  private unsubscribe: () => void;
  constructor() {
    current = this;
    this.unsubscribe = useStore.subscribe(() => {
      if (this.applying || this.stopped) return;
      clearTimeout(this.timer);
      if (
        [...this.loaded].some(([id, v]) => this.snapshot(id, v) !== v.saved)
      ) {
        useProductionSave.setState({ pending: true });
        this.timer = setTimeout(() => void this.flush().catch(() => {}), 450);
      }
    });
  }
  private snapshot(id: string, v: Loaded) {
    return JSON.stringify(
      productionDocument(useStore.getState().data, id, v.revision),
    );
  }
  private set(document: ProductionDocument) {
    this.applying = true;
    useStore.getState().mutate((data) => applyProduction(data, document));
    this.applying = false;
  }
  async load(id: string, force = false, discard = false) {
    if (this.loaded.has(id) && !force) return true;
    const sequence = (this.loads.get(id) ?? 0) + 1;
    this.loads.set(id, sequence);
    const document = await getProduction(id, this.controller.signal);
    if (this.stopped || this.loads.get(id) !== sequence) return false;
    const old = this.loaded.get(id);
    if (
      old &&
      !discard &&
      (this.snapshot(id, old) !== old.saved || document.revision < old.revision)
    ) {
      this.refreshPending.add(id);
      return false;
    }
    this.set(document);
    const value = { revision: document.revision, saved: "" };
    this.loaded.set(id, value);
    value.saved = this.snapshot(id, value);
    await this.media(id);
    return true;
  }
  async media(id: string) {
    const assets = Object.values(useStore.getState().data.assets).filter(
      (a) => a.projectId === id && a.serverAssetId,
    );
    for (let i = 0; i < assets.length; i += 8)
      await Promise.all(
        assets.slice(i, i + 8).map(async (asset) => {
          try {
            const detail = await getAsset(
              asset.serverAssetId!,
              this.controller.signal,
            );
            const file = detail.files.find((f) => f.role === "original");
            if (!file) return;
            const link = await getAssetFileURL(file.id, this.controller.signal);
            if (this.stopped) return;
            this.applying = true;
            useStore.getState().mutate((data) => {
              if (data.assets[asset.id])
                Object.assign(data.assets[asset.id], {
                  url: link.url,
                  missing: false,
                });
              for (const character of Object.values(data.characters)) {
                const version =
                  data.studio.versions[character.canonicalVersionId ?? ""];
                if (version?.assetId === asset.id)
                  character.reference = link.url;
              }
            });
            this.applying = false;
          } catch {
            /* Missing media remains visible as unavailable. */
          }
        }),
      );
  }
  async flush() {
    for (const [id, value] of this.loaded) {
      if (value.running) await value.running;
      const raw = this.snapshot(id, value);
      if (raw === value.saved) continue;
      value.running = (async () => {
        try {
          const document = JSON.parse(raw) as ProductionDocument;
          if (document.project.archived) {
            await archiveProduction(id);
            this.loaded.delete(id);
            window.dispatchEvent(new Event("production-saved"));
            return;
          }
          const result = await saveProduction(
            id,
            document,
            this.controller.signal,
          );
          if (this.stopped) return;
          value.revision = result.revision;
          const submitted = JSON.parse(raw) as ProductionDocument;
          submitted.revision = result.revision;
          value.saved = JSON.stringify(submitted);
          window.dispatchEvent(new Event("production-saved"));
          useProductionSave.setState({ error: undefined });
        } catch (error) {
          if (!this.stopped)
            useProductionSave.setState({
              error: error instanceof Error ? error.message : "Saving failed",
            });
          throw error;
        } finally {
          value.running = undefined;
        }
      })();
      await value.running;
    }
    if (!this.stopped) {
      const pending = [...this.loaded].some(
        ([id, v]) => this.snapshot(id, v) !== v.saved,
      );
      useProductionSave.setState({ pending });
      if (!pending) {
        const refresh = [...this.refreshPending];
        this.refreshPending.clear();
        for (const id of refresh) await this.load(id, true);
      }
    }
  }

  async ready() {
    await this.flush();
    if (useProductionSave.getState().pending) await this.ready();
  }
  async reload(id: string, discard = false) {
    const refreshed = await this.load(id, true, discard);
    if (refreshed)
      useProductionSave.setState({ pending: false, error: undefined });
  }
  async archive(id: string) {
    await this.flush();
    await archiveProduction(id);
    if (this.stopped) return;
    this.loaded.delete(id);
    window.dispatchEvent(new Event("production-saved"));
    useStore.getState().mutate((data) => {
      if (data.projects[id]) data.projects[id].archived = true;
    });
  }
  stop() {
    this.stopped = true;
    this.controller.abort();
    clearTimeout(this.timer);
    this.unsubscribe();
    if (current === this) current = undefined;
    useProductionSave.setState({ pending: false, error: undefined });
  }
}
