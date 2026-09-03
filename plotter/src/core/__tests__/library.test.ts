import { describe, expect, it, beforeEach } from 'vitest';
import { createLibrary, LibraryQuotaError, LibraryImportError, type StorageLike } from '../library.ts';
import { createConfig } from '../config.ts';
import { PAGES } from '../page.ts';
import type { PageSpec } from '../types.ts';

const page: PageSpec = { width: PAGES.a4_landscape.width, height: PAGES.a4_landscape.height, margin: 15 };

function makeConfig(seed: number, label?: string) {
  return createConfig({
    generator: 'flowField',
    seed,
    page,
    pen: { widthMm: 0.3, color: '#000' },
    params: { nLines: 400 },
    label,
  });
}

/** A minimal in-memory Storage, with an optional byte quota to simulate localStorage filling up. */
class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  constructor(private quotaBytes = Infinity) {}
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    const size = [...this.map.entries()].reduce((s, [k, v]) => (k === key ? s : s + v.length), 0) + value.length;
    if (size > this.quotaBytes) {
      const err = new Error('QuotaExceededError');
      err.name = 'QuotaExceededError';
      throw err;
    }
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

describe('LocalLibrary', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it('saves and loads a config by id', () => {
    const lib = createLibrary(storage);
    const config = makeConfig(42, 'nice one');
    const id = lib.save(config, 'data:image/png;base64,thumb');
    expect(lib.load(id)).toEqual(config);
  });

  it('lists entries newest first', () => {
    const lib = createLibrary(storage);
    const id1 = lib.save(makeConfig(1), 'thumb1');
    const id2 = lib.save(makeConfig(2), 'thumb2');
    const list = lib.list();
    expect(list.map((e) => e.id)).toEqual([id2, id1]);
  });

  it('removes an entry', () => {
    const lib = createLibrary(storage);
    const id = lib.save(makeConfig(1), 'thumb');
    lib.remove(id);
    expect(lib.list()).toHaveLength(0);
    expect(() => lib.load(id)).toThrow();
  });

  it('renames an entry by updating its label, leaving other fields intact', () => {
    const lib = createLibrary(storage);
    const config = makeConfig(1, 'old label');
    const id = lib.save(config, 'thumb');
    lib.rename(id, 'new label');
    const loaded = lib.load(id);
    expect(loaded.meta.label).toBe('new label');
    expect(loaded.seed).toBe(config.seed);
  });

  it('exports the whole library as JSON and re-imports into an empty library intact', () => {
    const lib = createLibrary(storage);
    lib.save(makeConfig(1), 'thumb1');
    lib.save(makeConfig(2), 'thumb2');
    const exported = lib.exportAll();

    const otherStorage = new MemoryStorage();
    const otherLib = createLibrary(otherStorage);
    otherLib.importAll(exported, 'replace');

    expect(otherLib.list()).toEqual(lib.list());
  });

  it('merge import adds only entries not already present, never clobbering local ones', () => {
    const lib = createLibrary(storage);
    const idA = lib.save(makeConfig(1, 'local'), 'thumbA');

    const other = new MemoryStorage();
    const otherLib = createLibrary(other);
    otherLib.save(makeConfig(2, 'from backup'), 'thumbB');
    const backupJson = otherLib.exportAll();

    lib.importAll(backupJson, 'merge');
    const list = lib.list();
    expect(list).toHaveLength(2);
    // the original local entry must be untouched
    expect(list.find((e) => e.id === idA)!.config.meta.label).toBe('local');
  });

  it('rejects invalid JSON on import with a clear error, not a silent no-op', () => {
    const lib = createLibrary(storage);
    expect(() => lib.importAll('not json', 'replace')).toThrow(LibraryImportError);
    expect(() => lib.importAll('{"not":"an array"}', 'replace')).toThrow(LibraryImportError);
  });

  it('fails loudly on quota exhaustion instead of silently dropping data', () => {
    const tinyStorage = new MemoryStorage(50); // bytes
    const lib = createLibrary(tinyStorage);
    expect(() => lib.save(makeConfig(1), 'x'.repeat(200))).toThrow(LibraryQuotaError);
    // and the library must still be empty -- no partial/corrupt write
    expect(lib.list()).toHaveLength(0);
  });
});
