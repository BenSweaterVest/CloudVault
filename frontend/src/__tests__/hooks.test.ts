import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { formatClearTime, useClipboard } from '../hooks/useClipboard';
import { useSessionTimeout } from '../hooks/useSessionTimeout';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useClipboard', () => {
  it('copies and clears after the delay if the clipboard is unchanged', async () => {
    const { result } = renderHook(() => useClipboard({ clearAfterSeconds: 30 }));
    vi.mocked(navigator.clipboard.readText).mockResolvedValue('secret');

    await act(async () => {
      expect(await result.current.copy('secret', 'pw')).toBe(true);
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('secret');
    expect(result.current.copiedKey).toBe('pw');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('');
  });

  it('leaves newer clipboard contents alone', async () => {
    const { result } = renderHook(() => useClipboard({ clearAfterSeconds: 5 }));
    vi.mocked(navigator.clipboard.readText).mockResolvedValue('something else');
    await act(async () => {
      await result.current.copy('secret');
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(navigator.clipboard.writeText).not.toHaveBeenCalledWith('');
  });

  it('clears anyway when the clipboard cannot be read', async () => {
    const { result } = renderHook(() => useClipboard({ clearAfterSeconds: 5 }));
    vi.mocked(navigator.clipboard.readText).mockRejectedValue(new Error('denied'));
    await act(async () => {
      await result.current.copy('secret');
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('');
  });

  it('formats clear times', () => {
    expect(formatClearTime(0)).toBe('');
    expect(formatClearTime(30)).toBe('30s');
    expect(formatClearTime(90)).toBe('1m 30s');
  });
});

describe('useSessionTimeout', () => {
  it('fires after inactivity and resets on activity', () => {
    const onTimeout = vi.fn();
    renderHook(() => useSessionTimeout({ timeoutMinutes: 1, onTimeout }));

    act(() => vi.advanceTimersByTime(50_000));
    act(() => {
      document.dispatchEvent(new Event('keydown'));
    });
    act(() => vi.advanceTimersByTime(50_000));
    expect(onTimeout).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(11_000));
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('does nothing when disabled or set to never', () => {
    const onTimeout = vi.fn();
    renderHook(() => useSessionTimeout({ timeoutMinutes: 0, onTimeout }));
    renderHook(() => useSessionTimeout({ timeoutMinutes: 1, onTimeout, enabled: false }));
    act(() => vi.advanceTimersByTime(10 * 60_000));
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
