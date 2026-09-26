// Cheap per-frame image statistics for the telemetry log: exposure, contrast, sharpness,
// a 64-bit perceptual hash (dHash) for scene-change detection, and the JPEG quality estimate.
import jpeg from 'jpeg-js';

// Standard IJG luminance quantization table (quality 50), in zigzag order.
const STD_LUMA = [16, 11, 12, 14, 12, 10, 16, 14, 13, 14, 18, 17, 16, 19, 24, 40, 26, 24, 22, 22, 24, 49, 35, 37, 29, 40, 58, 51, 61, 60, 57, 51, 56, 55, 64, 72, 92, 78, 64, 68, 87, 69, 55, 56, 80, 109, 81, 87, 95, 98, 103, 104, 103, 62, 77, 113, 121, 112, 100, 120, 92, 101, 103, 99];

/** Estimate the encoder's JPEG quality from its luminance quantization table. */
export function jpegQuality(buf) {
  try {
    let i = 2;
    while (i + 4 < buf.length && buf[i] === 0xff) {
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker === 0xdb) {
        const pq = buf[i + 4] >> 4;
        if (pq !== 0) return null; // 16-bit tables: skip
        let ratio = 0;
        for (let k = 0; k < 64; k++) ratio += (buf[i + 5 + k] * 100) / STD_LUMA[k];
        const scale = ratio / 64;
        const q = scale <= 100 ? (200 - scale) / 2 : 5000 / scale;
        return Math.max(1, Math.min(100, Math.round(q)));
      }
      if (marker === 0xda) break;
      i += 2 + len;
    }
  } catch {
    /* unknown */
  }
  return null;
}

export function imageStats(buf) {
  const t0 = Date.now();
  let img;
  try {
    img = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 256 });
  } catch {
    return null;
  }
  const { width: w, height: h, data } = img;
  // sample a 1/4 grid of luma for speed
  const sw = Math.floor(w / 4), sh = Math.floor(h / 4);
  const g = new Float32Array(sw * sh);
  let sum = 0, rs = 0, gs = 0, bs = 0;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const p = ((y * 4) * w + x * 4) * 4;
      const r = data[p], gg = data[p + 1], b = data[p + 2];
      const l = 0.299 * r + 0.587 * gg + 0.114 * b;
      g[y * sw + x] = l;
      sum += l; rs += r; gs += gg; bs += b;
    }
  }
  const n = sw * sh;
  const mean = sum / n;
  let v = 0;
  for (let k = 0; k < n; k++) v += (g[k] - mean) ** 2;
  // sharpness: variance of the Laplacian
  let lsum = 0, lsq = 0, ln = 0;
  for (let y = 1; y < sh - 1; y++) {
    for (let x = 1; x < sw - 1; x++) {
      const k = y * sw + x;
      const lap = 4 * g[k] - g[k - 1] - g[k + 1] - g[k - sw] - g[k + sw];
      lsum += lap; lsq += lap * lap; ln += 1;
    }
  }
  const lmean = lsum / ln;
  // dHash: 9x8 downsample, compare horizontal neighbours
  let hash = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const a = g[Math.floor(((y + 0.5) * sh) / 8) * sw + Math.floor((x * sw) / 9)];
      const b = g[Math.floor(((y + 0.5) * sh) / 8) * sw + Math.floor(((x + 1) * sw) / 9)];
      hash = (hash << 1n) | (a > b ? 1n : 0n);
    }
  }
  return {
    width: w,
    height: h,
    megapixels: +((w * h) / 1e6).toFixed(2),
    lumaMean: +mean.toFixed(1),
    contrast: +Math.sqrt(v / n).toFixed(1),
    sharpness: +(lsq / ln - lmean * lmean).toFixed(1),
    exposure: mean < 50 ? 'dark' : mean > 205 ? 'bright' : 'ok',
    avgRGB: [Math.round(rs / n), Math.round(gs / n), Math.round(bs / n)],
    dhash: hash.toString(16).padStart(16, '0'),
    statsMs: Date.now() - t0,
  };
}

export function hamming(a, b) {
  if (!a || !b) return null;
  let x = BigInt('0x' + a) ^ BigInt('0x' + b);
  let d = 0;
  while (x) {
    d += Number(x & 1n);
    x >>= 1n;
  }
  return d;
}
