import { describe, expect, it, vi } from 'vitest';
import { retry } from './retry';

const noSleep = () => Promise.resolve();

describe('retry', () => {
  it('returns the result on the first success without sleeping', async () => {
    const sleep = vi.fn(noSleep);
    const action = vi.fn().mockResolvedValue('ok');
    await expect(retry(action, 5, 100, sleep)).resolves.toBe('ok');
    expect(action).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('keeps trying until it succeeds', async () => {
    const sleep = vi.fn(noSleep);
    const action = vi
      .fn()
      .mockRejectedValueOnce(new Error('dragging'))
      .mockRejectedValueOnce(new Error('dragging'))
      .mockResolvedValue('done');
    await expect(retry(action, 5, 100, sleep)).resolves.toBe('done');
    expect(action).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(100);
  });

  it('rethrows the last error after the attempts run out', async () => {
    const action = vi.fn().mockRejectedValue(new Error('still dragging'));
    await expect(retry(action, 3, 10, noSleep)).rejects.toThrow('still dragging');
    expect(action).toHaveBeenCalledTimes(3);
  });

  it('does not sleep after the final failed attempt', async () => {
    const sleep = vi.fn(noSleep);
    const action = vi.fn().mockRejectedValue(new Error('x'));
    await retry(action, 3, 10, sleep).catch(() => {});
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});
