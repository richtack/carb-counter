// Generates app icons with no dependencies (built-in zlib only).
// Draws a rounded green square with three ascending white bars (a tracker mark).
// Run:  node generate-icons.js
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encodePNG(size, pixels) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  // raw scanlines with filter byte 0
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0;
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      raw[o++] = pixels[i];
      raw[o++] = pixels[i + 1];
      raw[o++] = pixels[i + 2];
      raw[o++] = pixels[i + 3];
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

function drawIcon(size, maskable) {
  const px = new Uint8Array(size * size * 4);
  const bg = [22, 163, 74];       // green-600
  const bgDark = [21, 128, 61];   // subtle gradient bottom
  const white = [255, 255, 255];
  // maskable icons need the art inside a safe zone; use a smaller corner radius / full bleed
  const radius = maskable ? 0 : size * 0.22;
  const pad = maskable ? size * 0.18 : size * 0.20;

  const inCorner = (x, y) => {
    if (radius === 0) return true;
    const r = radius;
    const cxs = [r, size - r], cys = [r, size - r];
    if ((x < r || x > size - r) && (y < r || y > size - r)) {
      const cx = x < r ? cxs[0] : cxs[1];
      const cy = y < r ? cys[0] : cys[1];
      return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
    }
    return true;
  };

  // bar geometry: 3 ascending rounded bars
  const usable = size - pad * 2;
  const gap = usable * 0.10;
  const barW = (usable - gap * 2) / 3;
  const baseY = size - pad;
  const heights = [0.45, 0.72, 1.0].map((h) => h * usable);

  const inBar = (x, y) => {
    for (let b = 0; b < 3; b++) {
      const bx = pad + b * (barW + gap);
      const topY = baseY - heights[b];
      if (x >= bx && x <= bx + barW && y >= topY && y <= baseY) {
        // round the top corners a touch
        const rr = barW * 0.28;
        if (y < topY + rr) {
          const cxL = bx + rr, cxR = bx + barW - rr;
          if (x < cxL && (x - cxL) ** 2 + (y - (topY + rr)) ** 2 > rr * rr) continue;
          if (x > cxR && (x - cxR) ** 2 + (y - (topY + rr)) ** 2 > rr * rr) continue;
        }
        return true;
      }
    }
    return false;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (!inCorner(x, y)) { px[i + 3] = 0; continue; }
      const t = y / size;
      const c = inBar(x, y)
        ? white
        : [Math.round(bg[0] + (bgDark[0] - bg[0]) * t),
           Math.round(bg[1] + (bgDark[1] - bg[1]) * t),
           Math.round(bg[2] + (bgDark[2] - bg[2]) * t)];
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
    }
  }
  return px;
}

const outDir = path.join(__dirname, "icons");
fs.mkdirSync(outDir, { recursive: true });
const targets = [
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["icon-maskable-512.png", 512, true],
  ["apple-touch-icon.png", 180, false],
];
for (const [file, size, maskable] of targets) {
  fs.writeFileSync(path.join(outDir, file), encodePNG(size, drawIcon(size, maskable)));
  console.log("wrote icons/" + file);
}
