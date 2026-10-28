import { describe, it, expect } from 'vitest';
import { FileExplorerSDK } from '../../src/sdk/FileExplorerSDK.js';
import { ErrorCodes, FileExplorerError } from '../../src/sdk/errors.js';
import { createSampleData } from '../../src/sdk/sample-data.js';
import { assertInvariants } from './helpers/assertInvariants.js';

function makeIdGenerator() {
  let n = 0;
  return () => `id-${++n}`;
}

function makeSdk(options = {}) {
  return new FileExplorerSDK({
    initialData: createSampleData(),
    idGenerator: makeIdGenerator(),
    ...options,
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

/** Structural dump in insertion order — used to compare whole trees. */
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

describe('history: undo/redo per operation', () => {
  it('undo/redo a create', () => {
    const sdk = makeSdk();
    const file = sdk.createFile('id-1', 'temp.txt');

    sdk.undo();
    expect(() => sdk.getItem(file.id)).toThrow(FileExplorerError);
    expect(sdk.canRedo()).toBe(true);

    sdk.redo();
    expect(sdk.getItem(file.id).name).toBe('temp.txt');
    expect(sdk.getItem(file.id).id).toBe(file.id); // same id after redo
    assertInvariants(sdk);
  });

  it('undo/redo a rename', () => {
    const sdk = makeSdk();
    sdk.rename('id-4', 'Renamed.docx');

    sdk.undo();
    expect(sdk.getItem('id-4').name).toBe('Report.docx');

    sdk.redo();
    expect(sdk.getItem('id-4').name).toBe('Renamed.docx');
    assertInvariants(sdk);
  });

  it('undo/redo a move, restoring the original index', () => {
    const sdk = makeSdk();
    // Documents children: [Work, Resume.pdf, Notes.txt]
    sdk.move('id-6', 'id-7'); // Notes.txt → Pictures (was index 2)
    expect(sdk.getItem('id-2').childIds).toEqual(['id-3', 'id-5']);

    sdk.undo();
    expect(sdk.getItem('id-2').childIds).toEqual(['id-3', 'id-5', 'id-6']);
    expect(sdk.getItem('id-6').parentId).toBe('id-2');

    sdk.redo();
    expect(sdk.getItem('id-7').childIds).toContain('id-6');
    assertInvariants(sdk);
  });

  it('undo/redo a delete of a nested folder restores the whole subtree with the same ids', () => {
    const sdk = makeSdk();
    const result = sdk.delete('id-2'); // Documents subtree
    expect(result.deletedIds).toHaveLength(5);

    sdk.undo();
    for (const id of ['id-2', 'id-3', 'id-4', 'id-5', 'id-6']) {
      expect(sdk.hasItem(id)).toBe(true);
    }
    expect(sdk.getItem('id-2').childIds).toEqual(['id-3', 'id-5', 'id-6']);
    expect(sdk.getItem('id-3').childIds).toEqual(['id-4']);
    assertInvariants(sdk);

    sdk.redo();
    for (const id of ['id-2', 'id-3', 'id-4', 'id-5', 'id-6']) {
      expect(sdk.hasItem(id)).toBe(false);
    }
    assertInvariants(sdk);
  });
});

describe('history: rules', () => {
  it('a new op after undo clears the redo stack', () => {
    const sdk = makeSdk();
    sdk.createFile('id-1', 'a.txt');
    sdk.createFile('id-1', 'b.txt');
    sdk.undo();
    expect(sdk.canRedo()).toBe(true);

    sdk.createFile('id-1', 'c.txt');
    expect(sdk.canRedo()).toBe(false);
    expect(sdk.getHistory().redo).toEqual([]);
    assertInvariants(sdk);
  });

  it('a failed op adds no history and no activity entry', () => {
    const sdk = makeSdk();
    sdk.createFile('id-1', 'a.txt');
    const activityCount = sdk.getActivityLog().length;

    expectSdkError(() => sdk.createFile('id-2', 'Resume.pdf'), ErrorCodes.DUPLICATE_NAME);

    expect(sdk.getHistory().undo).toHaveLength(1);
    expect(sdk.getActivityLog()).toHaveLength(activityCount);
    assertInvariants(sdk);
  });

  it('a no-op rename and a no-op move add no history', () => {
    const sdk = makeSdk();
    sdk.rename('id-4', 'Report.docx');
    sdk.move('id-5', 'id-2');
    expect(sdk.canUndo()).toBe(false);
    expect(sdk.getHistory().undo).toEqual([]);
  });

  it('undo/redo with empty stacks throw NOTHING_TO_UNDO / NOTHING_TO_REDO', () => {
    const sdk = makeSdk();
    expectSdkError(() => sdk.undo(), ErrorCodes.NOTHING_TO_UNDO);
    expectSdkError(() => sdk.redo(), ErrorCodes.NOTHING_TO_REDO);
  });

  it('the history cap drops the oldest entry', () => {
    const sdk = makeSdk({ historyLimit: 3 });
    const a = sdk.createFile('id-1', 'a.txt');
    const b = sdk.createFile('id-1', 'b.txt');
    const c = sdk.createFile('id-1', 'c.txt');
    const d = sdk.createFile('id-1', 'd.txt');

    const history = sdk.getHistory();
    expect(history.undo).toHaveLength(3);
    expect(history.undo[0]).toContain('d.txt'); // most recent first

    // The oldest create ("a.txt") was dropped from history; undoing three
    // times removes d, c, b but can never reach a.
    sdk.undo();
    sdk.undo();
    sdk.undo();
    expect(sdk.hasItem(d.id)).toBe(false);
    expect(sdk.hasItem(c.id)).toBe(false);
    expect(sdk.hasItem(b.id)).toBe(false);
    expect(sdk.hasItem(a.id)).toBe(true);
    expect(sdk.canUndo()).toBe(false);
    assertInvariants(sdk);
  });

  it('undo and redo each notify exactly once', () => {
    const sdk = makeSdk();
    const file = sdk.createFile('id-1', 'x.txt');
    const events = [];
    sdk.subscribe((event) => events.push(event.type));

    sdk.undo();
    sdk.redo();

    expect(events).toEqual(['undo', 'redo']);
  });

  it('undo/redo events carry the command label and version', () => {
    const sdk = makeSdk();
    sdk.createFile('id-1', 'x.txt');
    const events = [];
    sdk.subscribe((event) => events.push(event));

    sdk.undo();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('undo');
    expect(events[0].command).toContain('x.txt');
    expect(typeof events[0].version).toBe('number');
  });
});

describe('history: long mixed sequences', () => {
  it('undoing everything returns to the initial tree', () => {
    const sdk = makeSdk();
    const initial = dumpTree(sdk);

    sdk.createFile('id-1', 'alpha.txt');
    sdk.createFolder('id-1', 'Beta');
    sdk.rename('id-4', 'Report FINAL.docx');
    sdk.move('id-5', 'id-7'); // Resume.pdf → Pictures
    sdk.delete('id-10'); // Music
    sdk.createFile('id-3', 'nested.txt');
    sdk.move('id-3', 'id-1'); // Work → root

    while (sdk.canUndo()) sdk.undo();
    expect(dumpTree(sdk)).toEqual(initial);
    assertInvariants(sdk);
  });

  it('redoing everything returns to the final tree', () => {
    const sdk = makeSdk();
    sdk.createFile('id-1', 'alpha.txt');
    sdk.rename('id-4', 'Report FINAL.docx');
    sdk.move('id-5', 'id-7');
    sdk.delete('id-10');
    const final = dumpTree(sdk);

    while (sdk.canUndo()) sdk.undo();
    while (sdk.canRedo()) sdk.redo();

    expect(dumpTree(sdk)).toEqual(final);
    assertInvariants(sdk);
  });
});

describe('activity log', () => {
  it('records every successful operation with a friendly message', () => {
    const sdk = makeSdk();
    sdk.createFile('id-1', 'x.txt');
    sdk.rename('id-4', 'Renamed.docx');
    sdk.move('id-5', 'id-7');
    sdk.delete('id-10');

    const log = sdk.getActivityLog();
    expect(log.map((e) => e.type)).toEqual(['create', 'rename', 'move', 'delete']);
    expect(log[0].message).toContain('x.txt');
    expect(log[1].message).toContain('Renamed');
    expect(log[2].message).toContain('Resume.pdf');
    expect(log[3].message).toContain('Music');
  });

  it('includes undo and redo entries', () => {
    const sdk = makeSdk();
    sdk.createFile('id-1', 'x.txt');
    sdk.undo();
    sdk.redo();

    const types = sdk.getActivityLog().map((e) => e.type);
    expect(types).toEqual(['create', 'undo', 'redo']);
  });

  it('respects the limit argument (most recent entries)', () => {
    const sdk = makeSdk();
    sdk.createFile('id-1', 'a.txt');
    sdk.createFile('id-1', 'b.txt');
    sdk.createFile('id-1', 'c.txt');

    const log = sdk.getActivityLog(2);
    expect(log).toHaveLength(2);
    expect(log[0].message).toContain('b.txt');
    expect(log[1].message).toContain('c.txt');
  });

  it('is capped at activityLimit', () => {
    const sdk = makeSdk({ activityLimit: 4 });
    for (let i = 0; i < 10; i += 1) {
      sdk.createFile('id-1', `f-${i}.txt`);
    }
    expect(sdk.getActivityLog()).toHaveLength(4);
    expect(sdk.getActivityLog()[3].message).toContain('f-9.txt');
  });

  it('returns frozen entries', () => {
    const sdk = makeSdk();
    sdk.createFile('id-1', 'x.txt');
    const log = sdk.getActivityLog();
    expect(Object.isFrozen(log)).toBe(true);
    expect(Object.isFrozen(log[0])).toBe(true);
  });

  it('has entries with id, type, message, itemId, timestamp, version', () => {
    const sdk = makeSdk();
    const file = sdk.createFile('id-1', 'x.txt');
    const entry = sdk.getActivityLog()[0];

    expect(entry).toMatchObject({
      type: 'create',
      itemId: file.id,
    });
    expect(typeof entry.id).toBe('string');
    expect(typeof entry.message).toBe('string');
    expect(typeof entry.timestamp).toBe('number');
    expect(entry.version).toBe(1);
  });
});
