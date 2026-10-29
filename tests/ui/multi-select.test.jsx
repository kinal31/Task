import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from './helpers/renderApp.jsx';
import { FileExplorerError } from '../../src/sdk/errors.js';

function getCheckboxByText(name) {
  const nameEl = screen.getByText(name, { selector: '.tree-name' });
  const row = nameEl.closest('.tree-row');
  return row.querySelector('.tree-checkbox');
}

describe('multi-select and bulk delete', () => {
  it('checks items and shows the count', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(getCheckboxByText('Documents'));
    await user.click(getCheckboxByText('Pictures'));

    expect(screen.getByTestId('bulk-count')).toHaveTextContent('2 selected');
    expect(screen.getByTestId('bulk-delete')).toBeEnabled();
  });

  it('bulk-deletes selected items and clears the selection', async () => {
    const user = userEvent.setup();
    const { sdk } = renderApp();

    await user.click(getCheckboxByText('Documents'));
    await user.click(getCheckboxByText('Music'));
    expect(screen.getByTestId('bulk-count')).toHaveTextContent('2 selected');

    await user.click(screen.getByTestId('bulk-delete'));

    expect(
      await screen.findByText('Pictures', { selector: '.tree-name' })
    ).toBeInTheDocument();
    expect(screen.queryByText('Documents', { selector: '.tree-name' })).not.toBeInTheDocument();
    expect(screen.queryByText('Music', { selector: '.tree-name' })).not.toBeInTheDocument();
    expect(screen.getByTestId('bulk-count')).toHaveTextContent('0 selected');
    expect(sdk.canUndo()).toBe(true);
  });

  it('one undo restores everything deleted in a bulk delete', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(getCheckboxByText('Documents'));
    await user.click(getCheckboxByText('Music'));
    await user.click(screen.getByTestId('bulk-delete'));
    expect(screen.queryByText('Documents', { selector: '.tree-name' })).not.toBeInTheDocument();

    await user.click(screen.getByTestId('undo'));
    expect(await screen.findByText('Documents', { selector: '.tree-name' })).toBeInTheDocument();
    expect(screen.getByText('Music', { selector: '.tree-name' })).toBeInTheDocument();

    await user.click(screen.getByLabelText(/Expand Documents/));
    expect(screen.getByText('Resume.pdf', { selector: '.tree-name' })).toBeInTheDocument();
  });

  it('filters out descendants of selected folders so the transaction succeeds', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByLabelText(/Expand Documents/));
    await user.click(getCheckboxByText('Documents'));
    await user.click(getCheckboxByText('Resume.pdf'));
    expect(screen.getByTestId('bulk-count')).toHaveTextContent('2 selected');

    await user.click(screen.getByTestId('bulk-delete'));

    expect(screen.queryByText('Documents', { selector: '.tree-name' })).not.toBeInTheDocument();
    expect(screen.queryByText('Resume.pdf', { selector: '.tree-name' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('error-banner')).not.toBeInTheDocument();
  });

  it('keeps the selection and shows an error on a failed bulk delete', async () => {
    const user = userEvent.setup();
    const { sdk } = renderApp();

    await user.click(getCheckboxByText('Documents'));
    await user.click(getCheckboxByText('Music'));
    expect(screen.getByTestId('bulk-count')).toHaveTextContent('2 selected');

    // Force a failure: mock transaction to throw (UI-level failure test;
    // rollback semantics are covered thoroughly in the SDK suite).
    vi.spyOn(sdk, 'transaction').mockImplementation(() => {
      throw new FileExplorerError('TRANSACTION_ERROR', 'forced failure');
    });

    await user.click(screen.getByTestId('bulk-delete'));

    expect(await screen.findByTestId('error-banner')).toBeInTheDocument();
    // selection is NOT cleared on failure
    expect(screen.getByTestId('bulk-count')).toHaveTextContent('2 selected');

    vi.restoreAllMocks();
  });

  it('clears the multi-selection via the Clear selection link', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(getCheckboxByText('Documents'));
    expect(screen.getByTestId('bulk-count')).toHaveTextContent('1 selected');

    await user.click(screen.getByTestId('clear-checked'));
    expect(screen.getByTestId('bulk-count')).toHaveTextContent('0 selected');
  });

  it('Ctrl-click toggles the checkbox', async () => {
    const user = userEvent.setup();
    renderApp();

    const row = screen.getByText('Documents', { selector: '.tree-name' }).closest('.tree-row');

    await user.keyboard('{Control>}');
    await user.click(row);
    await user.keyboard('{/Control}');
    expect(screen.getByTestId('bulk-count')).toHaveTextContent('1 selected');

    await user.keyboard('{Control>}');
    await user.click(row);
    await user.keyboard('{/Control}');
    expect(screen.getByTestId('bulk-count')).toHaveTextContent('0 selected');
  });

  it('the root cannot be checked', () => {
    renderApp();
    expect(screen.queryByLabelText(/Select My Files/)).not.toBeInTheDocument();
  });
});
