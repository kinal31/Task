import { describe, it, expect } from 'vitest';
import { FileExplorerSDK } from '../../src/sdk/FileExplorerSDK.js';
import { ErrorCodes, FileExplorerError } from '../../src/sdk/errors.js';
import { createSampleData } from '../../src/sdk/sample-data.js';
import { assertInvariants } from './helpers/assertInvariants.js';

function makeIdGenerator() {
  let n = 0;
  return () => `id-${++n}`;
}

function makeSdk() {
  return new FileExplorerSDK({
    initialData: createSampleData(),
    idGenerator: makeIdGenerator(),
  });
}

function expectSdkError(fn, code) {
  try {
    fn();
    expect.unreachable(`expected error ${code}`);
  } catch (e) {
    expect(e).toBeInstanceOf(FileExplorerError);
    expect(e.code).toBe(code);
    return e;
  }
}

/** Structural dump used to prove search mutates nothing. */
function dumpTree(sdk) {
  const walk = (id) => {
    const item = sdk.getItem(id);
    return {
      name: item.name,
      type: item.type,
      children: item.childIds.map(walk),
    };
  };
  return walk(sdk.getRootId());
}

describe('search: matching', () => {
  it('finds nested items with a case-insensitive substring match', () => {
    const sdk = makeSdk();
    const result = sdk.search('doc');

    // 'doc' matches Documents (folder) and Report.docx (nested file).
    expect(result.total).toBe(2);
    const report = result.items.find((i) => i.name === 'Report.docx');
    expect(report).toMatchObject({
      type: 'file',
      path: 'My Files / Documents / Work / Report.docx',
      location: 'My Files / Documents / Work',
    });
  });

  it('matches regardless of query case', () => {
    const sdk = makeSdk();
    expect(sdk.search('RESUME').total).toBe(1);
    expect(sdk.search('resume').items[0].name).toBe('Resume.pdf');
  });

  it('finds multiple matches and excludes the root', () => {
    const sdk = makeSdk();
    const result = sdk.search('o');
    const names = result.items.map((i) => i.name);

    expect(names).toContain('Documents');
    expect(names).toContain('Work');
    expect(names).toContain('Report.docx');
    expect(names).toContain('Notes.txt');
    expect(names).toContain('vacation.jpg');
    expect(names).toContain('profile.png');
    expect(names).toContain('song.mp3');
    expect(names).not.toContain('My Files'); // root excluded
    expect(result.total).toBe(7);
  });

  it('location is the parent path text', () => {
    const sdk = makeSdk();
    const result = sdk.search('vacation');
    expect(result.items[0].location).toBe('My Files / Pictures');
    expect(result.items[0].path).toBe('My Files / Pictures / vacation.jpg');
  });
});

describe('search: type filter', () => {
  it('filters files only', () => {
    const sdk = makeSdk();
    const result = sdk.search('o', { type: 'file' });
    const types = new Set(result.items.map((i) => i.type));

    expect(result.total).toBe(5); // Report.docx, Notes.txt, vacation.jpg, profile.png, song.mp3
    expect(types).toEqual(new Set(['file']));
  });

  it('filters folders only', () => {
    const sdk = makeSdk();
    const result = sdk.search('o', { type: 'folder' });
    const names = result.items.map((i) => i.name);

    expect(names.sort()).toEqual(['Documents', 'Work']);
  });

  it("'all' (the default) includes both types", () => {
    const sdk = makeSdk();
    expect(sdk.search('o', { type: 'all' }).total).toBe(7);
    expect(sdk.search('o').total).toBe(7);
  });
});

describe('search: sorting and order', () => {
  it('sorts by name ascending', () => {
    const sdk = makeSdk();
    const names = sdk.search('e', { sortBy: 'name', order: 'asc', pageSize: 100 })
      .items.map((i) => i.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  it('descending is the exact reverse of ascending (deterministic)', () => {
    const sdk = makeSdk();
    const asc = sdk.search('e', { sortBy: 'name', order: 'asc', pageSize: 100 }).items;
    const desc = sdk.search('e', { sortBy: 'name', order: 'desc', pageSize: 100 }).items;
    expect(desc.map((i) => i.id)).toEqual([...asc].reverse().map((i) => i.id));
  });

  it('sorts by type: files before folders in ascending order', () => {
    const sdk = makeSdk();
    const types = sdk.search('o', { sortBy: 'type', order: 'asc', pageSize: 100 })
      .items.map((i) => i.type);
    // 'file' < 'folder' lexicographically
    expect(types).toEqual([...types].sort((a, b) => a.localeCompare(b)));
    expect(types[0]).toBe('file');
    expect(types.at(-1)).toBe('folder');
  });

  it('sorts by path', () => {
    const sdk = makeSdk();
    const paths = sdk.search('e', { sortBy: 'path', order: 'asc', pageSize: 100 })
      .items.map((i) => i.path);
    const sorted = [...paths].sort((a, b) => a.localeCompare(b));
    expect(paths).toEqual(sorted);
  });
});

describe('search: pagination', () => {
  it('returns the first page with correct totals', () => {
    const sdk = makeSdk();
    const result = sdk.search('e', { page: 1, pageSize: 3 });

    expect(result.items).toHaveLength(3);
    expect(result.total).toBe(7);
    expect(result.totalPages).toBe(3);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(3);
  });

  it('returns the last (partial) page', () => {
    const sdk = makeSdk();
    const result = sdk.search('e', { page: 3, pageSize: 3 });

    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(7);
  });

  it('a page beyond totalPages returns empty items with correct totals', () => {
    const sdk = makeSdk();
    const result = sdk.search('e', { page: 4, pageSize: 3 });

    expect(result.items).toEqual([]);
    expect(result.total).toBe(7);
    expect(result.totalPages).toBe(3);
    expect(result.page).toBe(4);
  });

  it('pages are disjoint and cover all matches', () => {
    const sdk = makeSdk();
    const page1 = sdk.search('e', { page: 1, pageSize: 3 }).items;
    const page2 = sdk.search('e', { page: 2, pageSize: 3 }).items;
    const page3 = sdk.search('e', { page: 3, pageSize: 3 }).items;
    const all = [...page1, ...page2, ...page3];

    expect(new Set(all.map((i) => i.id)).size).toBe(7);
  });
});

describe('search: validation and empty query', () => {
  it('an empty or whitespace query returns an empty result (documented choice)', () => {
    const sdk = makeSdk();
    for (const query of ['', '   ']) {
      const result = sdk.search(query);
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.totalPages).toBe(0);
      expect(result.query).toBe('');
    }
  });

  it('a non-string query throws INVALID_QUERY', () => {
    const sdk = makeSdk();
    expectSdkError(() => sdk.search(42), ErrorCodes.INVALID_QUERY);
    expectSdkError(() => sdk.search(null), ErrorCodes.INVALID_QUERY);
    expectSdkError(() => sdk.search(undefined), ErrorCodes.INVALID_QUERY);
    expectSdkError(() => sdk.search({}), ErrorCodes.INVALID_QUERY);
  });

  it('invalid options throw INVALID_OPTIONS', () => {
    const sdk = makeSdk();
    expectSdkError(() => sdk.search('x', { type: 'folderz' }), ErrorCodes.INVALID_OPTIONS);
    expectSdkError(() => sdk.search('x', { sortBy: 'nam' }), ErrorCodes.INVALID_OPTIONS);
    expectSdkError(() => sdk.search('x', { order: 'up' }), ErrorCodes.INVALID_OPTIONS);
    expectSdkError(() => sdk.search('x', { page: 0 }), ErrorCodes.INVALID_OPTIONS);
    expectSdkError(() => sdk.search('x', { page: 1.5 }), ErrorCodes.INVALID_OPTIONS);
    expectSdkError(() => sdk.search('x', { pageSize: 0 }), ErrorCodes.INVALID_OPTIONS);
    expectSdkError(() => sdk.search('x', { pageSize: 101 }), ErrorCodes.INVALID_OPTIONS);
    expectSdkError(() => sdk.search('x', { pageSize: 2.5 }), ErrorCodes.INVALID_OPTIONS);
  });

  it('pageSize boundaries 1 and 100 are accepted', () => {
    const sdk = makeSdk();
    expect(sdk.search('e', { pageSize: 1 }).items).toHaveLength(1);
    expect(sdk.search('e', { pageSize: 100 }).items).toHaveLength(7);
  });

  it('unspecified options use defaults', () => {
    const sdk = makeSdk();
    const result = sdk.search('e');
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(10);
    expect(result.items).toHaveLength(7); // all on one page
  });
});

describe('search: freshness and immutability', () => {
  it('results update after create, rename, move, delete, and undo', () => {
    const sdk = makeSdk();

    const file = sdk.createFile('id-1', 'tempfile.txt');
    expect(sdk.search('tempfile').total).toBe(1);

    sdk.rename(file.id, 'renamed-file.txt');
    expect(sdk.search('tempfile').total).toBe(0);
    expect(sdk.search('renamed-file').items[0].location).toBe('My Files');

    sdk.move(file.id, 'id-7'); // → Pictures
    expect(sdk.search('renamed-file').items[0].location).toBe('My Files / Pictures');

    sdk.delete(file.id);
    expect(sdk.search('renamed-file').total).toBe(0);

    sdk.undo(); // undo the delete
    expect(sdk.search('renamed-file').total).toBe(1);
    assertInvariants(sdk);
  });

  it('search never mutates the tree', () => {
    const sdk = makeSdk();
    const before = dumpTree(sdk);
    sdk.search('e', { sortBy: 'path', order: 'desc', pageSize: 3 });
    sdk.search('zzz-no-match');
    expect(dumpTree(sdk)).toEqual(before);
    assertInvariants(sdk);
  });

  it('returns fresh frozen objects (mutating a result cannot affect the SDK)', () => {
    const sdk = makeSdk();
    const result = sdk.search('vacation');

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.items)).toBe(true);
    expect(Object.isFrozen(result.items[0])).toBe(true);
    expect(() => {
      result.items[0].name = 'hacked';
    }).toThrow(TypeError);

    expect(sdk.search('vacation').items[0].name).toBe('vacation.jpg');
  });

  it('two calls with no changes return distinct but equal result objects', () => {
    const sdk = makeSdk();
    const a = sdk.search('doc');
    const b = sdk.search('doc');
    expect(a).not.toBe(b);
    expect(a.items[0]).not.toBe(b.items[0]);
    expect(a).toEqual(b);
  });
});
