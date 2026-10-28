import { describe, it, expect } from 'vitest';
import { FileExplorerSDK } from '../../src/sdk/FileExplorerSDK.js';
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

function expectDeeplyFrozen(value) {
  expect(Object.isFrozen(value)).toBe(true);
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      expectDeeplyFrozen(value[key]);
    }
  }
}

describe('getSnapshot: reference stability', () => {
  it('returns the same reference when nothing changed', () => {
    const sdk = makeSdk();
    const first = sdk.getSnapshot();
    const second = sdk.getSnapshot();
    expect(second).toBe(first);
  });

  it('getTree is the same object as getSnapshot', () => {
    const sdk = makeSdk();
    expect(sdk.getTree()).toBe(sdk.getSnapshot());
  });

  it('a change produces a new root reference', () => {
    const sdk = makeSdk();
    const before = sdk.getSnapshot();
    sdk.createFile('id-1', 'x.txt');
    const after = sdk.getSnapshot();
    expect(after).not.toBe(before);
    expect(sdk.getSnapshot()).toBe(after); // stable again after the change
  });

  it('the version number drives the rebuild', () => {
    const sdk = makeSdk();
    sdk.getSnapshot();
    expect(sdk._snapshotVersion).toBe(sdk.getVersion());
    sdk.rename('id-4', 'Other.docx');
    sdk.getSnapshot();
    expect(sdk._snapshotVersion).toBe(sdk.getVersion());
  });
});

describe('getSnapshot: structural sharing', () => {
  it('a nested rename changes only the item and its ancestor chain; siblings keep references', () => {
    const sdk = makeSdk();
    const before = sdk.getSnapshot();
    // Root children sorted: Documents(0), Music(1), Pictures(2), readme.md(3)

    sdk.rename('id-11', 'tune.mp3'); // song.mp3, inside Music

    const after = sdk.getSnapshot();
    expect(after).not.toBe(before);
    expect(after.children[1]).not.toBe(before.children[1]); // Music changed
    expect(after.children[0]).toBe(before.children[0]); // Documents untouched
    expect(after.children[2]).toBe(before.children[2]); // Pictures untouched
    expect(after.children[3]).toBe(before.children[3]); // readme.md untouched

    // Documents' whole subtree is reference-identical.
    expect(after.children[0].children).toBe(before.children[0].children);
    assertInvariants(sdk);
  });

  it('a create changes the parent and ancestors; sibling subtrees keep references', () => {
    const sdk = makeSdk();
    const before = sdk.getSnapshot();

    sdk.createFolder('id-2', 'Archive'); // inside Documents

    const after = sdk.getSnapshot();
    expect(after.children[0]).not.toBe(before.children[0]); // Documents changed
    expect(after.children[1]).toBe(before.children[1]); // Music untouched
    expect(after.children[2]).toBe(before.children[2]); // Pictures untouched
    assertInvariants(sdk);
  });

  it('a move updates both sides of the move but not other subtrees', () => {
    const sdk = makeSdk();
    const before = sdk.getSnapshot();

    sdk.move('id-3', 'id-7'); // Work (folder) → Pictures

    const after = sdk.getSnapshot();
    expect(after.children[0]).not.toBe(before.children[0]); // Documents lost Work
    expect(after.children[2]).not.toBe(before.children[2]); // Pictures gained Work
    expect(after.children[1]).toBe(before.children[1]); // Music untouched
    expect(after.children[3]).toBe(before.children[3]); // readme.md untouched
    // Work's tree object is new (its parentId changed), but its child
    // subtree (Report.docx) is reference-reused.
    const workAfter = after.children[2].children.find((c) => c.id === 'id-3');
    const workBefore = before.children[0].children.find((c) => c.id === 'id-3');
    expect(workAfter).not.toBe(workBefore);
    expect(workAfter.children[0]).toBe(workBefore.children[0]);
    assertInvariants(sdk);
  });

  it('after undoing everything, the snapshot is deep-equal to the initial one', () => {
    const sdk = makeSdk();
    const initial = sdk.getSnapshot();

    sdk.createFile('id-1', 'tmp.txt');
    sdk.rename('id-4', 'Renamed.docx');
    sdk.move('id-5', 'id-7');
    sdk.delete('id-10');

    while (sdk.canUndo()) sdk.undo();

    expect(sdk.getSnapshot()).toEqual(initial);
    assertInvariants(sdk);
  });
});

describe('getSnapshot: shape and immutability', () => {
  it('children are sorted folders-first, then by name', () => {
    const sdk = makeSdk();
    const root = sdk.getSnapshot();

    expect(root.children.map((c) => c.name)).toEqual([
      'Documents',
      'Music',
      'Pictures',
      'readme.md', // the only file at root level comes last
    ]);

    const documents = root.children[0];
    expect(documents.children.map((c) => c.name)).toEqual([
      'Work', // folder first
      'Notes.txt',
      'Resume.pdf', // files by name
    ]);
  });

  it('tree nodes have the shape { id, name, type, parentId, children }', () => {
    const sdk = makeSdk();
    const root = sdk.getSnapshot();
    expect(Object.keys(root)).toEqual([
      'id',
      'name',
      'type',
      'parentId',
      'children',
    ]);
    expect(root.parentId).toBeNull();
    expect(root.type).toBe('folder');
  });

  it('files have an empty children array', () => {
    const sdk = makeSdk();
    const readme = sdk.getSnapshot().children.find((c) => c.type === 'file');
    expect(readme.children).toEqual([]);
    expect(Object.isFrozen(readme.children)).toBe(true);
  });

  it('the snapshot is deeply frozen', () => {
    const sdk = makeSdk();
    expectDeeplyFrozen(sdk.getSnapshot());
  });

  it('mutating anything in the snapshot throws and leaves the SDK unchanged', () => {
    const sdk = makeSdk();
    const snapshot = sdk.getSnapshot();
    const version = sdk.getVersion();

    expect(() => {
      snapshot.name = 'hacked';
    }).toThrow(TypeError);
    expect(() => {
      snapshot.children.push({});
    }).toThrow(TypeError);
    expect(() => {
      snapshot.children[0].name = 'hacked';
    }).toThrow(TypeError);

    expect(sdk.getSnapshot()).toBe(snapshot);
    expect(sdk.getVersion()).toBe(version);
    expect(sdk.getItem('id-1').name).toBe('My Files');
  });

  it('snapshot reflects a rename immediately after the change', () => {
    const sdk = makeSdk();
    sdk.rename('id-2', 'Docs');
    const names = sdk.getSnapshot().children.map((c) => c.name);
    expect(names).toContain('Docs');
    expect(names).not.toContain('Documents');
  });
});
