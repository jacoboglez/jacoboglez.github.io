/**
 * The persistent, browsable collection of saved configs (spec §6.3) --
 * "save it when it looks nice". `localStorage`-backed by default, but
 * built against a minimal `StorageLike` interface so the save/load/export
 * logic can be unit tested without a browser.
 *
 * Requirements this file exists to satisfy:
 *  - One-key save with no dialog (the UI layer wires the keypress; this
 *    module just makes the save itself a single, instant call).
 *  - Thumbnails travel with each entry.
 *  - Export/import the whole library as JSON -- localStorage is not
 *    durable, and this is the one piece of state in the system that
 *    cannot be regenerated.
 *  - Hitting the quota fails loudly. Never silently evict entries.
 */
import type { SketchConfig } from './config.ts';

export interface LibraryEntry {
  id: string;
  config: SketchConfig;
  thumbnail: string; // small PNG data URL, ~200px
}

export interface Library {
  /** Snapshots `config` + `thumbnail` into the library immediately. Returns the new entry's id. */
  save(config: SketchConfig, thumbnail: string): string;
  load(id: string): SketchConfig;
  /** Newest first. */
  list(): LibraryEntry[];
  remove(id: string): void;
  rename(id: string, label: string): void;
  exportAll(): string;
  importAll(json: string, mode: 'merge' | 'replace'): void;
}

/** Thrown when the storage backend rejects a write (e.g. quota exceeded). */
export class LibraryQuotaError extends Error {
  constructor(message = 'Library storage is full. Export your library as a backup, then remove some entries.') {
    super(message);
    this.name = 'LibraryQuotaError';
  }
}

export class LibraryImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LibraryImportError';
  }
}

/** The subset of the `Storage` (localStorage) API this module needs. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const STORAGE_KEY = 'plotter.library.v1';

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export class LocalLibrary implements Library {
  constructor(private readonly storage: StorageLike) {}

  private readAll(): LibraryEntry[] {
    const raw = this.storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as LibraryEntry[]) : [];
    } catch {
      return [];
    }
  }

  private writeAll(entries: LibraryEntry[]): void {
    let serialized: string;
    try {
      serialized = JSON.stringify(entries);
    } catch (err) {
      throw new Error(`Library entries could not be serialised: ${(err as Error).message}`);
    }
    try {
      this.storage.setItem(STORAGE_KEY, serialized);
    } catch {
      // Any storage-side failure here is treated as a quota problem: we
      // never want a save to fail silently or to evict older entries to
      // make room. The caller is expected to surface this to the user.
      throw new LibraryQuotaError();
    }
  }

  save(config: SketchConfig, thumbnail: string): string {
    const id = generateId();
    const entries = this.readAll();
    entries.unshift({ id, config, thumbnail });
    this.writeAll(entries);
    return id;
  }

  load(id: string): SketchConfig {
    const entry = this.readAll().find((e) => e.id === id);
    if (!entry) throw new Error(`No library entry with id "${id}".`);
    return entry.config;
  }

  list(): LibraryEntry[] {
    return this.readAll();
  }

  remove(id: string): void {
    this.writeAll(this.readAll().filter((e) => e.id !== id));
  }

  rename(id: string, label: string): void {
    const entries = this.readAll();
    const entry = entries.find((e) => e.id === id);
    if (!entry) throw new Error(`No library entry with id "${id}".`);
    entry.config = { ...entry.config, meta: { ...entry.config.meta, label } };
    this.writeAll(entries);
  }

  exportAll(): string {
    return JSON.stringify(this.readAll(), null, 2);
  }

  importAll(json: string, mode: 'merge' | 'replace'): void {
    let incoming: LibraryEntry[];
    try {
      const parsed: unknown = JSON.parse(json);
      if (!Array.isArray(parsed)) throw new Error('expected a JSON array');
      incoming = parsed as LibraryEntry[];
    } catch (err) {
      throw new LibraryImportError(`Invalid library file: ${(err as Error).message}`);
    }

    if (mode === 'replace') {
      this.writeAll(incoming);
      return;
    }

    // merge: keep every existing entry; add incoming entries whose id isn't
    // already present. This never clobbers a local entry with an imported
    // one that happens to share an id.
    const existing = this.readAll();
    const existingIds = new Set(existing.map((e) => e.id));
    const merged = existing.concat(incoming.filter((e) => !existingIds.has(e.id)));
    this.writeAll(merged);
  }
}

export function createLibrary(storage?: StorageLike): Library {
  const backend: StorageLike | undefined =
    storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
  if (!backend) {
    throw new Error('No storage backend available: localStorage is undefined in this environment.');
  }
  return new LocalLibrary(backend);
}
