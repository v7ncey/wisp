// Draws Wisp's orb as PNG icons for the extension (Chrome doesn't accept SVG icons).
// No image libraries: pixels are computed directly and encoded with zlib.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function png(size) {
  const S = 4; // supersampling for smooth edges
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++)
        for (let sx = 0; sx < S; sx++) {
          // Map to the 64x64 design space of the SVG.
          const u = ((x + (sx + 0.5) / S) / size) * 64;
          const v = ((y + (sy + 0.5) / S) / size) * 64;
          const d = Math.hypot(u - 32, v - 32);
          const eye = (cx) => ((u - cx) / 3.4) ** 2 + ((v - 31) / 4.6) ** 2 <= 1;
          if (d <= 26 && (eye(25) || eye(39))) {
            r += 29; g += 42; b += 68; a += 255;
          } else if (d <= 26) {
            const t = Math.min(1, Math.hypot(u - 29, v - 26) / 30);
            r += 255 + (106 - 255) * t; g += 255 + (168 - 255) * t; b += 255;
            a += 255;
          }
        }
      const n = S * S;
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const alpha = a / n;
      raw[o] = alpha ? Math.round((r / n) * (255 / alpha)) : 0;
      raw[o + 1] = alpha ? Math.round((g / n) * (255 / alpha)) : 0;
      raw[o + 2] = alpha ? Math.round((b / n) * (255 / alpha)) : 0;
      raw[o + 3] = Math.round(alpha);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync("extension/icons", { recursive: true });
for (const s of [16, 48, 128]) writeFileSync(`extension/icons/${s}.png`, png(s));
console.log("Wrote extension/icons/{16,48,128}.png");
