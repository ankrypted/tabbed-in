// Baseline port of the v1.0 popup. Behaviour is unchanged for now.

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
    await browser.runtime.sendMessage({ type: 'start', tabId, minutes });
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
    const t = ((r.timers ?? {}) as Record<string, { end: number }>)[tabId];
    $('setup').classList.toggle('hidden', !!t);
    $('running').classList.toggle('hidden', !t);
    if (t) {
      const s = Math.max(0, Math.round((t.end - Date.now()) / 1000));
      $('remaining').textContent =
        `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} left`;
    }
  }

  render();
  setInterval(render, 1000);
}

main();
