// Packages the BUILT extension folder for sharing directly (no installer):
//   releases/tabbed-in-<version>-extension.tar.gz   one folder, tabbed-in-<version>/, with the extension in it
//   releases/tabbed-in-<version>-extension.zip      the same files as a zip (Windows Explorer opens zips)
// A friend unpacks either one and uses "Load unpacked" on the folder.
// Run via:  npm run release:extension   (builds first)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tarGz } from './lib/tar.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const buildDir = path.join(root, '.output', 'chrome-mv3');
const manifestPath = path.join(buildDir, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error(`No build at ${buildDir}. Run 'npm run build' first.`);
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.version !== version) {
  console.error(`The build is version ${manifest.version} but package.json says ${version}. Rebuild first.`);
  process.exit(1);
}

// All files in the build, sorted so the archive is the same every time.
function listFiles(dir, base = '') {
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    if (fs.statSync(full).isDirectory()) out.push(...listFiles(full, rel));
    else out.push(rel);
  }
  return out;
}
const files = listFiles(buildDir);

// Reproducible: the archive's timestamp is the newest file's, not "now", so rebuilding
// unchanged code gives identical bytes and no noisy git diff.
const mtime = Math.floor(Math.max(...files.map((f) => fs.statSync(path.join(buildDir, f)).mtimeMs)) / 1000);

const top = `tabbed-in-${version}`;
const dirs = [...new Set(files.flatMap((f) => f.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'))))].sort();
const entries = [
  { name: top, dir: true },
  ...dirs.map((d) => ({ name: `${top}/${d}`, dir: true })),
  ...files.map((f) => ({ name: `${top}/${f}`, data: fs.readFileSync(path.join(buildDir, f)), mode: 0o644 })),
];

const outDir = path.join(root, 'releases');
fs.mkdirSync(outDir, { recursive: true });
const tarPath = path.join(outDir, `tabbed-in-${version}-extension.tar.gz`);
fs.writeFileSync(tarPath, tarGz(entries, { mtime }));
console.log(`Created ${path.relative(root, tarPath)}  (${files.length} files, ${fs.statSync(tarPath).size} bytes)`);

// The zip made by `wxt zip` has the same files at its top level.
const zipSrc = path.join(root, '.output', `tabbed-in-${version}-chrome.zip`);
if (fs.existsSync(zipSrc)) {
  const zipPath = path.join(outDir, `tabbed-in-${version}-extension.zip`);
  fs.copyFileSync(zipSrc, zipPath);
  console.log(`Created ${path.relative(root, zipPath)}  (${fs.statSync(zipPath).size} bytes)`);
}
