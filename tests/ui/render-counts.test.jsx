import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from './helpers/renderApp.jsx';

/**
 * Render-count observations (the task requires a console.log in TreeNode).
 * These tests assert the re-render optimization: search typing must not
 * re-render the tree, and expanding one folder re-renders only that node
 * (plus newly shown children on expand).
 */
describe('render counts', () => {
  let logSpy;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  function treeLogs() {
    return logSpy.mock.calls.filter(
      (args) => args[0] === 'render TreeNode'
    );
  }

  function clearLogs() {
    logSpy.mockClear();
  }

  it('typing in the search box produces zero TreeNode logs', async () => {
    const user = userEvent.setup();
    renderApp();
    clearLogs();

    await user.type(screen.getByTestId('search-input'), 'hello');
    // allow debounce + any async renders
    await screen.findByTestId('search-input');

    expect(treeLogs()).toHaveLength(0);
  });

  it('expanding a folder logs only that node (plus newly mounted children)', async () => {
    const user = userEvent.setup();
    renderApp();
    clearLogs();

    await user.click(screen.getByLabelText(/Expand Documents/));

    const loggedNames = treeLogs().map((args) => args[1]);
    // Documents re-renders; its children mount for the first time.
    // No unrelated nodes (Pictures, Music, readme.md) should re-render.
    expect(loggedNames).toContain('Documents');
    expect(loggedNames).not.toContain('Pictures');
    expect(loggedNames).not.toContain('Music');
    expect(loggedNames).not.toContain('readme.md');
  });

  it('collapsing a folder logs only that node', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByLabelText(/Expand Documents/));
    clearLogs();

    await user.click(screen.getByLabelText(/Collapse Documents/));

    const loggedNames = treeLogs().map((args) => args[1]);
    expect(loggedNames).toEqual(['Documents']);
  });

  it('selecting a file logs only the previously and newly selected nodes', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByText('readme.md')); // select first
    clearLogs();

    await user.click(screen.getByLabelText(/Expand Documents/));
    clearLogs();
    await user.click(screen.getByText('Resume.pdf'));

    const loggedNames = treeLogs().map((args) => args[1]);
    // previously selected (readme.md) and newly selected (Resume.pdf)
    expect(loggedNames).toContain('readme.md');
    expect(loggedNames).toContain('Resume.pdf');
    expect(loggedNames).not.toContain('Pictures');
    expect(loggedNames).not.toContain('Music');
  });

  it('creating an item re-renders the new node, its parent, and ancestors', async () => {
    const user = userEvent.setup();
    renderApp();
    clearLogs();

    await user.click(screen.getByTestId('new-folder'));
    const input = await screen.findByTestId('name-input');
    await user.type(input, 'Logs');
    clearLogs();
    await user.click(screen.getByTestId('name-submit'));

    const loggedNames = treeLogs().map((args) => args[1]);
    expect(loggedNames).toContain('Logs'); // the new node mounts
    expect(loggedNames).toContain('My Files'); // parent (root) re-renders
    // unchanged siblings keep their references (structural sharing)
    // note: Documents etc. may re-render if root's children array changed
    // identity propagates — but with structural sharing only the parent
    // chain gets new references. Sibling subtree *tree objects* are reused,
    // so React.memo skips them unless their subtree identity changed.
    expect(loggedNames).not.toContain('Resume.pdf');
    expect(loggedNames).not.toContain('song.mp3');
  });
});
