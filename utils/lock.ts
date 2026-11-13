// Pure decision logic for the tab-switch lock. No browser APIs, so it is unit tested.
// The background script applies the decisions.

export type TimerRecord = {
  end: number;
  /** Window the timed tab lives in. Missing on legacy records, which are never locked. */
  windowId?: number;
  /** Set when the lock was released (circuit breaker / error). The timer keeps running. */
  lockOff?: boolean;
};
export type Timers = Record<string, TimerRecord>;
export type Activation = { tabId: number; windowId: number };

export type LockDecision =
  | { action: 'ignore' }
  | { action: 'revert'; timerTabId: number }
  | { action: 'release'; timerTabId: number; reason: string };

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
    if (t.windowId === undefined) continue; // legacy record: no lock
    if (t.windowId !== activation.windowId) continue; // other window: not our business

    if (!Number.isFinite(t.end) || t.end - now > MAX_END_AHEAD_MS) {
      return { action: 'release', timerTabId, reason: 'invalid timer record' };
    }
    if (t.end < now - STALE_AFTER_MS) {
      return { action: 'release', timerTabId, reason: 'stale timer record' };
    }
    if (timerTabId === activation.tabId) continue; // already on the timed tab
    return { action: 'revert', timerTabId };
  }
  return { action: 'ignore' };
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
