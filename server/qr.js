// Decode a QR code straight from a glasses photo, so a serial can be read exactly instead of guessed.
import jsQR from 'jsqr';
import jpeg from 'jpeg-js';

/** Returns the QR text, or null. Never throws; a failed decode just means "no code found". */
export function decodeQr(buf) {
  try {
    if (!(buf[0] === 0xff && buf[1] === 0xd8)) return null; // glasses frames are JPEG
    const img = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 256 });
    const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
    return hit?.data?.trim() || null;
  } catch {
    return null;
  }
}
