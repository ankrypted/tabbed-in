// Pure decision logic for the tab-switch lock. No browser APIs, so it is unit tested.
// The background script applies the decisions.

/**
 * focus: locks you to the tab/group, bell at the end, nothing is closed.
 * leisure: no lock; the page blurs over the last 15 s and the tab closes at zero.
 */
export type TimerMode = 'focus' | 'leisure';

export type TimerRecord = {
  end: number;
  /** Missing on older records: treated as focus. */
  mode?: TimerMode;
  /** Window the timed tab lives in. Missing on legacy records, which are never locked. */
  windowId?: number;
  /** Set when the lock was released (circuit breaker / error). The timer keeps running. */
  lockOff?: boolean;
  /**
   * Group timer: the browser tab group this timer covers. The user may move
   * freely between tabs of this group. Absent for a single-tab timer.
   */
  groupId?: number;
  /** Group timer: the group tab the user was last on (where a revert returns to). */
  lastTabId?: number;
};
export type Timers = Record<string, TimerRecord>;
/** `groupId` is the browser's tab group id (-1 or undefined: not in a group). */
export type Activation = { tabId: number; windowId: number; groupId?: number };

export type LockDecision =
  | { action: 'ignore' }
  | { action: 'revert'; timerTabId: number }
  /** Group timer: the user moved to another tab of the same group (allowed). */
  | { action: 'track'; timerTabId: number }
  | { action: 'release'; timerTabId: number; reason: string };

/** Is this a real tab-group id? (Chrome uses -1 for "no group".) */
export const isGroupId = (g: unknown): g is number => typeof g === 'number' && g >= 0;

/**
 * Find the timer that applies to a tab: the one started on it, or a group timer
 * whose group the tab belongs to. Returns [key, record] (key = the tab id the
 * record is stored under) or null.
 */
export function findTimerFor(
  timers: Timers,
  tab: { id?: number; groupId?: number },
): [string, TimerRecord] | null {
  for (const [key, t] of Object.entries(timers)) {
    if (tab.id !== undefined && String(tab.id) === key) return [key, t];
    if (isGroupId(t.groupId) && tab.groupId === t.groupId) return [key, t];
  }
  return null;
}

/** A timer whose alarm should have fired long ago is stale: never hold a lock for it. */
export const STALE_AFTER_MS = 60_000;
/** Longest legitimate timer is 24 h; anything further out is a corrupt record. */
export const MAX_END_AHEAD_MS = 25 * 3_600_000;

/**
 * Decide what to do when `activation` (a tab was just activated) happens.
 * Fails open: anything doubtful means "ignore" or "release", never "trap".
 */
export function decideLockAction(
  timers: Timers,
  activation: Activation,
  now: number,
): LockDecision {
  for (const [id, t] of Object.entries(timers)) {
    const timerTabId = Number(id);
    if (!Number.isInteger(timerTabId)) continue;
    if (t.lockOff) continue;
    if (t.mode === 'leisure') continue; // leisure never locks
    if (t.windowId === undefined) continue; // legacy record: no lock
    if (t.windowId !== activation.windowId) continue; // other window: not our business

    if (!Number.isFinite(t.end) || t.end - now > MAX_END_AHEAD_MS) {
      return { action: 'release', timerTabId, reason: 'invalid timer record' };
    }
    if (t.end < now - STALE_AFTER_MS) {
      return { action: 'release', timerTabId, reason: 'stale timer record' };
    }
    if (isGroupId(t.groupId)) {
      // Group timer: any tab of the group is fine, everything else is reverted.
      if (activation.groupId === t.groupId) return { action: 'track', timerTabId };
      return { action: 'revert', timerTabId };
    }
    if (timerTabId === activation.tabId) continue; // already on the timed tab
    return { action: 'revert', timerTabId };
  }
  return { action: 'ignore' };
}

export type NewTab = {
  id?: number;
  windowId: number;
  groupId?: number;
  openerTabId?: number;
  url?: string;
  pendingUrl?: string;
};
export type NewTabDecision = { action: 'ignore' } | { action: 'close'; timerTabId: number };

/** The browser's own New Tab page (what the + button and Ctrl+T open). */
export function isNewTabPage(url?: string): boolean {
  return (
    !!url &&
    /^((chrome|brave|edge|vivaldi|opera):\/\/(newtab|new-tab-page)|about:newtab|chrome-search:\/\/)/i.test(url)
  );
}

/**
 * A tab was just created while a timer may be locking this window. Close tabs
 * the user opened themselves: anything that opens on the browser's New Tab page
 * (+ button, Ctrl+T), and anything with no opener or an opener other than the
 * timed tab. Keep tabs opened by a link or script on the timed page itself, so
 * sites that open helper tabs keep working; the lock still keeps focus on the
 * timed tab.
 * Anything doubtful (released lock, corrupt record) means "ignore".
 */
export function shouldCloseNewTab(timers: Timers, tab: NewTab, now: number): NewTabDecision {
  if (tab.id === undefined) return { action: 'ignore' };
  const d = decideLockAction(
    timers,
    { tabId: tab.id, windowId: tab.windowId, groupId: tab.groupId },
    now,
  );
  const userOpened = isNewTabPage(tab.pendingUrl) || isNewTabPage(tab.url);
  // Inside the locked group, new tabs (including a New Tab page opened with the
  // group's own "+") are allowed: they are part of the group being timed.
  if (d.action === 'track') return { action: 'ignore' };
  if (d.action !== 'revert') return { action: 'ignore' };
  const t = timers[String(d.timerTabId)];
  // For a group timer, a link opened from any tab of the group counts as "from the page".
  const openedByTimedPage =
    tab.openerTabId === d.timerTabId ||
    (isGroupId(t?.groupId) && tab.openerTabId !== undefined && tab.openerTabId === t.lastTabId);
  if (openedByTimedPage && !userOpened) return { action: 'ignore' };
  return { action: 'close', timerTabId: d.timerTabId };
}

export const BREAKER_LIMIT = 5;
export const BREAKER_WINDOW_MS = 3_000;

/**
 * Circuit breaker for a revert loop (e.g. another extension fighting us).
 * Records a revert at `now`; `trip` is true once more than `limit` reverts
 * happened within `windowMs`.
 */
export function recordRevert(
  history: number[],
  now: number,
  limit = BREAKER_LIMIT,
  windowMs = BREAKER_WINDOW_MS,
): { history: number[]; trip: boolean } {
  const next = [...history.filter((t) => now - t < windowMs), now];
  return { history: next, trip: next.length > limit };
}
