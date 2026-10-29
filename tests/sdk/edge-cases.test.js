import { describe, it, expect } from 'vitest';
import { FileExplorerSDK } from '../../src/sdk/index.js';
import { FileExplorerError, ErrorCodes } from '../../src/sdk/errors.js';
import { assertInvariants } from './helpers/assertInvariants.js';

function makeSdk() {
  let n = 0;
  return new FileExplorerSDK({
    idGenerator: () => `id-${++n}`,
  });
}

describe('edge cases: deep nesting (10+ levels)', () => {
  it('creates 12 levels, reads the path, and keeps invariants', () => {
    const sdk = makeSdk();
    const rootId = sdk.getRootId();

    let parentId = rootId;
    const ids = [];
    for (let level = 1; level <= 12; level += 1) {
      const folder = sdk.createFolder(parentId, `Level ${level}`);
      ids.push(folder.id);
      parentId = folder.id;
    }
    const leaf = sdk.createFile(parentId, 'deep.txt');
    expect(sdk.getSize()).toBe(1 + 12 + 1); // root + folders + file

    const path = sdk.getPath(leaf.id);
    expect(path.names).toHaveLength(14); // root + 12 folders + file
    expect(path.text).toBe(
      [...Array(12)].map((_, i) => `Level ${i + 1}`).reduce(
        (acc, name) => `${acc} / ${name}`,
        'My Files'
      ) + ' / deep.txt'
    );
    assertInvariants(sdk);
  });

  it('deletes a mid-level folder and undo restores the whole chain', () => {
    const sdk = makeSdk();
    let parentId = sdk.getRootId();
    const ids = [];
    for (let level = 1; level <= 12; level += 1) {
      const folder = sdk.createFolder(parentId, `Level ${level}`);
      ids.push(folder.id);
      parentId = folder.id;
    }
    sdk.createFile(parentId, 'deep.txt');

    // delete Level 6 — removes 7..12 and the leaf
    sdk.delete(ids[5]);
    expect(sdk.hasItem(ids[6])).toBe(false);
    expect(sdk.hasItem(ids[11])).toBe(false);
    expect(sdk.getSize()).toBe(1 + 5); // root + Level 1..5 survive
    assertInvariants(sdk);

    sdk.undo();
    expect(sdk.hasItem(ids[11])).toBe(true);
    expect(sdk.getSize()).toBe(1 + 12 + 1);
    // identity preserved at every depth
    expect(sdk.getItem(ids[11]).parentId).toBe(ids[10]);
    assertInvariants(sdk);
  });

  it('search finds a file at depth 12 and reports its full path', () => {
    const sdk = makeSdk();
    let parentId = sdk.getRootId();
    for (let level = 1; level <= 12; level += 1) {
      parentId = sdk.createFolder(parentId, `Level ${level}`).id;
    }
    sdk.createFile(parentId, 'buried-needle.txt');

    const result = sdk.search('needle');
    expect(result.total).toBe(1);
    expect(result.items[0].path.split(' / ')).toHaveLength(14);
    assertInvariants(sdk);
  });
});

describe('edge cases: rapid sequences', () => {
  it('survives a rapid mixed sequence and undo-all returns to the initial tree', () => {
    const sdk = makeSdk();
    const rootId = sdk.getRootId();
    const initial = JSON.stringify(sdk.getSnapshot());

    // 30 rapid mixed operations
    let lastFile = null;
    for (let i = 0; i < 10; i += 1) {
      const folder = sdk.createFolder(rootId, `F${i}`);
      lastFile = sdk.createFile(folder.id, `f${i}.txt`);
      sdk.rename(lastFile.id, `renamed-${i}.txt`);
      sdk.move(lastFile.id, rootId);
    }
    assertInvariants(sdk);
    expect(sdk.canUndo()).toBe(true);

    let guard = 0;
    while (sdk.canUndo() && guard < 1000) {
      sdk.undo();
      guard += 1;
    }
    expect(JSON.stringify(sdk.getSnapshot())).toBe(initial);
    assertInvariants(sdk);

    // redo-all returns to the final tree
    let redoGuard = 0;
    while (sdk.canRedo() && redoGuard < 1000) {
      sdk.redo();
      redoGuard += 1;
    }
    expect(redoGuard).toBe(guard);
    expect(sdk.getSize()).toBe(1 + 10 + 10); // root + 10 folders + 10 files
    assertInvariants(sdk);
  });
});

describe('edge cases: names', () => {
  it('trims leading and trailing spaces and treats the result as the real name', () => {
    const sdk = makeSdk();
    const file = sdk.createFile(sdk.getRootId(), '   padded.txt   ');
    expect(file.name).toBe('padded.txt');

    // a sibling named "padded.txt" (untrimmed input) collides
    try {
      sdk.createFile(sdk.getRootId(), '  padded.txt  ');
      throw new Error('expected DUPLICATE_NAME');
    } catch (e) {
      expect(e).toBeInstanceOf(FileExplorerError);
      expect(e.code).toBe(ErrorCodes.DUPLICATE_NAME);
    }
    assertInvariants(sdk);
  });

  it('accepts the maximum 255-character name and rejects 256', () => {
    const sdk = makeSdk();
    const ok = sdk.createFile(sdk.getRootId(), 'x'.repeat(255));
    expect(ok.name).toHaveLength(255);
    try {
      sdk.createFile(sdk.getRootId(), 'y'.repeat(256));
      throw new Error('expected INVALID_NAME');
    } catch (e) {
      expect(e.code).toBe(ErrorCodes.INVALID_NAME);
    }
    assertInvariants(sdk);
  });
});
