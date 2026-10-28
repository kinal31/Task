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

describe('transaction: success path', () => {
  it('commits all operations with a single notification and a single undo', () => {
    const sdk = makeSdk();
    const events = [];
    sdk.subscribe((event) => events.push(event.type));

    sdk.transaction((tx) => {
      tx.createFolder('id-1', 'Bulk');
      tx.createFile('id-1', 'one.txt');
      tx.rename('id-6', 'Notes2.txt');
    });

    expect(events).toEqual(['transaction']); // exactly one
    expect(sdk.getHistory().undo).toHaveLength(1);
    expect(sdk.getHistory().undo[0]).toContain('Transaction');
    expect(sdk.getItem(sdk.getRootId()).childIds).toHaveLength(6); // 4 seeded + Bulk + one.txt
    assertInvariants(sdk);
  });

  it('returns whatever the callback returns', () => {
    const sdk = makeSdk();
    const result = sdk.transaction((tx) => {
      const file = tx.createFile('id-1', 'x.txt');
      return { createdId: file.id };
    });
    expect(typeof result.createdId).toBe('string');
    expect(sdk.hasItem(result.createdId)).toBe(true);
  });

  it('one undo reverses the entire batch (revert in reverse order)', () => {
    const sdk = makeSdk();
    const before = dumpTree(sdk);

    sdk.transaction((tx) => {
      tx.createFolder('id-1', 'Bulk');
      tx.move('id-5', 'id-7'); // Resume.pdf → Pictures
      tx.delete('id-10'); // Music
    });
    const after = dumpTree(sdk);
    expect(after).not.toEqual(before);

    sdk.undo();
    expect(dumpTree(sdk)).toEqual(before);
    assertInvariants(sdk);

    sdk.redo();
    expect(dumpTree(sdk)).toEqual(after);
    assertInvariants(sdk);
  });

  it('reads inside the transaction see the draft state', () => {
    const sdk = makeSdk();
    sdk.transaction((tx) => {
      const folder = tx.createFolder('id-1', 'Stage');
      // The just-created folder must be usable as a move target.
      tx.move('id-5', folder.id);
      expect(sdk.getItem(folder.id).childIds).toEqual(['id-5']);
      expect(sdk.search('Resume.pdf').items[0].location).toBe('My Files / Stage');
    });
    assertInvariants(sdk);
  });

  it('an empty transaction changes nothing and adds no history', () => {
    const sdk = makeSdk();
    const version = sdk.getVersion();
    const events = [];
    sdk.subscribe((event) => events.push(event.type));

    const result = sdk.transaction(() => 'noop');

    expect(result).toBe('noop');
    expect(sdk.getVersion()).toBe(version);
    expect(sdk.canUndo()).toBe(false);
    expect(events).toEqual([]);
  });

  it('records one activity-log entry for the whole batch', () => {
    const sdk = makeSdk();
    sdk.transaction((tx) => {
      tx.createFile('id-1', 'a.txt');
      tx.createFile('id-1', 'b.txt');
    });

    const log = sdk.getActivityLog();
    expect(log).toHaveLength(1);
    expect(log[0].type).toBe('transaction');
    expect(log[0].message).toContain('2 operations');
  });

  it('the transaction event payload carries the inner events', () => {
    const sdk = makeSdk();
    const events = [];
    sdk.subscribe((event) => events.push(event));

    sdk.transaction((tx) => {
      tx.createFile('id-1', 'a.txt');
      tx.delete('id-10');
    });

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('transaction');
    expect(events[0].count).toBe(2);
    expect(events[0].events.map((e) => e.type)).toEqual(['create', 'delete']);
    expect(typeof events[0].version).toBe('number');
  });
});

describe('transaction: failure and rollback', () => {
  it('a failure in a later op restores the original tree exactly', () => {
    const sdk = makeSdk();
    const before = dumpTree(sdk);

    expectSdkError(
      () =>
        sdk.transaction((tx) => {
          tx.createFolder('id-1', 'Stage'); // ok
          tx.move('id-5', 'id-999'); // NOT_FOUND — fails
          tx.createFile('id-1', 'never.txt'); // never reached
        }),
      ErrorCodes.NOT_FOUND
    );

    expect(dumpTree(sdk)).toEqual(before);
    assertInvariants(sdk);
  });

  it('a failed transaction creates no history entry, no notification, and no version bump', () => {
    const sdk = makeSdk();
    const version = sdk.getVersion();
    const events = [];
    sdk.subscribe((event) => events.push(event.type));

    expectSdkError(
      () =>
        sdk.transaction((tx) => {
          tx.rename('id-4', 'ok.txt');
          tx.createFile('id-2', 'Resume.pdf'); // DUPLICATE_NAME
        }),
      ErrorCodes.DUPLICATE_NAME
    );

    expect(sdk.getVersion()).toBe(version);
    expect(sdk.canUndo()).toBe(false);
    expect(sdk.getHistory().undo).toEqual([]);
    expect(sdk.getActivityLog()).toHaveLength(0);
    expect(events).toEqual([]);
  });

  it('the original error is rethrown (code preserved)', () => {
    const sdk = makeSdk();
    const error = expectSdkError(
      () =>
        sdk.transaction((tx) => {
          tx.delete('id-4');
          tx.move('id-2', 'id-3'); // INVALID_MOVE
        }),
      ErrorCodes.INVALID_MOVE
    );
    expect(error).toBeInstanceOf(FileExplorerError);
    // The delete was rolled back too.
    expect(sdk.hasItem('id-4')).toBe(true);
  });

  it('a non-SDK error thrown by the callback also rolls back', () => {
    const sdk = makeSdk();
    const before = dumpTree(sdk);
    const boom = new Error('boom');

    expect(() =>
      sdk.transaction((tx) => {
        tx.createFile('id-1', 'x.txt');
        throw boom;
      })
    ).toThrow(boom);

    expect(dumpTree(sdk)).toEqual(before);
    expect(sdk.getVersion()).toBe(0);
    assertInvariants(sdk);
  });

  it('the SDK works normally after a failed transaction', () => {
    const sdk = makeSdk();
    expectSdkError(
      () =>
        sdk.transaction((tx) => {
          tx.createFile('id-1', 'a.txt');
          tx.delete(sdk.getRootId()); // ROOT_PROTECTED
        }),
      ErrorCodes.ROOT_PROTECTED
    );

    const file = sdk.createFile('id-1', 'b.txt');
    expect(sdk.hasItem(file.id)).toBe(true);
    sdk.undo();
    expect(sdk.hasItem(file.id)).toBe(false);
    assertInvariants(sdk);
  });

  it('an async callback is rejected and rolled back', () => {
    const sdk = makeSdk();
    const before = dumpTree(sdk);

    expectSdkError(
      () =>
        sdk.transaction((tx) => {
          tx.createFile('id-1', 'async.txt');
          return Promise.resolve('later');
        }),
      ErrorCodes.TRANSACTION_ERROR
    );

    expect(dumpTree(sdk)).toEqual(before);
    expect(sdk.canUndo()).toBe(false);
    assertInvariants(sdk);
  });
});

describe('transaction: nesting and misc', () => {
  it('nested transactions throw TRANSACTION_ERROR', () => {
    const sdk = makeSdk();
    expectSdkError(
      () =>
        sdk.transaction((tx) => {
          tx.createFile('id-1', 'a.txt');
          sdk.transaction((tx2) => {
            tx2.createFile('id-1', 'b.txt');
          });
        }),
      ErrorCodes.TRANSACTION_ERROR
    );
    // The outer transaction was rolled back as well.
    expect(sdk.getSize()).toBe(12);
    assertInvariants(sdk);
  });

  it('a non-function callback throws TRANSACTION_ERROR', () => {
    const sdk = makeSdk();
    expectSdkError(() => sdk.transaction(), ErrorCodes.TRANSACTION_ERROR);
    expectSdkError(() => sdk.transaction('nope'), ErrorCodes.TRANSACTION_ERROR);
  });

  it('the tx surface does not expose undo/redo/subscribe/transaction', () => {
    const sdk = makeSdk();
    let txKeys = null;
    sdk.transaction((tx) => {
      txKeys = Object.keys(tx).sort();
    });
    expect(txKeys).toEqual(['createFile', 'createFolder', 'delete', 'move', 'rename']);
  });

  it('bulk-style delete of several items is one undo step', () => {
    const sdk = makeSdk();
    const before = dumpTree(sdk);

    sdk.transaction((tx) => {
      tx.delete('id-5'); // Resume.pdf
      tx.delete('id-6'); // Notes.txt
      tx.delete('id-11'); // song.mp3
    });
    expect(sdk.getSize()).toBe(9);

    sdk.undo();
    expect(dumpTree(sdk)).toEqual(before);
    assertInvariants(sdk);
  });

  it('getSnapshot mid-transaction and after rollback stay consistent', () => {
    const sdk = makeSdk();
    const before = sdk.getSnapshot();

    expect(() =>
      sdk.transaction((tx) => {
        tx.createFile('id-1', 'x.txt');
        // Mid-tx read sees the draft:
        expect(sdk.getSnapshot().children.map((c) => c.name)).toContain('x.txt');
        throw new Error('rollback');
      })
    ).toThrow('rollback');

    expect(sdk.getSnapshot()).toEqual(before);
    assertInvariants(sdk);
  });
});
