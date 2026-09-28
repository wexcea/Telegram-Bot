// ─── HTTP Client Layer ───────────────────────────────────────────────────────
// หลักการจากบอทจริงของมึง (dak-song-discord/src/http.js)
// - Agent เดียวทั้งระบบ + keepAlive: reuse TCP/TLS handshake ตอนยิงซองรัว ๆ
// - axios instance แยกตามปลายทาง เพื่อให้ timeout/header ต่างกันได้
// - TrueMoney ต้องเป็น UA แบบเบราว์เซอร์ ไม่งั้น Cloudflare ตอบ 403

const axios = require('axios');
const https = require('https');

const KEEP_ALIVE_AGENT = new https.Agent({
  keepAlive: true,
  maxSockets: 30,
  keepAliveMsecs: 3000,
  scheduling: 'lifo',
});

// ⚠️ Cloudflare บล็อค TLS fingerprint ของ Node/fetch ด้วย 403
// agent นี้บังคับ TLSv1.3 ซึ่งผ่านได้ (วัดจริง: axios+TLS1.3 -> 400 จาก TrueMoney, fetch -> 403)
const TM_AGENT = new https.Agent({ maxVersion: 'TLSv1.3', minVersion: 'TLSv1.3', keepAlive: true });

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

const httpClient = axios.create({
  httpsAgent: KEEP_ALIVE_AGENT, timeout: 15000, headers: { 'User-Agent': BROWSER_UA },
});

const tmClient = axios.create({
  httpsAgent: TM_AGENT, timeout: 15000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/84.0.4147.105 Safari/537.36 Edg/84.0.522.52',
    'Content-Type': 'application/json',
    accept: 'application/json',
    'accept-language': 'th-TH,th;q=0.9',
    origin: 'https://gift.truemoney.com',
    referer: 'https://gift.truemoney.com/',
  },
});

module.exports = { KEEP_ALIVE_AGENT, TM_AGENT, BROWSER_UA, httpClient, tmClient };
