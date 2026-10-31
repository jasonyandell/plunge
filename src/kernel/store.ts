/** Per-device storage for one mod, namespaced by its id. Never throws: private
 * browsing and full or blocked storage read as empty and drop writes. */
export interface ModStore {
  get<T>(key: string): T | null;
  /** False when the device would not save it. */
  set(key: string, value: unknown): boolean;
  remove(key: string): void;
}

export const MOD_STORAGE_PREFIX = 'plunge:mod:';

export function store(modId: string): ModStore {
  const full = (key: string) => `${MOD_STORAGE_PREFIX}${modId}:${key}`;
  return {
    get<T>(key: string) {
      try { const raw = localStorage.getItem(full(key)); return raw === null ? null : JSON.parse(raw) as T; } catch { return null; }
    },
    set(key, value) {
      try { localStorage.setItem(full(key), JSON.stringify(value)); return true; } catch { return false; }
    },
    remove(key) {
      try { localStorage.removeItem(full(key)); } catch { /* Nothing to forget. */ }
    },
  };
}
