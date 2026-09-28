// ─── In-memory state (Render = stateless, ทุกอย่างรีสตาร์ทเมื่อ deploy/restart) ──

const processedVouchers = new Map();   // voucherUrl[:userId] -> timestamp
const voucherProcessing = new Set();   // lock กันยิงซองเดียวกันพร้อมกัน 2 ทาง
const phones = new Map();              // userId -> [เบอร์...]
const userModes = new Map();           // userId -> 'normal' | 'premium'
const serverCount = new Map();         // userId -> จำนวนเซิร์ฟเวอร์ที่เข้าได้ (ยิงก่อนคนที่ได้ประโยชน์มาก)
const balances = new Map();            // userId -> ยอดสะสม (บาท)
const stats = { claimed: 0, failed: 0, outOfStock: 0, lostRace: 0, rateLimited: 0, blocked: 0, vouchers: 0 };
let ownerPhone = '';

function addBalance(userId, amount) {
  balances.set(userId, (balances.get(userId) || 0) + amount);
}
function getBalance(userId) { return balances.get(userId) || 0; }
function incr(key) { stats[key] = (stats[key] || 0) + 1; }
// 429/403 เป็นเหตุชั่วคราว — ล้างทิ้งทุกนาที ไม่งั้นสถิติจะกลายเป็นของตลอดชีวิต
function clearTransient() { stats.rateLimited = 0; stats.blocked = 0; }
function setOwnerPhone(p) { ownerPhone = p; }

// ตัดของเก่าที่หมดอายุออกทุก ๆ N วินาที (Map ไม่มี TTL ในตัว)
function sweep(maxAgeMs = 120000) {
  const now = Date.now();
  for (const [k, ts] of processedVouchers) if (now - ts > maxAgeMs) processedVouchers.delete(k);
}

module.exports = {
  processedVouchers, voucherProcessing, phones, userModes, serverCount, balances, stats,
  addBalance, getBalance, incr, setOwnerPhone, sweep, clearTransient,
  get ownerPhone() { return ownerPhone; },
};
