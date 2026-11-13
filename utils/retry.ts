/**
 * Retry an async action until it succeeds or `attempts` is used up, waiting
 * `delayMs` between tries. Rethrows the last error.
 *
 * Why it exists: Chrome fires tabs.onActivated on mouse-DOWN over a tab, and
 * refuses tabs.update/remove until the click ends ("Tabs cannot be edited right
 * now (user may be dragging a tab)"). Retrying until mouse-up makes it work.
 */
export async function retry<T>(
  action: () => Promise<T>,
  attempts = 40,
  delayMs = 100,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await action();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) await sleep(delayMs);
    }
  }
  throw lastError;
}
