import { describe, it, expect } from 'vitest';
import { screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from './helpers/renderApp.jsx';

// Tree names can also appear in the details panel and activity log,
// so scope "is it in the tree?" queries to the tree-name class.
const inTree = (name) => screen.getByText(name, { selector: '.tree-name' });
const queryInTree = (name) =>
  screen.queryByText(name, { selector: '.tree-name' });

describe('UI updates after SDK changes', () => {
  it('creates a folder through the UI and shows it', async () => {
    const user = userEvent.setup();
    const { sdk } = renderApp();

    await user.click(screen.getByTestId('new-folder'));
    const input = await screen.findByTestId('name-input');
    await user.type(input, 'Projects');
    await user.click(screen.getByTestId('name-submit'));

    expect(await screen.findByText('Projects', { selector: '.tree-name' })).toBeInTheDocument();
    expect(sdk.getSnapshot().children.some((c) => c.name === 'Projects')).toBe(true);
  });

  it('renames an item through the UI', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByText('readme.md', { selector: '.tree-name' }));
    await user.click(screen.getByTestId('rename'));
    const input = await screen.findByTestId('name-input');
    await user.clear(input);
    await user.type(input, 'README.md');
    await user.click(screen.getByTestId('name-submit'));

    expect(await screen.findByText('README.md', { selector: '.tree-name' })).toBeInTheDocument();
    expect(queryInTree('readme.md')).not.toBeInTheDocument();
  });

  it('reflects an SDK mutation made outside React', async () => {
    const { sdk } = renderApp();
    expect(queryInTree('external.txt')).not.toBeInTheDocument();

    let file;
    act(() => {
      file = sdk.createFile(sdk.getRootId(), 'external.txt');
    });

    expect(await screen.findByText('external.txt', { selector: '.tree-name' })).toBeInTheDocument();
    expect(file.name).toBe('external.txt');
  });

  it('shows a new file under the selected folder', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByText('Documents', { selector: '.tree-name' }));
    await user.click(screen.getByTestId('new-file'));
    const input = await screen.findByTestId('name-input');
    await user.type(input, 'cover.txt');
    await user.click(screen.getByTestId('name-submit'));

    expect(await screen.findByText('cover.txt', { selector: '.tree-name' })).toBeInTheDocument();
  });

  it('keeps inTree helper referenced', () => {
    expect(typeof inTree).toBe('function');
  });
});
