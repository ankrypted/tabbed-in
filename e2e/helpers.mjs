// Shared helpers for the browser (end-to-end) tests.
// These drive a real Brave/Chromium with the built extension loaded.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Browser to test in. Set BROWSER_PATH to override.
 * Brave (or Chromium) is needed: branded Chrome 137+ ignores --load-extension.
 */
export function findBrowser() {
  const candidates = [
    process.env.BROWSER_PATH,
    'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    `${process.env.LOCALAPPDATA}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/usr/bin/brave-browser',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(
      'No Brave/Chromium found. Install Brave or set BROWSER_PATH to its executable.\n' +
        'Note: branded Chrome 137+ cannot load unpacked extensions from the command line.',
    );
  }
  return found;
}

/**
 * Copy the production build to .output/e2e-ext-* so tests never touch the real
 * build. With grantHosts, the copy gets host_permissions pre-granted: the real
 * extension asks for site access through a browser dialog that automation
 * can't click.
 */
export function prepareExtension({ grantHosts }) {
  const src = path.join(ROOT, '.output', 'chrome-mv3');
  if (!fs.existsSync(path.join(src, 'manifest.json'))) {
    throw new Error('No build found. Run `npm run build` first (or use `npm run test:e2e`).');
  }
  const dst = path.join(ROOT, '.output', grantHosts ? 'e2e-ext-granted' : 'e2e-ext-real');
  fs.rmSync(dst, { recursive: true, force: true });
  fs.cpSync(src, dst, { recursive: true });
  if (grantHosts) {
    const file = path.join(dst, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    manifest.host_permissions = ['<all_urls>'];
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
  }
  return dst;
}

/** Launch the browser with the extension and a throwaway profile. */
export async function launch({ grantHosts = false } = {}) {
  const ext = prepareExtension({ grantHosts });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tabbedin-e2e-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: findBrowser(),
    headless: false,
    viewport: { width: 1000, height: 700 },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const id = new URL(sw.url()).host;
  const close = async () => {
    await ctx.close().catch(() => {});
    fs.rmSync(profile, { recursive: true, force: true });
  };
  return { ctx, sw, id, close };
}

/** Collects PASS/FAIL lines and sets a non-zero exit code on any failure. */
export function reporter(title) {
  const results = [];
  console.log(`\n=== ${title}`);
  return {
    check(name, ok, extra = '') {
      results.push(!!ok);
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
    },
    fail(message) {
      results.push(false);
      console.log(`FAIL  ${message}`);
    },
    done() {
      const passed = results.filter(Boolean).length;
      console.log(`${passed}/${results.length} checks passed`);
      if (passed !== results.length || results.length === 0) process.exitCode = 1;
    },
  };
}
