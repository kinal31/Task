/**
 * Non-React usage demo. Proves the SDK is framework-independent:
 * run it with plain `node examples/node-demo.js`.
 *
 * It also doubles as the source for the README's usage examples.
 */

import {
  FileExplorerSDK,
  FileExplorerError,
  createSampleData,
} from '../src/sdk/index.js';

// ── helpers ────────────────────────────────────────────────────────────────

function printTree(sdk) {
  const walk = (node, prefix) => {
    console.log(prefix + node.name + (node.type === 'folder' ? '/' : ''));
    for (const child of node.children) {
      walk(child, prefix + '  ');
    }
  };
  walk(sdk.getSnapshot(), '');
}

// ── setup ──────────────────────────────────────────────────────────────────

const sdk = new FileExplorerSDK({
  initialData: createSampleData(),
  rootName: 'My Files',
});

console.log('=== 1. Initial tree ===');
printTree(sdk);

console.log('\n=== 2. Subscriptions ===');
const unsubscribe = sdk.subscribe((event) => {
  console.log(
    `  [event] ${event.type}${event.name ? ` "${event.name}"` : ''} (v${event.version})`
  );
});

console.log('\n=== 3. Mutations ===');
const report = sdk.createFile(sdk.getRootId(), 'Meeting Notes.txt');
sdk.rename(report.id, 'Standup Notes.txt');
const pictures = sdk.search('Pictures', { type: 'folder' }).items[0];
sdk.move(report.id, pictures.id);
const music = sdk.search('Music', { type: 'folder' }).items[0];
sdk.delete(music.id);

console.log('\n=== 4. Path and search ===');
console.log('Path:', sdk.getPath(report.id).text);
const search = sdk.search('notes', { type: 'file', sortBy: 'name', order: 'asc' });
console.log('Search "notes":');
for (const item of search.items) {
  console.log(`  - ${item.name}  [${item.location}]`);
}

console.log('\n=== 5. Undo / redo ===');
console.log('Undoing delete of Music...');
sdk.undo();
console.log('Music back?', sdk.search('song.mp3').total === 1);
console.log('Redoing...');
sdk.redo();
console.log('Music gone again?', sdk.search('song.mp3').total === 0);
console.log('History:', JSON.stringify(sdk.getHistory()));

console.log('\n=== 6. Transactions ===');
const before = sdk.getSize();
try {
  sdk.transaction((tx) => {
    const staging = tx.createFolder(sdk.getRootId(), 'Staging');
    tx.move(report.id, staging.id);
    tx.createFile(sdk.getRootId(), 'will-fail'); // fine
    tx.createFile(staging.id, 'Resume.pdf'); // DUPLICATE? no — different folder, ok
    // Force a rollback with an invalid op:
    tx.delete('does-not-exist');
  });
} catch (e) {
  if (e instanceof FileExplorerError) {
    console.log(`  Transaction failed as expected: [${e.code}] ${e.message}`);
  } else {
    throw e;
  }
}
console.log('Size unchanged after rollback?', sdk.getSize() === before);
console.log('Undo stack after failed tx:', sdk.getHistory().undo.length);

sdk.transaction((tx) => {
  const staging = tx.createFolder(sdk.getRootId(), 'Staging');
  tx.move(report.id, staging.id);
});
console.log('Committed staging move. Root children:');
printTree(sdk);

console.log('\n=== 7. Immutability ===');
const snapshot = sdk.getSnapshot();
console.log('Snapshot frozen?', Object.isFrozen(snapshot));
try {
  snapshot.name = 'hacked';
} catch {
  console.log('Mutating the snapshot throws (strict mode) ✓');
}

console.log('\n=== 8. Error handling demo ===');
try {
  sdk.rename(sdk.getRootId(), 'Nope');
} catch (e) {
  console.log(`  [${e.code}] ${e.message}`);
}
try {
  sdk.createFile(pictures.id, 'vacation.jpg'); // duplicate inside Pictures
} catch (e) {
  console.log(`  [${e.code}] ${e.message}`);
}

unsubscribe();
console.log('\n=== 9. Activity log (newest last) ===');
for (const entry of sdk.getActivityLog(10)) {
  console.log(`  v${entry.version} ${entry.message}`);
}

console.log('\nDone. Subscribers left:', sdk.listenerCount());
