import { findTimerFor, isGroupId, type Timers } from '../../utils/lock';
import { formatRemaining } from '../../utils/time';

const PHRASE = 'i am done';

const HELP = {
  focus:
    "You'll be locked to this tab until the timer ends or you stop it: other tabs are blocked and new tabs you open are closed. When time is up, a bell rings and the lock lifts. The tab stays open.",
  leisure:
    'No tab lock. The screen gets hazier over the last 15 seconds, then this tab closes. Save anything you need first. Type "I am done" to stop early.',
};
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;

async function main() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return;
  const tabId = tab.id;
  $('title').textContent = tab.title || tab.url || '';

  // If this tab is in a browser tab group, offer to time the whole group: the
  // user can then move between its tabs freely.
  const inGroup = isGroupId(tab.groupId);
  let mode: 'focus' | 'leisure' = 'focus';
  if (inGroup) {
    const n = (await browser.tabs.query({ groupId: tab.groupId })).length;
    $('grouptext').textContent = `Whole tab group (${n} tab${n === 1 ? '' : 's'}): switch freely between them`;
    $('groupopt').classList.remove('hidden');
  }

  const setMode = (m: 'focus' | 'leisure') => {
    mode = m;
    $('mode-focus').classList.toggle('on', m === 'focus');
    $('mode-leisure').classList.toggle('on', m === 'leisure');
    $('modehelp').textContent = HELP[m];
    // Leisure times one tab only, so the group option doesn't apply.
    $('groupopt').classList.toggle('hidden', !inGroup || m === 'leisure');
  };
  $('mode-focus').addEventListener('click', () => setMode('focus'));
  $('mode-leisure').addEventListener('click', () => setMode('leisure'));
  setMode('focus');

  const start = async (minutes: number) => {
    if (!(minutes > 0)) return;
    const group = mode === 'focus' && inGroup && $<HTMLInputElement>('group').checked;
    // Start the timer FIRST. The browser closes this popup the moment it shows
    // the site-access dialog, so anything after that request may never run.
    const res: { ok: boolean; error?: string } | undefined = await browser.runtime
      .sendMessage({ type: 'start', tabId, minutes, group, mode })
      .catch(() => undefined);
    if (!res?.ok) {
      showError(res?.error ?? 'Could not start the timer. Try again.');
      render();
      return;
    }
    // Then ask for site access so the on-page widget can be shown (still inside
    // the click's user-activation window). If declined, the timer and lock still
    // work; the background shows the widget as soon as access is granted, even
    // after this popup has closed.
    try {
      await browser.permissions.request({ origins: ['<all_urls>'] });
    } catch {}
    render();
  };

  const showError = (text: string) => {
    $('error').classList.remove('hidden');
    $('error').querySelector('small')!.textContent = text;
  };

  document.querySelectorAll<HTMLButtonElement>('[data-m]').forEach((b) =>
    b.addEventListener('click', () => start(+b.dataset.m!)));
  $('go').addEventListener('click', () =>
    start(+$<HTMLInputElement>('custom').value));

  $<HTMLInputElement>('phrase').addEventListener('input', async (e) => {
    const input = e.target as HTMLInputElement;
    if (input.value.trim().toLowerCase() === PHRASE) {
      // A group timer is stored under one tab of the group, so look up the key.
      const timers = ((await browser.storage.session.get('timers')).timers ?? {}) as Timers;
      const key = findTimerFor(timers, tab!)?.[0] ?? String(tabId);
      await browser.runtime.sendMessage({ type: 'cancel', tabId: +key });
      input.value = '';
      render();
    }
  });

  async function render() {
    const r = await browser.storage.session.get('timers');
    const timers = (r.timers ?? {}) as Timers;
    const t = findTimerFor(timers, tab!)?.[1];
    const timerElsewhere = !t && Object.keys(timers).length > 0;
    $('setup').classList.toggle('hidden', !!t || timerElsewhere);
    $('blocked').classList.toggle('hidden', !timerElsewhere);
    $('running').classList.toggle('hidden', !t);
    if (t) {
      $('remaining').textContent = `${formatRemaining(t.end - Date.now())} left`;
      $('lockinfo').querySelector('small')!.textContent = t.mode === 'leisure'
        ? 'Leisure: the screen blurs in the last 15 seconds, then this tab closes.'
        : t.lockOff
        ? 'Tab lock is off for this timer.'
        : isGroupId(t.groupId)
          ? 'Locked to this tab group: other tabs are blocked.'
          : 'Tabs are locked while this timer runs.';
    }
  }

  render();
  setInterval(render, 1000);
}

main();
