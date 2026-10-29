import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from './helpers/renderApp.jsx';

const inTree = (name) => screen.getByText(name, { selector: '.tree-name' });
const queryInTree = (name) =>
  screen.queryByText(name, { selector: '.tree-name' });

describe('selection consistency', () => {
  it('clears selection after deleting the selected item', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByText('readme.md', { selector: '.tree-name' }));
    expect(screen.getByTestId('details-name')).toHaveTextContent('readme.md');

    await user.click(screen.getByTestId('delete'));

    expect(await screen.findByText(/Select an item to see its details/)).toBeInTheDocument();
  });

  it('restores the item after undo of delete; selection is empty (pruned)', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByText('readme.md', { selector: '.tree-name' }));
    await user.click(screen.getByTestId('delete'));
    await screen.findByText(/Select an item to see its details/);

    await user.click(screen.getByTestId('undo'));
    expect(await screen.findByText('readme.md', { selector: '.tree-name' })).toBeInTheDocument();
    expect(screen.getByText(/Select an item to see its details/)).toBeInTheDocument();
  });

  it('prunes expanded state for a deleted folder', async () => {
    const user = userEvent.setup();
    const { sdk, uiStore } = renderApp();

    await user.click(screen.getByLabelText(/Expand Documents/));
    const docsId = [...sdk.getSnapshot().children].find(
      (c) => c.name === 'Documents'
    ).id;
    expect(uiStore.getState().expandedIds.has(docsId)).toBe(true);

    await user.click(screen.getByText('Documents', { selector: '.tree-name' }));
    await user.click(screen.getByTestId('delete'));

    expect(uiStore.getState().expandedIds.has(docsId)).toBe(false);
    expect(uiStore.getState().selectedId).toBe(null);
  });

  it('keeps selection and expansion on rename', async () => {
    const user = userEvent.setup();
    const { uiStore } = renderApp();

    await user.click(screen.getByLabelText(/Expand Documents/));
    await user.click(screen.getByText('Resume.pdf', { selector: '.tree-name' }));
    const selectedBefore = uiStore.getState().selectedId;
    const docsId = [...uiStore.getState().expandedIds][0]; // root or Documents

    await user.click(screen.getByTestId('rename'));
    const input = await screen.findByTestId('name-input');
    await user.clear(input);
    await user.type(input, 'CV.pdf');
    await user.click(screen.getByTestId('name-submit'));

    expect(await screen.findByText('CV.pdf', { selector: '.tree-name' })).toBeInTheDocument();
    expect(uiStore.getState().selectedId).toBe(selectedBefore);
    expect(uiStore.getState().expandedIds.has(docsId)).toBe(true);
  });

  it('clears selection when a parent of the selected item is deleted', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByLabelText(/Expand Documents/));
    await user.click(screen.getByText('Resume.pdf', { selector: '.tree-name' }));
    expect(screen.getByTestId('details-name')).toHaveTextContent('Resume.pdf');

    // delete Documents (parent of Resume.pdf)
    await user.click(screen.getByText('Documents', { selector: '.tree-name' }));
    await user.click(screen.getByTestId('delete'));

    expect(await screen.findByText(/Select an item to see its details/)).toBeInTheDocument();
  });

  it('restored folder comes back collapsed after undo of delete', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByLabelText(/Expand Documents/));
    await user.click(screen.getByText('Documents', { selector: '.tree-name' }));
    await user.click(screen.getByTestId('delete'));
    await user.click(screen.getByTestId('undo'));

    expect(await screen.findByText('Documents', { selector: '.tree-name' })).toBeInTheDocument();
    // Documents was pruned from expanded while deleted, so it returns collapsed
    expect(screen.queryByText('Resume.pdf', { selector: '.tree-name' })).not.toBeInTheDocument();
  });

  it('keeps expanded state after a move', async () => {
    const user = userEvent.setup();
    const { sdk, uiStore } = renderApp();

    await user.click(screen.getByLabelText(/Expand Documents/));
    const docsId = [...sdk.getSnapshot().children].find(
      (c) => c.name === 'Documents'
    ).id;

    await user.click(screen.getByText('Music', { selector: '.tree-name' }));
    await user.click(screen.getByTestId('move'));
    const select = await screen.findByTestId('move-target');
    const docsOption = [...select.options].find((o) => o.label.includes('Documents'));
    await user.selectOptions(select, docsOption.value);
    await user.click(screen.getByTestId('move-submit'));

    expect(uiStore.getState().expandedIds.has(docsId)).toBe(true);
    // Music is now under Documents
    expect(inTree('Music')).toBeInTheDocument();
  });
});
