// make-icons.mjs — 產生 PWA 圖示（純 Node，零依賴：手寫 PNG + zlib）
// 用法：node scripts/make-icons.mjs
// 圖案：深藍底 ＋ 淺色 "F" ＋ 底部藍色橫槓（wafer line 的意象）

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'icons');

const BG = [0x0b, 0x1e, 0x2d];
const FG = [0xe6, 0xed, 0xf2];
const ACCENT = [0x56, 0xb6, 0xd8];

/* ------------------------- 極簡 PNG 編碼器 ------------------------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** @param {Uint8Array} rgb size*size*3 */
function encodePng(size, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 2;    // colour type: truecolour
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const stride = size * 3;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;   // filter: none
    Buffer.from(rgb.buffer, rgb.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------------------- 畫圖 ---------------------------- */

function makeIcon(size, safe = 1) {
  const px = new Uint8Array(size * size * 3);
  fill(px, size, 0, 0, size, size, BG);

  // safe < 1 → 圖案縮進中央（maskable 用）
  const g = Math.round(size * 0.56 * safe);   // 字高
  const x0 = Math.round((size - g * 0.78) / 2);
  const y0 = Math.round((size - g) / 2) - Math.round(size * 0.03);

  const stem = Math.max(2, Math.round(g * 0.19));
  const topH = stem;
  const midH = Math.max(2, Math.round(g * 0.17));

  fill(px, size, x0, y0, stem, g, FG);                                  // 直筆
  fill(px, size, x0, y0, Math.round(g * 0.78), topH, FG);               // 上橫
  fill(px, size, x0, y0 + Math.round(g * 0.42), Math.round(g * 0.60), midH, FG);  // 中橫

  // 底部藍槓
  const barW = Math.round(size * 0.44 * safe);
  const barH = Math.max(2, Math.round(size * 0.055 * safe));
  fill(px, size, Math.round((size - barW) / 2), y0 + g + Math.round(size * 0.07), barW, barH, ACCENT);

  return px;
}

function fill(px, size, x, y, w, h, [r, g, b]) {
  for (let yy = Math.max(0, y); yy < Math.min(size, y + h); yy++) {
    for (let xx = Math.max(0, x); xx < Math.min(size, x + w); xx++) {
      const i = (yy * size + xx) * 3;
      px[i] = r; px[i + 1] = g; px[i + 2] = b;
    }
  }
}

/* ---------------------------- 輸出 ---------------------------- */

mkdirSync(OUT, { recursive: true });

const targets = [
  ['icon-192.png', 192, 1],
  ['icon-512.png', 512, 1],
  ['icon-180.png', 180, 1],          // apple-touch-icon
  ['icon-512-maskable.png', 512, 0.72],
];

for (const [name, size, safe] of targets) {
  writeFileSync(join(OUT, name), encodePng(size, makeIcon(size, safe)));
  console.log(`✓ icons/${name} (${size}×${size})`);
}
