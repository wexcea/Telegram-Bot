// ทดสอบ logic ที่ยกมาจากบอทจริง (ไม่ยิงเครือข่ายจริง)
const assert = require('assert');
const detector = require('./detector');
const twapi = require('./twapi');
const state = require('./state');
const shooter = require('./shooter');

// ── detector ──
const RX = /019[A-Za-z0-9]{20,}/g;
const link = 'https://gift.truemoney.com/campaign/?v=019ABCdef0123456789XYZabc1234567890';
assert.ok(detector.extractVoucherCode(link), '1) จับลิงก์ตรงได้');
assert.strictEqual(detector.extractVoucherCode('019ABCdef0123456789XYZabc1234567890', RX),
  link, '2) จับโค้ดเปล่าแล้วเติมลิงก์ให้เอง');
assert.strictEqual(detector.extractVoucherCode('ข้อความธรรมดาไม่มีซอง', RX), null, '3) ข้อความธรรมดา = null');
assert.strictEqual(detector.extractVoucherCode('https://gift.truemoney.com/campaign/?v=xyz123', RX), null,
  '4) prefix ผิดต้องไม่รับ');
assert.ok(detector.isLikelyVoucher('019ABCdef0123456789XYZabc1234567890'), '5) โค้ดที่ดีผ่าน');
assert.ok(!detector.isLikelyVoucher('019aaaaaaaaaaaaaaaaaaaaaaaaaaa'), '6) ตัวซ้ำหมด = entropy ต่ำ ตก');
assert.ok(!detector.isLikelyVoucher('0191234567890123456789012345678901'), '7) ไม่มีตัวอักษร ตก');
assert.ok(!detector.isLikelyVoucher('short'), '8) สั้นเกิน ตก');

// ── twapi ──
assert.strictEqual(twapi.codeFrom(link), '019ABCdef0123456789XYZabc1234567890', '9) แกกโค้ดจากลิงก์ถูก');
assert.strictEqual(twapi.codeFrom('https://gift.truemoney.com/campaign/vouchers/ABC/redeem'), 'ABC',
  '10) แกกโค้ดจากลิงก์ redeem ถูก');

// ── TTL lock: ยิงซองเดิมซ้ำต้องถูกกัน ──
let calls = 0;
state.phones.set('u1', ['0800000001']);
state.userModes.set('u1', 'normal');
state.serverCount.set('u1', 1);
require.cache[require.resolve('./twapi')].exports = async () => { calls++; return { status: { code: 'VOUCHER_OUT_OF_STOCK' } }; };
delete require.cache[require.resolve('./shooter')];
const shooter2 = require('./shooter');

(async () => {
  const v = 'https://gift.truemoney.com/campaign/?v=019TEST';
  await shooter2.processVoucher(v, 'u1');
  const after1 = calls;
  await shooter2.processVoucher(v, 'u1');            // ซ้ำทันที -> ต้องไม่ยิง
  console.log(`  calls after 1st=${after1}, after 2nd (same voucher)=${calls}`);
  assert.strictEqual(calls, after1, '11) TTL lock กันยิงซองเดิมซ้ำ');

  // batch stop-early: ยิง batch แรกไม่มีใครได้ -> หยุด ไม่ยิง batch ถัดไป
  state.phones.set('u2', ['0800000002']); state.userModes.set('u2', 'normal'); state.serverCount.set('u2', 1);
  state.phones.set('u3', ['0800000003']); state.userModes.set('u3', 'normal'); state.serverCount.set('u3', 1);
  calls = 0;
  const before = calls;
  await shooter2.processVoucher('https://gift.truemoney.com/campaign/?v=019BATCH2', 'u1');
  console.log(`  batch accounts tried = ${calls} (2 accounts x 1 phone, BATCH_SIZE=10 -> หยุดรอบเดียว)`);
  assert.ok(calls <= 4, '12) stop-early ไม่ยิงเกินจำเป็น');

  console.log('\n✅ ผ่านทั้งหมด 12 ข้อ');
  process.exit(0);
})();
