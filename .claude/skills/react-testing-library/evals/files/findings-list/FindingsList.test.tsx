import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { FindingsList } from './FindingsList';
import { useFindings } from './useFindings';

vi.mock('./useFindings', () => ({
  useFindings: vi.fn(),
}));

const mockedUseFindings = vi.mocked(useFindings);

// Module-level array that several tests below push into and never reset.
const sharedFindings: { id: string; severity: 'high' | 'medium' | 'low'; title: string }[] = [];

describe('FindingsList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders findings from the hook', () => {
    mockedUseFindings.mockReturnValue({
      findings: [
        { id: '1', severity: 'high', title: 'SQL injection risk' },
        { id: '2', severity: 'low', title: 'Missing return type' },
      ],
      isLoading: false,
      error: null,
    });

    render(<FindingsList workspaceId="ws-1" prId="pr-1" />);

    const list = screen.getByRole('list', { name: /findings/i });
    expect(within(list).getByText('SQL injection risk')).toBeInTheDocument();
    expect(within(list).getByText('Missing return type')).toBeInTheDocument();
  });

  it('shows the loading state before findings resolve', () => {
    mockedUseFindings.mockReturnValue({ findings: [], isLoading: true, error: null });

    render(<FindingsList workspaceId="ws-1" prId="pr-1" />);

    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
  });

  it('shows an error message when the hook reports a fetch failure', () => {
    // Mocks fetch directly instead of mocking the hook (already mocked above)
    // or using MSW at the network layer.
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    mockedUseFindings.mockReturnValue({ findings: [], isLoading: false, error: 'failed' });

    const { container } = render(<FindingsList workspaceId="ws-1" prId="pr-1" />);

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe('Could not load findings');
  });

  it('accumulates findings across renders', () => {
    sharedFindings.push({ id: '3', severity: 'medium', title: 'Unused import' });
    mockedUseFindings.mockReturnValue({ findings: sharedFindings, isLoading: false, error: null });

    render(<FindingsList workspaceId="ws-1" prId="pr-1" />);

    expect(screen.getByText('Unused import')).toBeInTheDocument();
  });

  it('renders the empty state message', () => {
    mockedUseFindings.mockReturnValue({ findings: [], isLoading: false, error: null });

    render(<FindingsList workspaceId="ws-1" prId="pr-1" />);

    expect(screen.getByTestId('findings-empty')).toHaveTextContent(/no findings/i);
  });
});
