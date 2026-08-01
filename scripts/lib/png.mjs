/**
 * 最小限のPNGエンコーダと簡易ラスタライザ。
 *
 * アイコン生成のためだけに sharp のようなネイティブ依存を持ち込むと、
 * インストール環境によってビルドが壊れる。ここでは Node 標準の zlib だけで
 * 8bit RGBA の PNG を書き出す。
 */

import { deflateSync } from 'node:zlib';

const CRC_TABLE = buildCrcTable();

function buildCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'latin1');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

/**
 * RGBA のピクセル配列を PNG バイト列へ変換する。
 * @param {{width: number, height: number, data: Uint8ClampedArray}} image
 * @returns {Buffer}
 */
export function encodePng(image) {
  const { width, height, data } = image;

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // color type: RGBA
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // interlace

  // 各走査線の先頭にフィルタ種別（0 = None）を付ける。
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * 単色で塗りつぶした RGBA キャンバスを作る。
 * @param {number} width
 * @param {number} height
 * @param {[number, number, number, number]} rgba
 */
export function createCanvas(width, height, rgba = [0, 0, 0, 0]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgba[0];
    data[i + 1] = rgba[1];
    data[i + 2] = rgba[2];
    data[i + 3] = rgba[3];
  }
  return { width, height, data };
}

/** source-over 合成で1ピクセル塗る。 */
function blendPixel(canvas, x, y, [r, g, b, a]) {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height || a <= 0) {
    return;
  }
  const i = (y * canvas.width + x) * 4;
  const srcA = a / 255;
  const dstA = canvas.data[i + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA <= 0) {
    canvas.data[i + 3] = 0;
    return;
  }
  canvas.data[i] = (r * srcA + canvas.data[i] * dstA * (1 - srcA)) / outA;
  canvas.data[i + 1] = (g * srcA + canvas.data[i + 1] * dstA * (1 - srcA)) / outA;
  canvas.data[i + 2] = (b * srcA + canvas.data[i + 2] * dstA * (1 - srcA)) / outA;
  canvas.data[i + 3] = outA * 255;
}

/**
 * 角丸長方形を塗る。回転には対応しない。
 * @param {{width: number, height: number, data: Uint8ClampedArray}} canvas
 */
export function fillRoundedRect(canvas, x, y, w, h, radius, rgba) {
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(canvas.width, Math.ceil(x + w));
  const y1 = Math.min(canvas.height, Math.ceil(y + h));

  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
      const cx = px + 0.5;
      const cy = py + 0.5;
      if (cx < x || cx > x + w || cy < y || cy > y + h) {
        continue;
      }
      // 角の内側だけ円で判定する。
      const nearestX = Math.min(Math.max(cx, x + r), x + w - r);
      const nearestY = Math.min(Math.max(cy, y + r), y + h - r);
      const dx = cx - nearestX;
      const dy = cy - nearestY;
      if (dx * dx + dy * dy <= r * r) {
        blendPixel(canvas, px, py, rgba);
      }
    }
  }
}

/**
 * 4倍でレンダリングした画像を等倍へ縮小し、擬似的なアンチエイリアスを得る。
 * @param {{width: number, height: number, data: Uint8ClampedArray}} canvas
 * @param {number} factor
 */
export function downsample(canvas, factor) {
  const width = canvas.width / factor;
  const height = canvas.height / factor;
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error('縮小率がキャンバスサイズを割り切れません');
  }
  const out = createCanvas(width, height);
  const samples = factor * factor;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < factor; sy += 1) {
        for (let sx = 0; sx < factor; sx += 1) {
          const i = ((y * factor + sy) * canvas.width + (x * factor + sx)) * 4;
          const pa = canvas.data[i + 3] / 255;
          r += canvas.data[i] * pa;
          g += canvas.data[i + 1] * pa;
          b += canvas.data[i + 2] * pa;
          a += pa;
        }
      }
      const o = (y * width + x) * 4;
      if (a > 0) {
        out.data[o] = r / a;
        out.data[o + 1] = g / a;
        out.data[o + 2] = b / a;
      }
      out.data[o + 3] = (a / samples) * 255;
    }
  }
  return out;
}
