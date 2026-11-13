// Runs every *.e2e.mjs in this folder one after another (each launches its own
// browser) and prints a summary. Exit code is non-zero if any file fails.
// Usage: npm run test:e2e              (builds first, then runs all)
//        node e2e/run.mjs lock         (run only files whose name contains "lock")
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2];
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.e2e.mjs') && (!filter || f.includes(filter)))
  .sort();

if (files.length === 0) {
  console.error(`No e2e files match "${filter ?? ''}".`);
  process.exit(1);
}

const failed = [];
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(dir, f)], { stdio: 'inherit' });
  if (r.status !== 0) failed.push(f);
}

console.log('\n' + '='.repeat(40));
console.log(`${files.length - failed.length}/${files.length} e2e files passed`);
if (failed.length) console.log('FAILED: ' + failed.join(', '));
process.exit(failed.length ? 1 : 0);
