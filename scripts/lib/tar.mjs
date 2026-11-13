// A tiny dependency-free tar.gz writer (ustar format), shared by the release scripts.
// Written by hand because the tar that ships with Windows can't set file modes, and
// scripts must stay executable after unpacking on macOS/Linux.
import zlib from 'node:zlib';

const octal = (n, width) => n.toString(8).padStart(width - 1, '0') + '\0';

function header(name, size, mode, type, mtime) {
  if (Buffer.byteLength(name) > 100) throw new Error(`name too long for tar: ${name}`);
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, 'utf8');
  h.write(octal(mode, 8), 100);
  h.write(octal(0, 8), 108); // uid
  h.write(octal(0, 8), 116); // gid
  h.write(octal(size, 12), 124);
  h.write(octal(mtime, 12), 136);
  h.write('        ', 148); // checksum placeholder
  h.write(type, 156);
  h.write('ustar\0', 257);
  h.write('00', 263);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return h;
}

/**
 * entries: [{ name, dir?: true, data?: Buffer, mode?: number }]
 * Returns a gzipped tar as a Buffer.
 */
export function tarGz(entries, { mtime = Math.floor(Date.now() / 1000) } = {}) {
  const blocks = [];
  for (const e of entries) {
    if (e.dir) {
      blocks.push(header(e.name.endsWith('/') ? e.name : e.name + '/', 0, e.mode ?? 0o755, '5', mtime));
    } else {
      const data = e.data;
      blocks.push(
        header(e.name, data.length, e.mode ?? 0o644, '0', mtime),
        data,
        Buffer.alloc((512 - (data.length % 512)) % 512),
      );
    }
  }
  blocks.push(Buffer.alloc(1024)); // end-of-archive marker
  return zlib.gzipSync(Buffer.concat(blocks), { level: 9 });
}
