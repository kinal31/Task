import { describe, it, expect } from 'vitest';
import { FileExplorerSDK } from '../../src/sdk/FileExplorerSDK.js';
import { ErrorCodes, FileExplorerError } from '../../src/sdk/errors.js';
import { createSampleData } from '../../src/sdk/sample-data.js';
import { assertInvariants, collectAllIds } from './helpers/assertInvariants.js';

/** Deterministic id factory: 'id-1', 'id-2', ... */
function makeIdGenerator() {
  let n = 0;
  return () => `id-${++n}`;
}

/**
 * Builds an SDK seeded with the sample tree and deterministic ids.
 * Sample tree (with ids in creation order):
 * root id-1 / Documents id-2 / Work id-3 / Report.docx id-4 /
 * Resume.pdf id-5 / Notes.txt id-6 / Pictures id-7 / vacation.jpg id-8 /
 * profile.png id-9 / Music id-10 / song.mp3 id-11 / readme.md id-12
 */
function makeSdk() {
  return new FileExplorerSDK({
    initialData: createSampleData(),
    idGenerator: makeIdGenerator(),
  });
}

describe('FileExplorerSDK: construction and reads', () => {
  it('creates a protected root with the default name', () => {
    const sdk = new FileExplorerSDK({ idGenerator: makeIdGenerator() });
    const root = sdk.getItem(sdk.getRootId());

    expect(root.name).toBe('My Files');
    expect(root.type).toBe('folder');
    expect(root.parentId).toBeNull();
    expect(root.childIds).toEqual([]);
    expect(sdk.getVersion()).toBe(0);
    assertInvariants(sdk);
  });

  it('accepts a custom root name and trims it', () => {
    const sdk = new FileExplorerSDK({
      rootName: '  Shared Drive  ',
      idGenerator: makeIdGenerator(),
    });
    expect(sdk.getItem(sdk.getRootId()).name).toBe('Shared Drive');
  });

  it('falls back to the default root name when given only whitespace', () => {
    const sdk = new FileExplorerSDK({
      rootName: '   ',
      idGenerator: makeIdGenerator(),
    });
    expect(sdk.getItem(sdk.getRootId()).name).toBe('My Files');
  });

  it('seeds the sample structure with insertion-ordered children', () => {
    const sdk = makeSdk();
    const root = sdk.getItem(sdk.getRootId());
    const names = root.childIds.map((id) => sdk.getItem(id).name);

    expect(names).toEqual(['Documents', 'Pictures', 'Music', 'readme.md']);
    expect(sdk.getSize()).toBe(12);
    assertInvariants(sdk);
  });

  it('rejects seed data with duplicate sibling names (case-insensitive)', () => {
    expect(
      () =>
        new FileExplorerSDK({
          initialData: {
            children: [
              { name: 'a.txt', type: 'file' },
              { name: 'A.txt', type: 'file' },
            ],
          },
          idGenerator: makeIdGenerator(),
        })
    ).toThrow(FileExplorerError);

    try {
      new FileExplorerSDK({
        initialData: {
          children: [
            { name: 'a.txt', type: 'file' },
            { name: 'A.txt', type: 'file' },
          ],
        },
        idGenerator: makeIdGenerator(),
      });
    } catch (e) {
      expect(e.code).toBe(ErrorCodes.DUPLICATE_NAME);
    }
  });

  it('rejects seed data with invalid names', () => {
    expect(
      () =>
        new FileExplorerSDK({
          initialData: { children: [{ name: 'bad/name', type: 'file' }] },
          idGenerator: makeIdGenerator(),
        })
    ).toThrow(FileExplorerError);
  });

  it('getItem returns a frozen copy that cannot mutate internal state', () => {
    const sdk = makeSdk();
    const item = sdk.getItem('id-4');
    expect(Object.isFrozen(item)).toBe(true);
    expect(Object.isFrozen(item.childIds)).toBe(true);

    expect(() => {
      item.name = 'hacked';
    }).toThrow(TypeError);

    expect(sdk.getItem('id-4').name).toBe('Report.docx');
  });

  it('getItem throws NOT_FOUND for an unknown id', () => {
    const sdk = makeSdk();
    try {
      sdk.getItem('nope');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(FileExplorerError);
      expect(e.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('getPath returns ids, names, and text from the root', () => {
    const sdk = makeSdk();
    const path = sdk.getPath('id-4');

    expect(path.ids).toEqual(['id-1', 'id-2', 'id-3', 'id-4']);
    expect(path.names).toEqual(['My Files', 'Documents', 'Work', 'Report.docx']);
    expect(path.text).toBe('My Files / Documents / Work / Report.docx');
    assertInvariants(sdk);
  });

  it('getPath on the root is just the root', () => {
    const sdk = makeSdk();
    const path = sdk.getPath(sdk.getRootId());
    expect(path.names).toEqual(['My Files']);
    expect(path.text).toBe('My Files');
  });

  it('getPath throws NOT_FOUND for an unknown id', () => {
    const sdk = makeSdk();
    try {
      sdk.getPath('missing');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('hasItem reflects existence', () => {
    const sdk = makeSdk();
    expect(sdk.hasItem('id-5')).toBe(true);
    expect(sdk.hasItem('ghost')).toBe(false);
  });

  it('collectAllIds finds every node (no orphans, no cycles)', () => {
    const sdk = makeSdk();
    const ids = collectAllIds(sdk);
    expect(ids).toHaveLength(12);
    expect(new Set(ids).size).toBe(12);
  });

  it('seeding does not change the version, history, or activity log', () => {
    const sdk = makeSdk();
    expect(sdk.getVersion()).toBe(0);
    expect(sdk.getActivityLog()).toEqual([]);
    expect(sdk.canUndo()).toBe(false);
    expect(sdk.canRedo()).toBe(false);
    assertInvariants(sdk);
  });
});
