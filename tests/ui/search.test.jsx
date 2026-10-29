import { describe, it, expect } from 'vitest';
import { screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from './helpers/renderApp.jsx';

describe('search', () => {
  it('displays each result\'s name, type, and location (nested)', async () => {
    const user = userEvent.setup();
    const { sdk } = renderApp();

    await user.type(screen.getByTestId('search-input'), 'resume');

    expect(await screen.findByText('Resume.pdf')).toBeInTheDocument();
    expect(screen.getByText(/My Files \/ Documents/)).toBeInTheDocument();
    // explicit type label, not just the icon
    const resultId = sdk.search('resume').items[0].id;
    expect(screen.getByTestId(`search-type-${resultId}`)).toHaveTextContent('file');
  });

  it('filters by type', async () => {
    const user = userEvent.setup();
    const { sdk } = renderApp();

    await user.type(screen.getByTestId('search-input'), 'doc');
    await screen.findByTestId('search-results');

    // "doc" matches Report.docx (file) and Documents (folder)
    const all = sdk.search('doc');
    expect(all.total).toBeGreaterThanOrEqual(2);

    await user.selectOptions(screen.getByTestId('search-type'), 'file');
    expect(await screen.findByText('Report.docx')).toBeInTheDocument();
    // Documents folder should not be in results under type=file
    const fileResults = sdk.search('doc', { type: 'file' });
    expect(fileResults.items.every((i) => i.type === 'file')).toBe(true);
    expect(fileResults.items.some((i) => i.name === 'Documents')).toBe(false);
  });

  it('changes order when sort order changes', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.type(screen.getByTestId('search-input'), 'e');
    await screen.findByTestId('search-results');

    const firstNameAsc = getFirstName();
    await user.selectOptions(screen.getByTestId('search-order'), 'desc');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    const firstNameDesc = getFirstName();
    expect(firstNameAsc).not.toBe(firstNameDesc);
  });

  it('paginates results', async () => {
    const user = userEvent.setup();
    const { sdk } = renderApp();

    // confirm there are enough matches to paginate
    const total = sdk.search('e').total;
    expect(total).toBeGreaterThan(5);

    await user.selectOptions(screen.getByTestId('search-page-size'), '5');
    await user.type(screen.getByTestId('search-input'), 'e');

    expect(await screen.findByTestId('pagination')).toBeInTheDocument();
    expect(screen.getByTestId('page-info')).toHaveTextContent(/Page 1 of/);

    await user.click(screen.getByTestId('page-next'));
    expect(await screen.findByText(/Page 2 of/)).toBeInTheDocument();
  });

  it('updates results after an item is renamed', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.type(screen.getByTestId('search-input'), 'readme');
    expect(await screen.findByText('readme.md')).toBeInTheDocument();

    // rename readme.md -> changelog.md through the UI
    await user.click(screen.getByText('readme.md', { selector: '.tree-name' }));
    await user.click(screen.getByTestId('rename'));
    const input = await screen.findByTestId('name-input');
    await user.clear(input);
    await user.type(input, 'changelog.md');
    await user.click(screen.getByTestId('name-submit'));

    // after debounce the search re-runs; "readme" no longer matches
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(await screen.findByText('No matches.')).toBeInTheDocument();
  });

  it('SDK throws INVALID_OPTIONS for a bad type filter (UI uses valid selects)', async () => {
    const { sdk } = renderApp();

    let thrown = null;
    act(() => {
      try {
        sdk.search('x', { type: 'bogus' });
      } catch (e) {
        thrown = e;
      }
    });
    expect(thrown).toBeTruthy();
    expect(thrown.code).toBe('INVALID_OPTIONS');

    // UI still renders (no crash from the initial empty search)
    expect(screen.getByTestId('search-panel')).toBeInTheDocument();
  });

  it('shows "Type to search" for an empty query', () => {
    renderApp();
    expect(screen.getByText('Type to search.')).toBeInTheDocument();
  });

  it('selecting a result selects the item and expands ancestors', async () => {
    const user = userEvent.setup();
    const { uiStore, sdk } = renderApp();

    await user.type(screen.getByTestId('search-input'), 'report');
    const result = await screen.findByText('Report.docx');
    await user.click(result);

    const reportId = sdk
      .search('report')
      .items.find((i) => i.name === 'Report.docx').id;
    expect(uiStore.getState().selectedId).toBe(reportId);

    const path = sdk.getPath(reportId);
    for (const ancestorId of path.ids.slice(0, -1)) {
      expect(uiStore.getState().expandedIds.has(ancestorId)).toBe(true);
    }
  });
});

function getFirstName() {
  const items = [...document.querySelectorAll('.search-item-name')];
  return items[0]?.textContent;
}
