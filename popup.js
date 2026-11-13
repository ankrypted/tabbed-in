const PHRASE = "i am done";
const $ = (id) => document.getElementById(id);

async function main() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  $("title").textContent = tab.title || tab.url;

  const start = async (minutes) => {
    if (!(minutes > 0)) return;
    await chrome.runtime.sendMessage({ type: "start", tabId: tab.id, minutes });
    render();
  };

  document.querySelectorAll("[data-m]").forEach((b) =>
    b.addEventListener("click", () => start(+b.dataset.m)));
  $("go").addEventListener("click", () => start(+$("custom").value));

  $("phrase").addEventListener("input", async (e) => {
    if (e.target.value.trim().toLowerCase() === PHRASE) {
      await chrome.runtime.sendMessage({ type: "cancel", tabId: tab.id });
      e.target.value = "";
      render();
    }
  });

  async function render() {
    const r = await chrome.storage.session.get("timers");
    const t = (r.timers || {})[tab.id];
    $("setup").classList.toggle("hidden", !!t);
    $("running").classList.toggle("hidden", !t);
    if (t) {
      const s = Math.max(0, Math.round((t.end - Date.now()) / 1000));
      $("remaining").textContent =
        `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} left`;
    }
  }

  render();
  setInterval(render, 1000);
}

main();
