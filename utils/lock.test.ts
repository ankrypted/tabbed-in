import { describe, expect, it } from 'vitest';
import {
  decideLockAction,
  findTimerFor,
  isNewTabPage,
  MAX_END_AHEAD_MS,
  recordRevert,
  shouldCloseNewTab,
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

describe('shouldCloseNewTab', () => {
  it('closes a tab opened with the new-tab button (no opener)', () => {
    expect(shouldCloseNewTab(running, { id: 7, windowId: 1 }, NOW)).toEqual({
      action: 'close',
      timerTabId: 10,
    });
  });

  it('keeps a tab opened by a link on the timed tab', () => {
    expect(shouldCloseNewTab(running, { id: 7, windowId: 1, openerTabId: 10 }, NOW)).toEqual({
      action: 'ignore',
    });
  });

  it.each(['chrome://newtab/', 'brave://newtab/', 'edge://newtab/', 'about:newtab', 'chrome://new-tab-page/'])(
    'closes a tab on the New Tab page (%s) even if the timed tab is its opener',
    (url) => {
      expect(shouldCloseNewTab(running, { id: 7, windowId: 1, openerTabId: 10, url }, NOW).action).toBe('close');
      expect(shouldCloseNewTab(running, { id: 7, windowId: 1, openerTabId: 10, pendingUrl: url }, NOW).action).toBe('close');
    },
  );

  it('keeps a blank or normal-URL tab that the timed page opened', () => {
    expect(shouldCloseNewTab(running, { id: 7, windowId: 1, openerTabId: 10, url: 'about:blank' }, NOW).action).toBe('ignore');
    expect(shouldCloseNewTab(running, { id: 7, windowId: 1, openerTabId: 10, pendingUrl: 'https://x.test/' }, NOW).action).toBe('ignore');
  });

  it('recognises New Tab pages', () => {
    expect(isNewTabPage('brave://newtab/')).toBe(true);
    expect(isNewTabPage('https://example.com/newtab')).toBe(false);
    expect(isNewTabPage('about:blank')).toBe(false);
    expect(isNewTabPage(undefined)).toBe(false);
  });

  it('closes a tab whose opener is some other tab', () => {
    expect(shouldCloseNewTab(running, { id: 7, windowId: 1, openerTabId: 3 }, NOW).action).toBe('close');
  });

  it('ignores new tabs in another window', () => {
    expect(shouldCloseNewTab(running, { id: 7, windowId: 2 }, NOW).action).toBe('ignore');
  });

  it('ignores new tabs when there is no timer', () => {
    expect(shouldCloseNewTab({}, { id: 7, windowId: 1 }, NOW).action).toBe('ignore');
  });

  it('ignores new tabs once the lock was released', () => {
    const t: Timers = { '10': { end: NOW + 300_000, windowId: 1, lockOff: true } };
    expect(shouldCloseNewTab(t, { id: 7, windowId: 1 }, NOW).action).toBe('ignore');
  });

  it('ignores a corrupt record instead of closing anything', () => {
    const t: Timers = { '10': { end: Number.NaN, windowId: 1 } };
    expect(shouldCloseNewTab(t, { id: 7, windowId: 1 }, NOW).action).toBe('ignore');
  });

  it('ignores a tab with no id', () => {
    expect(shouldCloseNewTab(running, { windowId: 1 }, NOW).action).toBe('ignore');
  });

  it('never closes the timed tab itself', () => {
    expect(shouldCloseNewTab(running, { id: 10, windowId: 1 }, NOW).action).toBe('ignore');
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

describe('group timers', () => {
  const group: Timers = { '10': { end: NOW + 300_000, windowId: 1, groupId: 7, lastTabId: 10 } };

  it('allows switching to another tab of the same group (and says so)', () => {
    expect(decideLockAction(group, { tabId: 11, windowId: 1, groupId: 7 }, NOW)).toEqual({
      action: 'track',
      timerTabId: 10,
    });
  });

  it('reverts a tab outside the group, including an ungrouped one', () => {
    for (const groupId of [8, -1, undefined]) {
      expect(decideLockAction(group, { tabId: 5, windowId: 1, groupId }, NOW)).toEqual({
        action: 'revert',
        timerTabId: 10,
      });
    }
  });

  it('does not let a single-tab timer treat group members as allowed', () => {
    expect(decideLockAction(running, { tabId: 11, windowId: 1, groupId: 7 }, NOW).action).toBe('revert');
  });

  it('still fails open on an invalid or stale group record', () => {
    const bad: Timers = { '10': { end: NOW - STALE_AFTER_MS - 1, windowId: 1, groupId: 7 } };
    expect(decideLockAction(bad, { tabId: 5, windowId: 1, groupId: 1 }, NOW).action).toBe('release');
    const off: Timers = { '10': { end: NOW + 300_000, windowId: 1, groupId: 7, lockOff: true } };
    expect(decideLockAction(off, { tabId: 5, windowId: 1, groupId: 1 }, NOW).action).toBe('ignore');
  });

  it('allows new tabs inside the group, even a New Tab page opened with the group plus button', () => {
    const base = { windowId: 1, groupId: 7 };
    expect(shouldCloseNewTab(group, { id: 20, ...base, pendingUrl: 'chrome://newtab/' }, NOW).action).toBe('ignore');
    expect(shouldCloseNewTab(group, { id: 21, ...base, url: 'https://example.com/' }, NOW).action).toBe('ignore');
  });

  it('closes a tab opened outside the group, but keeps links opened from the last group tab', () => {
    const g: Timers = { '10': { end: NOW + 300_000, windowId: 1, groupId: 7, lastTabId: 12 } };
    expect(shouldCloseNewTab(g, { id: 20, windowId: 1, groupId: -1, url: 'about:blank' }, NOW).action).toBe('close');
    expect(
      shouldCloseNewTab(g, { id: 20, windowId: 1, groupId: -1, openerTabId: 12, url: 'https://a.com/' }, NOW).action,
    ).toBe('ignore');
  });
});

describe('findTimerFor', () => {
  const t: Timers = {
    '10': { end: NOW + 1, windowId: 1, groupId: 7, lastTabId: 10 },
  };
  it('matches the key tab and any tab of the group, nothing else', () => {
    expect(findTimerFor(t, { id: 10, groupId: -1 })?.[0]).toBe('10');
    expect(findTimerFor(t, { id: 11, groupId: 7 })?.[0]).toBe('10');
    expect(findTimerFor(t, { id: 12, groupId: 8 })).toBeNull();
    expect(findTimerFor(t, { id: 12, groupId: -1 })).toBeNull();
    expect(findTimerFor({ '10': { end: NOW, windowId: 1 } }, { id: 11, groupId: 7 })).toBeNull();
  });
});
