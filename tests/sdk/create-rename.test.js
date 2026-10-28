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

/**
 * Runs `fn` and returns the thrown FileExplorerError, asserting it has `code`.
 */
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

describe('createFile / createFolder', () => {
  it('creates a file in a folder and appends it as the last child', () => {
    const sdk = makeSdk();
    const before = sdk.getVersion();

    const file = sdk.createFile('id-2', 'New Doc.txt'); // Documents

    expect(file.name).toBe('New Doc.txt');
    expect(file.type).toBe('file');
    expect(file.parentId).toBe('id-2');
    expect(file.childIds).toEqual([]);
    expect(sdk.getItem('id-2').childIds.at(-1)).toBe(file.id);
    expect(sdk.getVersion()).toBe(before + 1);
    assertInvariants(sdk);
  });

  it('creates a folder with an empty childIds array', () => {
    const sdk = makeSdk();
    const folder = sdk.createFolder('id-1', 'Archive');

    expect(folder.type).toBe('folder');
    expect(folder.childIds).toEqual([]);
    assertInvariants(sdk);
  });

  it('trims surrounding whitespace from the name', () => {
    const sdk = makeSdk();
    const file = sdk.createFile('id-1', '  spaced.txt  ');
    expect(file.name).toBe('spaced.txt');
    assertInvariants(sdk);
  });

  it('preserves the id across reads (stable identity)', () => {
    const sdk = makeSdk();
    const created = sdk.createFile('id-1', 'stable.txt');
    expect(sdk.getItem(created.id).id).toBe(created.id);
  });

  it('returns a frozen item; mutating it does not affect the SDK', () => {
    const sdk = makeSdk();
    const created = sdk.createFile('id-1', 'frozen.txt');
    expect(Object.isFrozen(created)).toBe(true);
    expect(() => {
      created.name = 'hacked';
    }).toThrow(TypeError);
    expect(sdk.getItem(created.id).name).toBe('frozen.txt');
  });

  it('rejects creating inside a file (INVALID_PARENT)', () => {
    const sdk = makeSdk();
    expectSdkError(() => sdk.createFile('id-4', 'x.txt'), ErrorCodes.INVALID_PARENT); // Report.docx
    assertInvariants(sdk);
  });

  it('rejects a missing parent (NOT_FOUND)', () => {
    const sdk = makeSdk();
    expectSdkError(() => sdk.createFolder('ghost', 'x'), ErrorCodes.NOT_FOUND);
    assertInvariants(sdk);
  });

  it('rejects a duplicate name, case-insensitively', () => {
    const sdk = makeSdk();
    expectSdkError(() => sdk.createFile('id-2', 'resume.PDF'), ErrorCodes.DUPLICATE_NAME);
    assertInvariants(sdk);
  });

  it('allows the same name in a different folder', () => {
    const sdk = makeSdk();
    const file = sdk.createFile('id-7', 'Notes.txt'); // Pictures
    expect(file.name).toBe('Notes.txt');
    assertInvariants(sdk);
  });

  it('rejects invalid names: empty, whitespace, slash, too long, non-string', () => {
    const sdk = makeSdk();
    expectSdkError(() => sdk.createFile('id-1', ''), ErrorCodes.INVALID_NAME);
    expectSdkError(() => sdk.createFile('id-1', '   '), ErrorCodes.INVALID_NAME);
    expectSdkError(() => sdk.createFile('id-1', 'a/b.txt'), ErrorCodes.INVALID_NAME);
    expectSdkError(() => sdk.createFile('id-1', 'x'.repeat(256)), ErrorCodes.INVALID_NAME);
    expectSdkError(() => sdk.createFile('id-1', 42), ErrorCodes.INVALID_NAME);
    assertInvariants(sdk);
  });

  it('a 255-character name is accepted (boundary)', () => {
    const sdk = makeSdk();
    const file = sdk.createFile('id-1', 'x'.repeat(255));
    expect(file.name).toHaveLength(255);
    assertInvariants(sdk);
  });

  it('a failed op leaves the version unchanged and adds no history', () => {
    const sdk = makeSdk();
    const version = sdk.getVersion();
    expectSdkError(() => sdk.createFile('id-2', 'Resume.pdf'), ErrorCodes.DUPLICATE_NAME);
    expect(sdk.getVersion()).toBe(version);
    assertInvariants(sdk);
  });
});

describe('rename', () => {
  it('renames an item, preserving its id', () => {
    const sdk = makeSdk();
    const before = sdk.getItem('id-4'); // Report.docx

    const after = sdk.rename('id-4', 'Final Report.docx');

    expect(after.id).toBe(before.id);
    expect(after.name).toBe('Final Report.docx');
    expect(after.parentId).toBe(before.parentId);
    expect(sdk.getVersion()).toBe(1);
    assertInvariants(sdk);
  });

  it('allows a case-only rename (a.txt → A.txt)', () => {
    const sdk = makeSdk();
    const renamed = sdk.rename('id-6', 'notes.TXT'); // Notes.txt
    expect(renamed.name).toBe('notes.TXT');
    assertInvariants(sdk);
  });

  it('rejects renaming to a sibling’s name, case-insensitively', () => {
    const sdk = makeSdk();
    expectSdkError(() => sdk.rename('id-6', 'resume.pdf'), ErrorCodes.DUPLICATE_NAME);
    expect(sdk.getItem('id-6').name).toBe('Notes.txt');
    assertInvariants(sdk);
  });

  it('rejects renaming the root (ROOT_PROTECTED)', () => {
    const sdk = makeSdk();
    expectSdkError(() => sdk.rename(sdk.getRootId(), 'Other'), ErrorCodes.ROOT_PROTECTED);
    assertInvariants(sdk);
  });

  it('rejects renaming a missing item (NOT_FOUND)', () => {
    const sdk = makeSdk();
    expectSdkError(() => sdk.rename('ghost', 'x'), ErrorCodes.NOT_FOUND);
  });

  it('rejects invalid new names', () => {
    const sdk = makeSdk();
    expectSdkError(() => sdk.rename('id-4', ''), ErrorCodes.INVALID_NAME);
    expectSdkError(() => sdk.rename('id-4', 'a/b'), ErrorCodes.INVALID_NAME);
    assertInvariants(sdk);
  });

  it('renaming to the same name is a no-op (no version bump, item unchanged)', () => {
    const sdk = makeSdk();
    const version = sdk.getVersion();
    const item = sdk.rename('id-4', 'Report.docx');

    expect(item.name).toBe('Report.docx');
    expect(sdk.getVersion()).toBe(version);
    assertInvariants(sdk);
  });

  it('renaming to the trimmed-equivalent name is also a no-op', () => {
    const sdk = makeSdk();
    const version = sdk.getVersion();
    sdk.rename('id-4', '  Report.docx  ');
    expect(sdk.getVersion()).toBe(version);
  });

  it('a failed rename leaves the version unchanged', () => {
    const sdk = makeSdk();
    sdk.rename('id-6', 'renamed.txt');
    const version = sdk.getVersion();
    expectSdkError(() => sdk.rename('id-6', 'resume.pdf'), ErrorCodes.DUPLICATE_NAME);
    expect(sdk.getVersion()).toBe(version);
    expect(sdk.getItem('id-6').name).toBe('renamed.txt');
  });
});
