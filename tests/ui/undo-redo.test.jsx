import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from './helpers/renderApp.jsx';

describe('undo/redo UI', () => {
  it('disables undo/redo initially', () => {
    renderApp();
    expect(screen.getByTestId('undo')).toBeDisabled();
    expect(screen.getByTestId('redo')).toBeDisabled();
  });

  it('enables undo after an action and redo after undo', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByTestId('new-folder'));
    const input = await screen.findByTestId('name-input');
    await user.type(input, 'Temp');
    await user.click(screen.getByTestId('name-submit'));
    await screen.findByText('Temp', { selector: '.tree-name' });

    expect(screen.getByTestId('undo')).toBeEnabled();
    expect(screen.getByTestId('redo')).toBeDisabled();

    await user.click(screen.getByTestId('undo'));
    expect(screen.queryByText('Temp', { selector: '.tree-name' })).not.toBeInTheDocument();
    expect(screen.getByTestId('redo')).toBeEnabled();

    await user.click(screen.getByTestId('redo'));
    expect(await screen.findByText('Temp', { selector: '.tree-name' })).toBeInTheDocument();
    expect(screen.getByTestId('undo')).toBeEnabled();
  });

  it('shows the action label in the undo tooltip', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByTestId('new-folder'));
    const input = await screen.findByTestId('name-input');
    await user.type(input, 'Temp');
    await user.click(screen.getByTestId('name-submit'));
    await screen.findByText('Temp', { selector: '.tree-name' });

    expect(screen.getByTestId('undo')).toHaveAttribute(
      'title',
      expect.stringContaining('Undo: Create folder "Temp"')
    );
  });

  it('clears the redo stack when a new action is performed', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByTestId('new-folder'));
    let input = await screen.findByTestId('name-input');
    await user.type(input, 'ItemA');
    await user.click(screen.getByTestId('name-submit'));
    await screen.findByText('ItemA', { selector: '.tree-name' });

    await user.click(screen.getByTestId('undo'));
    expect(screen.getByTestId('redo')).toBeEnabled();

    await user.click(screen.getByTestId('new-folder'));
    input = await screen.findByTestId('name-input');
    await user.type(input, 'ItemB');
    await user.click(screen.getByTestId('name-submit'));
    await screen.findByText('ItemB', { selector: '.tree-name' });

    expect(screen.getByTestId('redo')).toBeDisabled();
  });

  it('undo of delete restores the nested subtree', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByText('Documents', { selector: '.tree-name' }));
    await user.click(screen.getByTestId('delete'));
    expect(screen.queryByText('Documents', { selector: '.tree-name' })).not.toBeInTheDocument();

    await user.click(screen.getByTestId('undo'));
    expect(await screen.findByText('Documents', { selector: '.tree-name' })).toBeInTheDocument();

    // expand and verify nested content came back
    await user.click(screen.getByLabelText(/Expand Documents/));
    expect(screen.getByText('Resume.pdf', { selector: '.tree-name' })).toBeInTheDocument();
    await user.click(screen.getByLabelText(/Expand Work/));
    expect(screen.getByText('Report.docx', { selector: '.tree-name' })).toBeInTheDocument();
  });
});
