import { describe, expect, it } from 'vitest';
import {
  decideLockAction,
  MAX_END_AHEAD_MS,
  recordRevert,
  STALE_AFTER_MS,
  type Timers,
} from './lock';

const NOW = 1_000_000_000;
const running: Timers = { '10': { end: NOW + 300_000, windowId: 1 } };

describe('decideLockAction', () => {
  it('ignores everything when there are no timers', () => {
    expect(decideLockAction({}, { tabId: 5, windowId: 1 }, NOW)).toEqual({ action: 'ignore' });
  });

  it('reverts a switch to another tab in the same window', () => {
    expect(decideLockAction(running, { tabId: 5, windowId: 1 }, NOW)).toEqual({
      action: 'revert',
      timerTabId: 10,
    });
  });

  it('ignores activation of the timed tab itself (no revert loop)', () => {
    expect(decideLockAction(running, { tabId: 10, windowId: 1 }, NOW)).toEqual({ action: 'ignore' });
  });

  it('ignores tab switches in a different window', () => {
    expect(decideLockAction(running, { tabId: 5, windowId: 2 }, NOW)).toEqual({ action: 'ignore' });
  });

  it('ignores a timer whose lock was released', () => {
    const t: Timers = { '10': { end: NOW + 300_000, windowId: 1, lockOff: true } };
    expect(decideLockAction(t, { tabId: 5, windowId: 1 }, NOW)).toEqual({ action: 'ignore' });
  });

  it('fails open on a legacy record with no windowId', () => {
    const t: Timers = { '10': { end: NOW + 300_000 } };
    expect(decideLockAction(t, { tabId: 5, windowId: 1 }, NOW)).toEqual({ action: 'ignore' });
  });

  it('releases on a corrupt end time', () => {
    const t: Timers = { '10': { end: Number.NaN, windowId: 1 } };
    expect(decideLockAction(t, { tabId: 5, windowId: 1 }, NOW)).toMatchObject({
      action: 'release',
      timerTabId: 10,
    });
  });

  it('releases on an end time impossibly far in the future', () => {
    const t: Timers = { '10': { end: NOW + MAX_END_AHEAD_MS + 1, windowId: 1 } };
    expect(decideLockAction(t, { tabId: 5, windowId: 1 }, NOW).action).toBe('release');
  });

  it('releases on a stale record whose alarm never cleaned it up', () => {
    const t: Timers = { '10': { end: NOW - STALE_AFTER_MS - 1, windowId: 1 } };
    expect(decideLockAction(t, { tabId: 5, windowId: 1 }, NOW).action).toBe('release');
  });

  it('does not treat a just-expired timer as stale', () => {
    const t: Timers = { '10': { end: NOW - 1_000, windowId: 1 } };
    expect(decideLockAction(t, { tabId: 5, windowId: 1 }, NOW).action).toBe('revert');
  });

  it('skips non-numeric keys instead of throwing', () => {
    const t = { oops: { end: NOW + 1000, windowId: 1 } } as Timers;
    expect(decideLockAction(t, { tabId: 5, windowId: 1 }, NOW)).toEqual({ action: 'ignore' });
  });
});

describe('recordRevert (circuit breaker)', () => {
  it('does not trip on a few reverts', () => {
    let h: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = recordRevert(h, NOW + i * 100);
      h = r.history;
      expect(r.trip).toBe(false);
    }
  });

  it('trips on the sixth revert within three seconds', () => {
    let h: number[] = [];
    let trip = false;
    for (let i = 0; i < 6; i++) ({ history: h, trip } = recordRevert(h, NOW + i * 100));
    expect(trip).toBe(true);
  });

  it('does not trip when reverts are spread out', () => {
    let h: number[] = [];
    let trip = false;
    for (let i = 0; i < 20; i++) ({ history: h, trip } = recordRevert(h, NOW + i * 1_000));
    expect(trip).toBe(false);
  });

  it('forgets old reverts', () => {
    const { history } = recordRevert([NOW - 10_000, NOW - 9_000], NOW);
    expect(history).toEqual([NOW]);
  });
});
