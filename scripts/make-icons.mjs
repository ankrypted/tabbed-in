// Generates the extension icons (public/icon/{16,32,48,96,128}.png): a blue
// rounded square with a white clock face. No dependencies: it rasterises the
// shapes itself (4x4 supersampling) and writes the PNGs with node:zlib.
// Run: node scripts/make-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icon');
const SIZES = [16, 32, 48, 96, 128];
const BLUE = [26, 115, 232];
const WHITE = [255, 255, 255];

// --- shapes, in unit coordinates (0..1) ---
const roundedRect = (u, v, r) => {
  const dx = Math.abs(u - 0.5) - (0.5 - r);
  const dy = Math.abs(v - 0.5) - (0.5 - r);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r; // <0 inside
};
const segment = (u, v, ax, ay, bx, by) => {
  const px = u - ax, py = v - ay, bax = bx - ax, bay = by - ay;
  const h = Math.min(1, Math.max(0, (px * bax + py * bay) / (bax * bax + bay * bay)));
  return Math.hypot(px - bax * h, py - bay * h);
};

/** Colour at a point, or null if transparent. */
function shade(u, v) {
  if (roundedRect(u, v, 0.22) > 0) return null;
  const ring = Math.abs(Math.hypot(u - 0.5, v - 0.5) - 0.28); // distance from the ring's centre line
  const hands =
    Math.min(segment(u, v, 0.5, 0.5, 0.5, 0.3), segment(u, v, 0.5, 0.5, 0.65, 0.58)); // minute, hour
  if (ring < 0.045 || hands < 0.04) return WHITE;
  return BLUE;
}

function render(size) {
  const buf = Buffer.alloc(size * size * 4);
  const N = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const c = shade((x + (sx + 0.5) / N) / size, (y + (sy + 0.5) / N) / size);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 1; }
        }
      }
      const o = (y * size + x) * 4;
      if (a > 0) {
        buf[o] = Math.round(r / a);
        buf[o + 1] = Math.round(g / a);
        buf[o + 2] = Math.round(b / a);
        buf[o + 3] = Math.round((a / (N * N)) * 255);
      }
    }
  }
  return buf;
}

// --- minimal PNG encoder (RGBA, 8-bit) ---
function crc32(buf) {
  let crc = ~0;
  for (const byte of buf) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(outDir, { recursive: true });
for (const size of SIZES) {
  const file = path.join(outDir, `${size}.png`);
  fs.writeFileSync(file, encodePng(size, render(size)));
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
}
