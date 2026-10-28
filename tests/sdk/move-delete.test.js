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

describe('move', () => {
  it('moves a file to another folder, appended as the last child', () => {
    const sdk = makeSdk();
    const moved = sdk.move('id-5', 'id-7'); // Resume.pdf → Pictures

    expect(moved.parentId).toBe('id-7');
    expect(sdk.getItem('id-2').childIds).not.toContain('id-5');
    expect(sdk.getItem('id-7').childIds.at(-1)).toBe('id-5');
    assertInvariants(sdk);
  });

  it('moves a folder with its whole subtree, preserving ids (identity)', () => {
    const sdk = makeSdk();
    const moved = sdk.move('id-3', 'id-7'); // Work (with Report.docx) → Pictures

    expect(moved.id).toBe('id-3');
    expect(sdk.getItem('id-4').parentId).toBe('id-3'); // child intact
    expect(sdk.getItem('id-3').parentId).toBe('id-7');
    expect(sdk.getPath('id-4').text).toBe('My Files / Pictures / Work / Report.docx');
    assertInvariants(sdk);
  });

  it('move to the same parent is a no-op (no version bump)', () => {
    const sdk = makeSdk();
    const version = sdk.getVersion();
    const item = sdk.move('id-5', 'id-2'); // already in Documents

    expect(item.parentId).toBe('id-2');
    expect(sdk.getVersion()).toBe(version);
    assertInvariants(sdk);
  });

  it('rejects moving the root (ROOT_PROTECTED)', () => {
    const sdk = makeSdk();
    expectSdkError(() => sdk.move(sdk.getRootId(), 'id-2'), ErrorCodes.ROOT_PROTECTED);
  });

  it('rejects moving into a missing item (NOT_FOUND)', () => {
    const sdk = makeSdk();
    expectSdkError(() => sdk.move('id-5', 'ghost'), ErrorCodes.NOT_FOUND);
    expectSdkError(() => sdk.move('ghost', 'id-2'), ErrorCodes.NOT_FOUND);
  });

  it('rejects moving into a file (INVALID_PARENT)', () => {
    const sdk = makeSdk();
    expectSdkError(() => sdk.move('id-5', 'id-4'), ErrorCodes.INVALID_PARENT); // into Report.docx
    assertInvariants(sdk);
  });

  it('rejects moving a folder into itself (INVALID_MOVE)', () => {
    const sdk = makeSdk();
    expectSdkError(() => sdk.move('id-2', 'id-2'), ErrorCodes.INVALID_MOVE);
    assertInvariants(sdk);
  });

  it('rejects moving a folder into its direct child (INVALID_MOVE)', () => {
    const sdk = makeSdk();
    expectSdkError(() => sdk.move('id-2', 'id-3'), ErrorCodes.INVALID_MOVE); // Documents → Work
    assertInvariants(sdk);
  });

  it('rejects moving a folder into a deep descendant (INVALID_MOVE)', () => {
    const sdk = makeSdk();
    const deep = sdk.createFolder('id-3', 'Deep'); // inside Work, a deep descendant of Documents
    expectSdkError(() => sdk.move('id-2', deep.id), ErrorCodes.INVALID_MOVE); // Documents → Deep
    assertInvariants(sdk);
  });

  it('rejects a name collision in the target folder (DUPLICATE_NAME)', () => {
    const sdk = makeSdk();
    sdk.createFile('id-7', 'Notes.txt'); // Pictures now has a Notes.txt
    expectSdkError(() => sdk.move('id-6', 'id-7'), ErrorCodes.DUPLICATE_NAME); // Notes.txt → Pictures
    expect(sdk.getItem('id-6').parentId).toBe('id-2');
    assertInvariants(sdk);
  });

  it('a failed move leaves the version unchanged', () => {
    const sdk = makeSdk();
    const version = sdk.getVersion();
    expectSdkError(() => sdk.move('id-2', 'id-3'), ErrorCodes.INVALID_MOVE);
    expect(sdk.getVersion()).toBe(version);
  });
});

describe('delete', () => {
  it('deletes a leaf file', () => {
    const sdk = makeSdk();
    const result = sdk.delete('id-5'); // Resume.pdf

    expect(result.deletedIds).toEqual(['id-5']);
    expect(() => sdk.getItem('id-5')).toThrow(FileExplorerError);
    expect(sdk.getItem('id-2').childIds).not.toContain('id-5');
    assertInvariants(sdk);
  });

  it('deletes a deep folder and removes every descendant', () => {
    const sdk = makeSdk();
    const result = sdk.delete('id-2'); // Documents (Work, Report.docx, Resume.pdf, Notes.txt)

    expect(result.deletedIds).toHaveLength(5);
    for (const id of ['id-2', 'id-3', 'id-4', 'id-5', 'id-6']) {
      expect(() => sdk.getItem(id)).toThrow(FileExplorerError);
    }
    expect(sdk.getItem(sdk.getRootId()).childIds).not.toContain('id-2');
    expect(sdk.getVersion()).toBe(1);
    assertInvariants(sdk);
  });

  it('rejects deleting the root (ROOT_PROTECTED)', () => {
    const sdk = makeSdk();
    expectSdkError(() => sdk.delete(sdk.getRootId()), ErrorCodes.ROOT_PROTECTED);
    assertInvariants(sdk);
  });

  it('rejects deleting a missing item (NOT_FOUND)', () => {
    const sdk = makeSdk();
    expectSdkError(() => sdk.delete('ghost'), ErrorCodes.NOT_FOUND);
  });

  it('a failed delete leaves the version unchanged', () => {
    const sdk = makeSdk();
    const version = sdk.getVersion();
    expectSdkError(() => sdk.delete(sdk.getRootId()), ErrorCodes.ROOT_PROTECTED);
    expect(sdk.getVersion()).toBe(version);
  });

  it('deletedIds is a frozen array', () => {
    const sdk = makeSdk();
    const result = sdk.delete('id-3'); // Work
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.deletedIds)).toBe(true);
  });

  it('deleting a parent while a sibling subtree remains keeps invariants', () => {
    const sdk = makeSdk();
    sdk.delete('id-7'); // Pictures
    expect(sdk.getItem(sdk.getRootId()).childIds).toEqual(['id-2', 'id-10', 'id-12']);
    assertInvariants(sdk);
  });
});
