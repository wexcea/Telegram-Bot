// ─── Voucher Detector ────────────────────────────────────────────────────────
// หลักการจากบอทจริงของมึง (dak-song-discord/src/detector.js)
// - regex เร็วสุดจับลิงค์ตรง ๆ ก่อน แล้วค่อย fallback ไปหาโค้ดเปล่า
// - โค้ดซองของ TrueMoney ขึ้นต้น 019 / 01a (ปรับรายการนี้ได้ถ้า TrueMoney เปลี่ยน prefix)
// - ไม่มี retry: ซองซ้ำกันด้วย lock อยู่แล้ว retry แค่เสี่ยงโดน Cloudflare flag
// - QR hash + blacklist เก็บใน RAM ล้วน (Render เป็น stateless)

const PREFIXES = ['019', '01a'];                 // prefix ของโค้ดซอง
const MIN_LEN = 20;                              // ควอร์เมตรที่ยาวที่สุดของโค้ดซอง
const MAX_LEN = 64;

// ── ถอดตัวเลขไทยเป็นอังกฤษ (กรณีคนพิมพ์ลิงก์ซองเป็นตัวเลขไทย) ──
const THAI_DIGITS = {
  "ศูนย์": "0", "หนึ่ง": "1", "เอ็ด": "1", "ยี่": "2", "สอง": "2", "สาม": "3", "สี่": "4", "ห้า": "5",
  "หก": "6", "เจ็ด": "7", "แปด": "8", "เก้า": "9", "สิบ": "10", "ยี่สิบ": "20", "ร้อย": "100",
  "พัน": "1000", "หมื่น": "10000", "แสน": "100000", "ล้าน": "1000000",
  "สิบเอ็ด": "11", "สิบสอง": "12", "สิบสาม": "13", "สิบสี่": "14", "สิบห้า": "15", "สิบหก": "16",
  "สิบเจ็ด": "17", "สิบแปด": "18", "สิบเก้า": "19", "ยี่สิบเอ็ด": "21", "ยี่สิบสอง": "22",
  "ยี่สิบสาม": "23", "ยี่สิบสี่": "24", "ยี่สิบห้า": "25", "ยี่สิบหก": "26", "ยี่สิบเจ็ด": "27",
  "ยี่สิบแปด": "28", "ยี่สิบเก้า": "29", "สามสิบ": "30", "สามสิบเอ็ด": "31", "สามสิบสอง": "32",
  "สามสิบสาม": "33", "สามสิบสี่": "34", "สามสิบห้า": "35", "สามสิบหก": "36", "สามสิบเจ็ด": "37",
  "สามสิบแปด": "38", "สามสิบเก้า": "39", "สี่สิบ": "40", "สี่สิบเอ็ด": "41", "สี่สิบสอง": "42",
  "สี่สิบสาม": "43", "สี่สิบสี่": "44", "สี่สิบห้า": "45", "สี่สิบหก": "46", "สี่สิบเจ็ด": "47",
  "สี่สิบแปด": "48", "สี่สิบเก้า": "49", "ห้าสิบ": "50", "ห้าสิบเอ็ด": "51", "ห้าสิบสอง": "52",
  "ห้าสิบสาม": "53", "ห้าสิบสี่": "54", "ห้าสิบห้า": "55", "ห้าสิบหก": "56", "ห้าสิบเจ็ด": "57",
  "ห้าสิบแปด": "58", "ห้าสิบเก้า": "59", "หกสิบ": "60", "หกสิบเอ็ด": "61", "หกสิบสอง": "62",
  "หกสิบสาม": "63", "หกสิบสี่": "64", "หกสิบห้า": "65", "หกสิบหก": "66", "หกสิบเจ็ด": "67",
  "หกสิบแปด": "68", "หกสิบเก้า": "69", "เจ็ดสิบ": "70", "เจ็ดสิบเอ็ด": "71", "เจ็ดสิบสอง": "72",
  "เจ็ดสิบสาม": "73", "เจ็ดสิบสี่": "74", "เจ็ดสิบห้า": "75", "เจ็ดสิบหก": "76", "เจ็ดสิบเจ็ด": "77",
  "เจ็ดสิบแปด": "78", "เจ็ดสิบเก้า": "79", "แปดสิบ": "80", "แปดสิบเอ็ด": "81", "แปดสิบสอง": "82",
  "แปดสิบสาม": "83", "แปดสิบสี่": "84", "แปดสิบห้า": "85", "แปดสิบหก": "86", "แปดสิบเจ็ด": "87",
  "แปดสิบแปด": "88", "แปดสิบเก้า": "89", "เก้าสิบ": "90", "เก้าสิบเอ็ด": "91", "เก้าสิบสอง": "92",
  "เก้าสิบสาม": "93", "เก้าสิบสี่": "94", "เก้าสิบห้า": "95", "เก้าสิบหก": "96", "เก้าสิบเจ็ด": "97",
  "เก้าสิบแปด": "98", "เก้าสิบเก้า": "99",
};
const THAI_KEYS = Object.keys(THAI_DIGITS).sort((a, b) => b.length - a.length);

function hasThai(text) { return /[\u0E00-\u0E7F]/.test(text || ''); }

function decodeThai(text) {
  let out = String(text || '').replace(/\s+/g, "");
  for (const thai of THAI_KEYS) out = out.split(thai).join(THAI_DIGITS[thai]);
  return out.replace(/[^a-zA-Z0-9]/g, "");
}

const qrHashSet = new Set();
const scanLock = new Set();
const urlBlacklistSet = new Set();
const urlPendingSet = new Set();

function extractVoucherCode(text, voucherCodeRegex) {
  if (!text) return null;

  // เร็วสุด: regex ตรง pattern ของ gift.truemoney.com
  const match = text.match(/https:\/\/gift\.truemoney\.com\/campaign\/\?v=([a-zA-Z0-9]+)/);
  if (match && PREFIXES.some(p => match[1].startsWith(p))) return match[0];

  // รองรับโค้ดเปล่า (ไม่มีลิงค์) เช่น "019abc..." ในข้อความ
  if (voucherCodeRegex) {
    const hits = text.match(voucherCodeRegex);
    if (hits) {
      const code = hits.find(c => PREFIXES.some(p => c.startsWith(p)));
      if (code) return `https://gift.truemoney.com/campaign/?v=${code}`;
    }
  }

  return null;
}

// ตัวกรองโค้ดซอง — เข้มกว่าของเดิม: เช็ค prefix + ตัวอักษร/เลข + entropy
function isLikelyVoucher(s) {
  if (!s || typeof s !== 'string') return false;
  if (s.length < MIN_LEN || s.length > MAX_LEN) return false;
  if (!/^[a-zA-Z0-9]+$/.test(s)) return false;
  if (!PREFIXES.some(p => s.startsWith(p))) return false;
  if (!/\d/.test(s) || !/[a-zA-Z]/.test(s)) return false;      // ต้องมีทั้งเลขและตัวอักษร
  const uniq = new Set(s).size;
  return uniq >= 8;                                              // กัน string ซ้ำจริง
}

function rememberQr(hash) {
  if (!hash) return false;
  if (qrHashSet.has(hash)) return false;
  qrHashSet.add(hash);
  return true;
}

function blacklistUrl(url) {
  if (!url) return;
  urlBlacklistSet.add(url);
}

function capMemory(max = 50000) {
  for (const [set, name] of [[qrHashSet, 'qrHashSet'], [scanLock, 'scanLock'],
                             [urlBlacklistSet, 'urlBlacklistSet'], [urlPendingSet, 'urlPendingSet']]) {
    if (set.size <= max) continue;
    const drop = set.size - max;
    let i = 0;
    for (const k of set) { set.delete(k); if (++i >= drop) break; }
    console.log(`[Detect] 🧹 ${name} ตัดให้เหลือ ${max} (ล้าง ${drop})`);
  }
}

module.exports = {
  extractVoucherCode, hasThai, decodeThai, isLikelyVoucher, rememberQr, blacklistUrl, capMemory,
  qrHashSet, scanLock, urlBlacklistSet, urlPendingSet,
  PREFIXES, MIN_LEN, MAX_LEN,
};
