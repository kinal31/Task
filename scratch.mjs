/**
 * Manual SDK playground — the same steps as the interactive REPL session,
 * but as a runnable script:
 *
 *   node scratch.mjs
 *
 * Tweak the calls freely and re-run. Every line is independent enough to
 * comment out; state is kept in `sdk` for the whole script.
 */

import {
  FileExplorerSDK,
  createSampleData,
} from './src/sdk/index.js';

// ── setup ──────────────────────────────────────────────────────────────────
const sdk = new FileExplorerSDK({ initialData: createSampleData() });

console.log('1) root children:', sdk.getTree().children.map((c) => c.name));

// ── mutations ──────────────────────────────────────────────────────────────
const f = sdk.createFile(sdk.getRootId(), 'test.txt');
console.log('2) created:', f.name, f.id);

sdk.rename(f.id, 'renamed.txt');
console.log('3) renamed ->', sdk.getItem(f.id).name);

console.log('4) path:', sdk.getPath(f.id).text);

console.log(
  '5) search "renamed":',
  sdk.search('renamed').items.map((i) => `${i.name} [${i.location}]`)
);

// ── notifications ──────────────────────────────────────────────────────────
const unsubscribe = sdk.subscribe((e) => console.log('   EVENT', e.type));

// ── undo / redo ────────────────────────────────────────────────────────────
sdk.undo();
console.log('6) after undo, name:', sdk.getItem(f.id).name); // back to test.txt

sdk.redo();
console.log('7) after redo, name:', sdk.getItem(f.id).name);

// ── transaction ────────────────────────────────────────────────────────────
sdk.transaction((tx) => {
  tx.delete(f.id);
});
console.log('8) after transaction delete, exists?', sdk.hasItem(f.id));

unsubscribe();

// ── activity log ───────────────────────────────────────────────────────────
console.log(
  '9) activity log (newest last):',
  sdk.getActivityLog(10).map((e) => e.message)
);

console.log('\nDone. Subscribers left:', sdk.listenerCount());
