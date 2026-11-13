import type { Timers } from '../../utils/lock';
import { formatRemaining } from '../../utils/time';

const PHRASE = 'i am done';
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;

async function main() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return;
  const tabId = tab.id;
  $('title').textContent = tab.title || tab.url || '';

  const start = async (minutes: number) => {
    if (!(minutes > 0)) return;
    // Ask for site access first, in the same click (a user gesture is required),
    // so the on-page widget can be shown. If the user declines, the timer still
    // runs with the badge and this popup. The background also shows the widget
    // as soon as the permission is granted, even if this popup has closed.
    const access = browser.permissions
      .request({ origins: ['<all_urls>'] })
      .catch(() => false);
    await browser.runtime.sendMessage({ type: 'start', tabId, minutes });
    await access;
    render();
  };

  document.querySelectorAll<HTMLButtonElement>('[data-m]').forEach((b) =>
    b.addEventListener('click', () => start(+b.dataset.m!)));
  $('go').addEventListener('click', () =>
    start(+$<HTMLInputElement>('custom').value));

  $<HTMLInputElement>('phrase').addEventListener('input', async (e) => {
    const input = e.target as HTMLInputElement;
    if (input.value.trim().toLowerCase() === PHRASE) {
      await browser.runtime.sendMessage({ type: 'cancel', tabId });
      input.value = '';
      render();
    }
  });

  async function render() {
    const r = await browser.storage.session.get('timers');
    const timers = (r.timers ?? {}) as Timers;
    const t = timers[tabId];
    const timerElsewhere = !t && Object.keys(timers).length > 0;
    $('setup').classList.toggle('hidden', !!t || timerElsewhere);
    $('blocked').classList.toggle('hidden', !timerElsewhere);
    $('running').classList.toggle('hidden', !t);
    if (t) {
      $('remaining').textContent = `${formatRemaining(t.end - Date.now())} left`;
      $('lockinfo').querySelector('small')!.textContent = t.lockOff
        ? 'Tab lock is off for this timer.'
        : 'Tabs are locked while this timer runs.';
    }
  }

  render();
  setInterval(render, 1000);
}

main();
