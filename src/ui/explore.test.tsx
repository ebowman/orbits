// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ExplorePage from './pages/ExplorePage';

afterEach(cleanup);

describe('ExplorePage', () => {
  it('renders controls without running', () => {
    render(<ExplorePage />);
    expect(screen.getByRole('heading', { name: 'Explore sensitivity' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Run sweep' })).toBeTruthy();
    expect(screen.queryAllByTestId('heatmap')).toHaveLength(0);
  });

  it('runs a tiny sweep through the main-thread fallback and shows heatmaps, legend, labels', async () => {
    render(<ExplorePage />);
    fireEvent.change(screen.getByLabelText('Spacings'), { target: { value: '10, 20' } });
    fireEvent.change(screen.getByLabelText('Noise'), { target: { value: '0, 2' } });
    fireEvent.change(screen.getByLabelText('Trials'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run sweep' }));
    await waitFor(() => expect(screen.getAllByTestId('heatmap')).toHaveLength(2), { timeout: 20000 });
    expect(screen.getAllByTestId('heat-cell')).toHaveLength(8);
    expect(screen.getByTestId('legend')).toBeTruthy();
    expect(screen.getAllByText('spacing (days)')).toHaveLength(2);
    expect(screen.getAllByText('noise sigma (arcsec per coordinate)')).toHaveLength(2);
    expect(screen.getByTestId('linechart')).toBeTruthy();
    expect(screen.getByText('What to look for')).toBeTruthy();
  }, 30000);

  it('rejects out-of-range trials', () => {
    render(<ExplorePage />);
    fireEvent.change(screen.getByLabelText('Trials'), { target: { value: '51' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run sweep' }));
    expect(screen.getByRole('alert').textContent).toMatch(/Trials/);
  });
});
