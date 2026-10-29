import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from './helpers/renderApp.jsx';

describe('rendering', () => {
  it('shows the root and its children', () => {
    renderApp();
    expect(screen.getByTestId('file-tree')).toBeInTheDocument();
    expect(screen.getByText('My Files')).toBeInTheDocument();
    expect(screen.getByText('Documents')).toBeInTheDocument();
    expect(screen.getByText('Pictures')).toBeInTheDocument();
    expect(screen.getByText('Music')).toBeInTheDocument();
    expect(screen.getByText('readme.md')).toBeInTheDocument();
  });

  it('hides children of collapsed folders', () => {
    renderApp();
    expect(screen.queryByText('Resume.pdf')).not.toBeInTheDocument();
    expect(screen.queryByText('vacation.jpg')).not.toBeInTheDocument();
  });

  it('expands a folder and shows its children', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByLabelText(/Expand Documents/));
    expect(screen.getByText('Resume.pdf')).toBeInTheDocument();
    expect(screen.getByText('Notes.txt')).toBeInTheDocument();
    // nested folder still collapsed
    expect(screen.queryByText('Report.docx')).not.toBeInTheDocument();
  });

  it('collapses an expanded folder', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByLabelText(/Expand Documents/));
    expect(screen.getByText('Resume.pdf')).toBeInTheDocument();
    await user.click(screen.getByLabelText(/Collapse Documents/));
    expect(screen.queryByText('Resume.pdf')).not.toBeInTheDocument();
  });

  it('selects a file and shows it in the details panel', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByLabelText(/Expand Documents/));
    await user.click(screen.getByText('Resume.pdf'));
    expect(screen.getByTestId('details-name')).toHaveTextContent('Resume.pdf');
    expect(screen.getByTestId('details-type')).toHaveTextContent('file');
    expect(screen.getByTestId('details-path')).toHaveTextContent(
      'My Files / Documents / Resume.pdf'
    );
  });

  it('shows a placeholder when nothing is selected', () => {
    renderApp();
    expect(screen.getByText(/Select an item to see its details/)).toBeInTheDocument();
  });
});
