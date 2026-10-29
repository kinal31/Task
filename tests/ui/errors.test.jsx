import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from './helpers/renderApp.jsx';

describe('error handling', () => {
  it('shows a friendly message on duplicate name', async () => {
    const user = userEvent.setup();
    const { sdk } = renderApp();

    await user.click(screen.getByTestId('new-folder'));
    const input = await screen.findByTestId('name-input');
    await user.type(input, 'Documents');
    await user.click(screen.getByTestId('name-submit'));

    const banner = await screen.findByTestId('error-banner');
    expect(banner).toHaveTextContent(
      'An item with this name already exists in this folder.'
    );

    // tree unchanged: still exactly one Documents
    const names = sdk
      .getSnapshot()
      .children.filter((c) => c.name === 'Documents');
    expect(names).toHaveLength(1);
  });

  it('dismisses the error banner', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByTestId('new-folder'));
    const input = await screen.findByTestId('name-input');
    await user.type(input, 'Documents');
    await user.click(screen.getByTestId('name-submit'));

    await screen.findByTestId('error-banner');
    await user.click(screen.getByTestId('dismiss-error'));
    expect(screen.queryByTestId('error-banner')).not.toBeInTheDocument();
  });

  it('does not add an activity entry for a failed action', async () => {
    const user = userEvent.setup();
    const { sdk } = renderApp();
    const before = sdk.getActivityLog().length;

    await user.click(screen.getByTestId('new-folder'));
    const input = await screen.findByTestId('name-input');
    await user.type(input, 'Documents');
    await user.click(screen.getByTestId('name-submit'));

    await screen.findByTestId('error-banner');
    expect(sdk.getActivityLog().length).toBe(before);
  });

  it('keeps the dialog open on failure so the name can be fixed', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByTestId('new-folder'));
    const input = await screen.findByTestId('name-input');
    await user.type(input, 'Documents');
    await user.click(screen.getByTestId('name-submit'));

    await screen.findByTestId('error-banner');
    expect(screen.getByTestId('name-dialog')).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, 'Docs');
    await user.click(screen.getByTestId('name-submit'));
    expect(
      await screen.findByText('Docs', { selector: '.tree-name' })
    ).toBeInTheDocument();
    expect(screen.queryByTestId('name-dialog')).not.toBeInTheDocument();
  });

  it('rejects an empty name locally without calling the SDK', async () => {
    const user = userEvent.setup();
    const { sdk } = renderApp();
    const before = sdk.getVersion();

    await user.click(screen.getByTestId('new-folder'));
    await screen.findByTestId('name-input');
    // submit stays disabled for empty input
    expect(screen.getByTestId('name-submit')).toBeDisabled();

    await user.click(screen.getByTestId('name-cancel'));
    expect(sdk.getVersion()).toBe(before);
  });
});
