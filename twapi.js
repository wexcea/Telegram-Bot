// ─── TrueMoney Redeem API ────────────────────────────────────────────────────
// หลักการจากบอทจริงของมึง (dak-song-discord/src/twapi.js)
// - hot path: ยิงให้ไวที่สุด ใช้ instance กลางจาก http.js (socket reuse)
// - ไม่มี retry อัตโนมัติ: ซองซ้ำกันด้วย lock อยู่แล้ว retry เสี่ยงโดน CF flag + เปลืองเวลา
// - TrueMoney ตอบ error ผ่าน body (HTTP 400) ต้อง return ไม่ใช่ throw
//   ไม่งั้น caller จะนับซองที่ "หมด/ถูกรีดีม" เป็น error

const { tmClient } = require('./http');

const REDEEM = 'https://gift.truemoney.com/campaign/vouchers/';

function codeFrom(voucherUrl) {
  return String(voucherUrl)
    .replace('https://gift.truemoney.com/campaign/?v=', '')
    .replace(REDEEM, '')
    .replace(/\/redeem$/, '');
}

async function fastTwApi(voucherUrl, phone) {
  const code = codeFrom(voucherUrl);
  try {
    const resp = await tmClient.post(`${REDEEM}${encodeURIComponent(code)}/redeem`, { mobile: `${phone}` });
    return normalize(resp.status, resp.data);
  } catch (error) {
    if (error.response) return normalize(error.response.status, error.response.data);
    return { status: { code: 'NETWORK_ERROR', message: error.message } };
  }
}

// TrueMoney ตอบได้หลายรูปแบบ — ทำให้เป็น schema เดียวเสมอ
//   {status:{code,message}, data:{my_ticket:{amount_baht}}}  = ปกติ
//   429 text/plain                                        = โดนจำกัดอัตรา
//   403 หน้า Cloudflare                                  = โดนบล็อค
function normalize(httpStatus, data) {
  if (data && typeof data === 'object' && data.status) return data;
  const text = typeof data === 'string' ? data : JSON.stringify(data || {});
  if (httpStatus === 429) {
    return { status: { code: 'RATE_LIMITED', message: 'ถูกจำกัดอัตรา (429) — ค่อยยิงใหม่อีกครั้ง' } };
  }
  if (httpStatus === 403 || /Attention Required|Cloudflare/i.test(text)) {
    return { status: { code: 'BLOCKED_403', message: 'โดน Cloudflare บล็อค (403) — TLS/UA ถูกปฏิเสธ' } };
  }
  return { status: { code: `HTTP_${httpStatus}`, message: text.slice(0, 160) } };
}

module.exports = fastTwApi;
module.exports.codeFrom = codeFrom;
