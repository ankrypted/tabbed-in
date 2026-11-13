// Builds the Linux + macOS installer bundle:
//   .output/tabbed-in-linux-macos-<version>.tar.gz
// containing the extension zip plus install.sh / install.command / README.txt,
// with the executable bit set on the scripts.
// Run via:  npm run bundle:unix   (which builds the extension zip first)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tarGz } from './lib/tar.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const extZip = path.join(root, '.output', `tabbed-in-${version}-chrome.zip`);
if (!fs.existsSync(extZip)) {
  console.error(`Missing ${extZip}. Run 'npm run zip' first.`);
  process.exit(1);
}

const top = `Tabbed-In-${version}-linux-macos`;
const unixDir = path.join(root, 'installer', 'unix');

// A script with Windows (CRLF) line endings fails on Linux/macOS ("bash\r: bad
// interpreter"), and editors on Windows add them silently. Always pack LF.
const unixText = (file) => Buffer.from(fs.readFileSync(path.join(unixDir, file), 'utf8').replace(/\r\n/g, '\n'), 'utf8');

const out = path.join(root, '.output', `tabbed-in-linux-macos-${version}.tar.gz`);
fs.writeFileSync(
  out,
  tarGz([
    { name: top, dir: true },
    { name: `${top}/${path.basename(extZip)}`, data: fs.readFileSync(extZip), mode: 0o644 },
    { name: `${top}/install.sh`, data: unixText('install.sh'), mode: 0o755 },
    { name: `${top}/install.command`, data: unixText('install.command'), mode: 0o755 },
    { name: `${top}/README.txt`, data: unixText('README.txt'), mode: 0o644 },
  ]),
);
console.log(`Created ${out}`);
