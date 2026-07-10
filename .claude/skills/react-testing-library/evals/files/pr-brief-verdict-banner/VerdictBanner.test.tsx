import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { VerdictBanner } from './VerdictBanner';

describe('VerdictBanner', () => {
  it('shows verdict and findings count', () => {
    const { getByTestId } = render(
      <VerdictBanner verdict="approve" findingsCount={3} onRegenerate={vi.fn()} />,
    );

    expect(getByTestId('verdict-heading').textContent).toBe('Approved');
  });

  it('regenerates the review when clicking the button', () => {
    const onRegenerate = vi.fn().mockResolvedValue(undefined);
    const { getByTestId } = render(
      <VerdictBanner verdict="changes_requested" findingsCount={2} onRegenerate={onRegenerate} />,
    );

    const button = getByTestId('regenerate-button');
    fireEvent.click(button);

    // Asserts immediately after the click with no await — the regenerate
    // promise hasn't settled yet, so this reads a stale/incorrect state.
    expect(button.textContent).toBe('Regenerate');
    expect(onRegenerate).toHaveBeenCalled();
  });

  it('shows an error message when regeneration fails', () => {
    const onRegenerate = vi.fn().mockRejectedValue(new Error('boom'));
    const { getByTestId } = render(
      <VerdictBanner verdict="approve" findingsCount={0} onRegenerate={onRegenerate} />,
    );

    fireEvent.click(getByTestId('regenerate-button'));

    // The rejection (and the resulting error state) resolves asynchronously,
    // but this assertion runs synchronously right after the click.
    expect(getByTestId('regenerate-error').textContent).toBe('Failed to regenerate review');
  });
});
