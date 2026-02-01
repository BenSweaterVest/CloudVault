/**
 * Custom Hooks Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useClipboard, formatClearTime } from '../hooks/useClipboard';

describe('useClipboard Hook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Reset clipboard mock
    Object.defineProperty(navigator, 'clipboard', {
      writable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
        readText: vi.fn().mockResolvedValue(''),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should copy text to clipboard', async () => {
    const { result } = renderHook(() => useClipboard());

    await act(async () => {
      await result.current.copy('test text');
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('test text');
    expect(result.current.copied).toBe(true);
  });

  it('should reset copied state after 2 seconds', async () => {
    const { result } = renderHook(() => useClipboard());

    await act(async () => {
      await result.current.copy('test text');
    });

    expect(result.current.copied).toBe(true);

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(result.current.copied).toBe(false);
  });

  it('should auto-clear clipboard after specified time', async () => {
    const onClear = vi.fn();
    const { result } = renderHook(() =>
      useClipboard({ clearAfterSeconds: 30, onClear })
    );

    (navigator.clipboard.readText as ReturnType<typeof vi.fn>).mockResolvedValue('test text');

    await act(async () => {
      await result.current.copy('test text');
    });

    act(() => {
      vi.advanceTimersByTime(30000);
    });

    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('');
    expect(onClear).toHaveBeenCalled();
  });

  it('should not auto-clear when disabled', async () => {
    const { result } = renderHook(() =>
      useClipboard({ clearAfterSeconds: 0 })
    );

    await act(async () => {
      await result.current.copy('test text');
    });

    act(() => {
      vi.advanceTimersByTime(60000);
    });

    // writeText should only be called once (for the copy)
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
  });

  it('should call onCopy callback', async () => {
    const onCopy = vi.fn();
    const { result } = renderHook(() => useClipboard({ onCopy }));

    await act(async () => {
      await result.current.copy('test text');
    });

    expect(onCopy).toHaveBeenCalled();
  });
});

describe('formatClearTime', () => {
  it('should return empty string for 0 or negative', () => {
    expect(formatClearTime(0)).toBe('');
    expect(formatClearTime(-5)).toBe('');
  });

  it('should format seconds', () => {
    expect(formatClearTime(30)).toBe('30s');
    expect(formatClearTime(5)).toBe('5s');
  });

  it('should format minutes', () => {
    expect(formatClearTime(60)).toBe('1m');
    expect(formatClearTime(120)).toBe('2m');
  });

  it('should format minutes and seconds', () => {
    expect(formatClearTime(90)).toBe('1m 30s');
    expect(formatClearTime(150)).toBe('2m 30s');
  });
});
