// ─── Shooter: ยิงซองแบบเดียวกับบอทจริงของมึง ────────────────────────────────
// หลักการที่ยกมา:
// 1) ยิงหลายเบอร์/หลายบัญชี "พร้อมกัน" แล้วรอผล — จุดแข่งขันคือความเร็ว ไม่ใช่จำนวน request
// 2) BATCH_SIZE = 10 : ยิงทีละก้อน ถ้าก้อนไหนไม่มีใครได้เลย -> หยุด ไม่ยิงต่อ
// 3) TTL lock กันยิงซองเดิมซ้ำ (ซองซ้ำ = เปลืองเวลา + เสี่ยงโดน flag)
// 4) เรียงลำดับยิง: ผู้ค้นพบก่อน -> OWNER -> VIP (เยอะเซิร์ฟเวอร์ก่อน) -> Normal
// 5) ไม่มี retry อัตโนมัติใน redeem

const twApi = require('./twapi');
const state = require('./state');

const BATCH_SIZE = 10;
const VOUCHER_TTL = 60000;      // ms — ซองเดิมในช่วงนี้ไม่ยิงซ้ำ
const DELAY_PER_USER = 5;       // ms ต่อบัญชี (offset แบบของเดิม)

const log = (...a) => console.log(...a);

function keyFor(voucherUrl, userId, mode) {
  return mode === 'premium' ? `${voucherUrl}:${userId}` : voucherUrl;
}

// ── ยิง 1 ซองให้ 1 บัญชี (หลายเบอร์พร้อมกัน) ──
async function shootVoucherWithPhones(voucherUrl, userId, phones, delay = 0) {
  const mode = state.userModes.get(userId) || 'normal';
  const results = await Promise.allSettled(phones.map(async (phone, i) => {
    await new Promise(r => setTimeout(r, delay + i * DELAY_PER_USER));
    const t0 = Date.now();
    try {
      const result = await twApi(voucherUrl, phone);
      const ms = Date.now() - t0;
      const code = result && result.status ? result.status.code : null;
      if (code === 'SUCCESS' && result.data && result.data.my_ticket) {
        const amount = parseFloat(result.data.my_ticket.amount_baht);
        if (!isFinite(amount)) return { success: false, reason: 'BAD_AMOUNT' };
        state.addBalance(userId, amount);
        state.incr('claimed');
        log(`💰 ${userId} เบอร์${i + 1} รับซอง ${amount}บาท (${ms}ms)`);
        return { success: true, amount };
      }
      if (code === 'VOUCHER_OUT_OF_STOCK') { state.incr('outOfStock'); return { success: false, outOfStock: true }; }
      if (code === 'TARGET_USER_REDEEMED') state.incr('lostRace');
      else if (code === 'RATE_LIMITED') state.incr('rateLimited');
      else if (code === 'BLOCKED_403') state.incr('blocked');
      else state.incr('failed');
      log(`❌ ${userId} เบอร์${i + 1} รับไม่สำเร็จ: ${code}`);
      return { success: false, code };
    } catch (err) {
      state.incr('failed');
      log(`⚠️ ${userId} เบอร์${i + 1} Error: ${err.message}`);
      return { success: false };
    }
  }));
  return { anySuccess: results.some(r => r.status === 'fulfilled' && r.value && r.value.success === true) };
}

// ── เข้าคิว: คนที่เจอซอง -> ทั้งระบบยิงตามลำดับชั้น ──
async function processVoucher(voucherUrl, discoveredUserId) {
  const mode = state.userModes.get(discoveredUserId) || 'normal';
  const key = keyFor(voucherUrl, discoveredUserId, mode);

  const ts = state.processedVouchers.get(key);
  if (ts && Date.now() - ts < VOUCHER_TTL) return;
  if (state.voucherProcessing.has(key)) return;
  state.voucherProcessing.add(key);

  const ts2 = state.processedVouchers.get(key);
  if (ts2 && Date.now() - ts2 < VOUCHER_TTL) { state.voucherProcessing.delete(key); return; }
  state.processedVouchers.set(key, Date.now());

  try {
    const active = Array.from(state.phones.keys());
    const list = [];
    if (active.includes(discoveredUserId)) list.push(discoveredUserId);
    if (mode !== 'premium' && state.ownerPhone) list.push('OWNER');

    const rest = active.filter(u => u !== discoveredUserId);
    const fresh = rest.filter(u => {
      const t = state.processedVouchers.get(`${voucherUrl}:${u}`);
      return !(t && Date.now() - t < VOUCHER_TTL);
    });
    const byCount = (a, b) => (state.serverCount.get(b) || 0) - (state.serverCount.get(a) || 0);
    list.push(...fresh.filter(u => state.userModes.get(u) === 'premium').sort(byCount));
    list.push(...fresh.filter(u => state.userModes.get(u) !== 'premium').sort(byCount));

    log(`🎁 เจอซอง! ${mode === 'premium' ? 'VIP' : 'Normal'} | ยิง ${list.length} บัญชี`);

    const batches = Math.ceil(list.length / BATCH_SIZE);
    for (let i = 0; i < list.length; i += BATCH_SIZE) {
      const batch = list.slice(i, i + BATCH_SIZE);
      const num = Math.floor(i / BATCH_SIZE) + 1;
      const settled = await Promise.allSettled(batch.map((uid, j) => {
        const delay = (i + j) * DELAY_PER_USER;
        if (uid === 'OWNER') return state.shootOwner(voucherUrl, delay);
        return shootVoucherWithPhones(voucherUrl, uid, state.phones.get(uid) || [], delay);
      }));
      const won = settled.some(r => r.status === 'fulfilled' && r.value && r.value.anySuccess === true);
      if (won) continue;

      // ถ้าติด 429/403 แปลว่าปัญหาอยู่ที่เรา ไม่ใช่ที่ซอง -> หยุดปล่อยยิงต่อจะเปลือง
      const infra = state.stats.rateLimited + state.stats.blocked;
      if (infra > 0) {
        log(`⛔ Batch ${num}/${batches} ติด 429/403 จาก TrueMoney — หยุดชั่วคราว (ไม่ใช่ซองหมด)`);
        break;
      }
      log(`🛑 Batch ${num}/${batches} ไม่มีใครได้เลย — หยุดยิง`); break;
    }
  } catch (err) {
    log(`❌ processVoucher error: ${err.message}`);
  } finally {
    state.voucherProcessing.delete(key);
  }
}

module.exports = { shootVoucherWithPhones, processVoucher, BATCH_SIZE, VOUCHER_TTL };
