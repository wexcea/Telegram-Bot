// ─── QR Decoder ──────────────────────────────────────────────────────────────
// หลักการจากบอทจริงของมึง: lazy-load + ไม่โยน error
// - โหลด jimp/jsqr ตอนเจอภาพจริง ไม่กิน RAM ตอนบอทว่าง
// - decode ไม่สำเร็จ = ไม่ใช่ QR -> เงียบ

let mods = null;
async function load() {
  if (mods) return mods;
  try {
    mods = { Jimp: require('jimp'), jsQR: require('jsqr') };
  } catch (e) {
    console.warn('[QR] ⚠️ โหลด jimp/jsqr ไม่ได้:', e.message);
    mods = null;
  }
  return mods;
}

async function readQRCode(buffer) {
  const m = await load();
  if (!m) return null;
  try {
    const image = await m.Jimp.read(buffer);
    const code = m.jsQR(
      new Uint8ClampedArray(image.bitmap.data),
      image.bitmap.width,
      image.bitmap.height
    );
    return code ? code.data : null;
  } catch {
    return null;
  }
}

module.exports = { readQRCode };
