const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");
const axios = require("axios");
const express = require("express");
const bodyParser = require("body-parser");
const Jimp = require("jimp");
const jsQR = require("jsqr");
const fs = require("fs");
require("dotenv").config();
const ui = require("./ui");

const https = require("https");
const agent = new https.Agent({ maxVersion: "TLSv1.3", minVersion: "TLSv1.3", keepAlive: true });
// ยิง TrueMoney โดยตรง — ต้องใช้ axios เท่านั้น
// fetch (undici) ถูก Cloudflare บล็อค 403 เพราะ TLS fingerprint ต่างจากเบราว์เซอร์
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/84.0.4147.105 Safari/537.36 Edg/84.0.522.52";
const REDEEM_URL = "https://gift.truemoney.com/campaign/vouchers/%s/redeem";

// ========================================
// 🔴 แก้บั๊ก: ตัว proxy เก่า (tw-voucher) ใช้ fetch → โดน CF 403
//    เปลี่ยนเป็นยิงตรงด้วย axios + TLS1.3 agent แทน
// ========================================
async function redeemVoucher(phone, voucher) {
  const url = REDEEM_URL.replace("%s", encodeURIComponent(voucher));
  const res = await axios.post(url, { mobile: phone }, {
    timeout: 20000,
    httpsAgent: agent,
    headers: {
      "User-Agent": BROWSER_UA,
      "Content-Type": "application/json",
      "accept": "application/json",
      "accept-language": "th-TH,th;q=0.9",
      "origin": "https://gift.truemoney.com",
      "referer": "https://gift.truemoney.com/"
    },
    validateStatus: () => true
  });
  return res.data; // { status: { code, message }, data: { my_ticket: { amount_baht } } }
}


// ── 🔒 Access key: กันคนอื่นมาใช้บอทผ่าน URL ของ Render ──
const ACCESS_KEY = process.env.ACCESS_KEY || "";

function send(res, status, body) { res.status(status).type("html").send(body); }

function authOk(req) {
  if (!ACCESS_KEY) return true;                       // ยังไม่ตั้ง key = ปล่อยเข้าได้
  const provided = req.query.k || req.get("x-access-key") || "";
  return provided === ACCESS_KEY;
}

function gate(req, res) {
  if (authOk(req)) return true;
  send(res, 403, ui.errorPage({
    title: "ต้องใส่รหัสผ่านก่อน",
    message: "ลิงก์นี้ต้องมีพารามิเตอร์ ?k=รหัสของคุณ ถ้าไม่มี ให้ตั้งค่า ACCESS_KEY ใน Render",
    hint: "เจ้าของเว็บ: ตั้ง Environment Variable ชื่อ <code>ACCESS_KEY</code> แล้วเปิดลิงก์แบบ <code>https://your-app.onrender.com/?k=ค่าที่ตั้ง</code>"
  }));
  return false;
}

const PORT = process.env.PORT || 10000;
const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

let CONFIG = null;
let totalClaimed = 0;
let totalFailed = 0;
let totalAmount = 0;
let loginStep = "need-config";
let lastError = "";
let denied = false;
let otpCode = "";
let passwordCode = "";
let client = null;

// ── Routing ───────────────────────────────────────────────────
const startedAt = Date.now();
const uptime = () => {
  const s = Math.floor((Date.now() - startedAt) / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h} ชม. ${m} นาที` : `${m} นาที`;
};

function context() {
  return {
    phone: CONFIG ? CONFIG.phoneNumber : "",
    walletName: CONFIG ? CONFIG.walletName : "",
    claimed: totalClaimed,
    failed: totalFailed,
    total: totalAmount,
    uptime: uptime(),
    mode: client ? "กำลังฟัง" : "หยุดอยู่"
  };
}

app.get('/', (req, res) => {
  if (!gate(req, res)) return;
  ui.withKey(ACCESS_KEY);

  if (!CONFIG) return send(res, 200, ui.setupPage({ error: denied ? lastError : "" }));

  if (loginStep === "logged-in") return send(res, 200, ui.dashPage(context()));
  if (loginStep === "login-failed") return send(res, 200, ui.errorPage({
    title: "Login ไม่สำเร็จ",
    message: lastError || "ไม่ทราบสาเหตุ",
    hint: "สาเหตุที่พบบ่อย: API ID / API Hash ผิด, OTP ไม่ถูกต้อง, หรือเซสชันเดิมหมดอายุ",
  }));

  return send(res, 200, ui.loginPage({ phone: CONFIG.phoneNumber, step: loginStep }));
});

app.post('/save-config', async (req, res) => {
  if (!gate(req, res)) return;
  if (client) { try { await client.disconnect(); } catch {} }
  CONFIG = {
    apiId: parseInt(req.body.apiId),
    apiHash: req.body.apiHash,
    phoneNumber: req.body.phoneNumber,
    walletNumber: req.body.walletNumber,
    walletName: req.body.walletName || "กระเป๋าหลัก"
  };
  
  const envContent = `API_ID=${CONFIG.apiId}
API_HASH=${CONFIG.apiHash}
PHONE_NUMBER=${CONFIG.phoneNumber}
WALLET_NUMBER=${CONFIG.walletNumber}
WALLET_NAME=${CONFIG.walletName}`;
  
  fs.writeFileSync('.env', envContent);
  
  ui.withKey(ACCESS_KEY);
  send(res, 200, ui.loginPage({ phone: CONFIG.phoneNumber, step: "working" }));

  setTimeout(() => startBot(), 3000);
});

app.get('/reset', (req, res) => {
  if (!gate(req, res)) return;
  if (client) { try { client.disconnect(); } catch {} client = null; }
  CONFIG = null;
  if (fs.existsSync('.env')) fs.unlinkSync('.env');
  if (fs.existsSync('session.txt')) fs.unlinkSync('session.txt');
  res.redirect('/');
});

app.post('/send-otp', (req, res) => {
  if (!gate(req, res)) return;
  loginStep = "need-otp";

});

app.post('/verify-otp', (req, res) => {
  if (!gate(req, res)) return;
  otpCode = req.body.otp;

});

app.post('/verify-2fa', (req, res) => {
  if (!gate(req, res)) return;
  passwordCode = req.body.password;
  ui.withKey(ACCESS_KEY);
  send(res, 200, ui.loginPage({ phone: CONFIG.phoneNumber, step: "working" }));
});

app.post('/skip-2fa', (req, res) => {
  if (!gate(req, res)) return;
  passwordCode = "";
  ui.withKey(ACCESS_KEY);
  send(res, 200, ui.loginPage({ phone: CONFIG.phoneNumber, step: "working" }));
});

app.post('/stop', (req, res) => {
  if (!gate(req, res)) return;
  if (client) { try { client.disconnect(); } catch {} client = null; }
  loginStep = "need-send-otp";
  ui.withKey(ACCESS_KEY);
  send(res, 200, ui.loginPage({ phone: CONFIG ? CONFIG.phoneNumber : "", step: "need-send-otp" }));
});

app.listen(PORT, () => {
  console.log(`🌐 Server: http://localhost:${PORT}`);
});

setInterval(() => {
  const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  axios.get(url).catch(() => {});
}, 10 * 60 * 1000);

const thaiMap = {"เก้าสิบเก้า":"99","เก้าสิบแปด":"98","เก้าสิบเจ็ด":"97","เก้าสิบหก":"96","เก้าสิบห้า":"95","เก้าสิบสี่":"94","เก้าสิบสาม":"93","เก้าสิบสอง":"92","เก้าสิบเอ็ด":"91","เก้าสิบ":"90","แปดสิบเก้า":"89","แปดสิบแปด":"88","แปดสิบเจ็ด":"87","แปดสิบหก":"86","แปดสิบห้า":"85","แปดสิบสี่":"84","แปดสิบสาม":"83","แปดสิบสอง":"82","แปดสิบเอ็ด":"81","แปดสิบ":"80","เจ็ดสิบเก้า":"79","เจ็ดสิบแปด":"78","เจ็ดสิบเจ็ด":"77","เจ็ดสิบหก":"76","เจ็ดสิบห้า":"75","เจ็ดสิบสี่":"74","เจ็ดสิบสาม":"73","เจ็ดสิบสอง":"72","เจ็ดสิบเอ็ด":"71","เจ็ดสิบ":"70","หกสิบเก้า":"69","หกสิบแปด":"68","หกสิบเจ็ด":"67","หกสิบหก":"66","หกสิบห้า":"65","หกสิบสี่":"64","หกสิบสาม":"63","หกสิบสอง":"62","หกสิบเอ็ด":"61","หกสิบ":"60","ห้าสิบเก้า":"59","ห้าสิบแปด":"58","ห้าสิบเจ็ด":"57","ห้าสิบหก":"56","ห้าสิบห้า":"55","ห้าสิบสี่":"54","ห้าสิบสาม":"53","ห้าสิบสอง":"52","ห้าสิบเอ็ด":"51","ห้าสิบ":"50","สี่สิบเก้า":"49","สี่สิบแปด":"48","สี่สิบเจ็ด":"47","สี่สิบหก":"46","สี่สิบห้า":"45","สี่สิบสี่":"44","สี่สิบสาม":"43","สี่สิบสอง":"42","สี่สิบเอ็ด":"41","สี่สิบ":"40","สามสิบเก้า":"39","สามสิบแปด":"38","สามสิบเจ็ด":"37","สามสิบหก":"36","สามสิบห้า":"35","สามสิบสี่":"34","สามสิบสาม":"33","สามสิบสอง":"32","สามสิบเอ็ด":"31","สามสิบ":"30","ยี่สิบเก้า":"29","ยี่สิบแปด":"28","ยี่สิบเจ็ด":"27","ยี่สิบหก":"26","ยี่สิบห้า":"25","ยี่สิบสี่":"24","ยี่สิบสาม":"23","ยี่สิบสอง":"22","ยี่สิบเอ็ด":"21","ยี่สิบ":"20","สิบเก้า":"19","สิบแปด":"18","สิบเจ็ด":"17","สิบหก":"16","สิบห้า":"15","สิบสี่":"14","สิบสาม":"13","สิบสอง":"12","สิบเอ็ด":"11","สิบ":"10","ศูนย์":"0","หนึ่ง":"1","สอง":"2","สาม":"3","สี่":"4","ห้า":"5","หก":"6","เจ็ด":"7","แปด":"8","เก้า":"9","เอ็ด":"1","ยี่":"2"};

function hasThai(text) {
  return /[\u0E00-\u0E7F]/.test(text);
}

function decodeThai(text) {
  let decoded = text.replace(/\s+/g, "");
  const keys = Object.keys(thaiMap).sort((a, b) => b.length - a.length);
  for (const thai of keys) {
    decoded = decoded.replace(new RegExp(thai, "gi"), thaiMap[thai]);
  }
  return decoded.replace(/[^a-zA-Z0-9]/g, "");
}

function isLikelyVoucher(s) {
  if (!s || s.length < 20 || s.length > 64) return false;
  if (!/^[a-zA-Z0-9]+$/.test(s)) return false;
  // สามารถรูดเบอร์เข้า URL ได้
  return true;
}

async function decodeQR(buffer) {
  try {
    const image = await Jimp.read(buffer);
    const data = {
      data: new Uint8ClampedArray(image.bitmap.data),
      width: image.bitmap.width,
      height: image.bitmap.height
    };
    const code = jsQR(data.data, data.width, data.height);
    return code?.data || null;
  } catch {
    return null;
  }
}

function extractVoucher(text) {
  if (!text) return null;
  const results = [];
  const urlRegex = /https?:\/\/gift\.truemoney\.com\/campaign\/?\??.*?v=([^\s&]+)/gi;
  const matches = [...text.matchAll(urlRegex)];
  for (const match of matches) {
    let voucher = match[1].trim();
    if (hasThai(voucher)) voucher = decodeThai(voucher);
    voucher = voucher.replace(/\s/g, '');
    if (isLikelyVoucher(voucher)) results.push(voucher);
  }
  return results.length > 0 ? results : null;
}

const recentSeen = new Set();

// ========================================
// ⚡ ฟังก์ชันหลัก: ใช้ tw-voucher แทน Proxy
// ========================================
async function processVoucher(voucher) {
  if (recentSeen.has(voucher)) return;
  recentSeen.add(voucher);
  setTimeout(() => recentSeen.delete(voucher), 30000);
  
  console.log(`📥 ${voucher}`);
  
  const phone = CONFIG.walletNumber.replace(/\s/g, '');
  const voucherUrl = `https://gift.truemoney.com/campaign/?v=${voucher}`;
  
  try {
    // ========================================
    // 🔥 ยิง TrueMoney โดยตรง (axios + TLS1.3 agent) — ไม่ผ่าน proxy เก่าที่โดนบล็อค
    // ========================================
    const result = await redeemVoucher(phone, voucher);

    if (result?.status?.code === "SUCCESS" && result?.data?.my_ticket) {
      const amount = parseFloat(result.data.my_ticket.amount_baht);
      totalClaimed++;
      totalAmount += amount;
      console.log(`✅ +${amount}฿`);
    } else {
      totalFailed++;
      console.log(`❌ ${result?.status?.message || result?.message || 'Failed'}`);
    }
  } catch (err) {
    totalFailed++;
    console.log(`❌ ${err.message}`);
  }
}

async function startBot() {
  if (!CONFIG) return;
  if (client) return;
  
  const SESSION_FILE = "session.txt";
  let sessionString = "";
  
  if (fs.existsSync(SESSION_FILE)) {
    sessionString = fs.readFileSync(SESSION_FILE, "utf8").trim();
  }
  
  const session = new StringSession(sessionString);
  client = new TelegramClient(session, CONFIG.apiId, CONFIG.apiHash, {
    connectionRetries: 5,
    useWSS: false,
    autoReconnect: true
  });
  
  console.log("🚀 Starting bot...\n");
  
  try {
    if (sessionString) {
      console.log("🔐 Connecting...");
      await client.start({ 
        botAuthToken: false,
        onError: e => console.error(e.message)
      });
      loginStep = "logged-in";
      console.log("✅ Connected!\n");
    } else {
      console.log("🔐 Login\n");
      loginStep = "need-send-otp";
      
      await client.start({
        phoneNumber: async () => {
          while (loginStep === "need-send-otp") {
            await new Promise(r => setTimeout(r, 1000));
          }
          return CONFIG.phoneNumber;
        },
        password: async () => {
          loginStep = "need-password";
          while (loginStep === "need-password" && passwordCode === "") {
            await new Promise(r => setTimeout(r, 1000));
          }
          return passwordCode || undefined;
        },
        phoneCode: async () => {
          while (!otpCode) {
            await new Promise(r => setTimeout(r, 1000));
          }
          const code = otpCode;
          otpCode = "";
          return code;
        },
        onError: e => console.error(e.message),
      });
      
      const newSession = client.session.save();
      fs.writeFileSync(SESSION_FILE, newSession, "utf8");
      loginStep = "logged-in";
      console.log("\n✅ Login success!\n");
    }
  } catch (err) {
    console.error("❌ Login failed:", err.message);
    loginStep = "login-failed";
    lastError = err.message;
    return;
  }
  
  console.log("👂 Listening...\n");
  
  client.addEventHandler(async (event) => {
    try {
      const msg = event.message;
      if (!msg) return;
      
      if (msg.media?.className === "MessageMediaPhoto") {
        const buffer = await client.downloadMedia(msg.media, { workers: 1 });
        if (buffer) {
          const qrData = await decodeQR(buffer);
          if (qrData) {
            const vouchers = extractVoucher(qrData);
            if (vouchers) {
              for (const v of vouchers) {
                await processVoucher(v);
              }
            }
          }
        }
      }
      
      if (msg.message) {
        const vouchers = extractVoucher(msg.message);
        if (vouchers) {
          for (const v of vouchers) {
            await processVoucher(v);
          }
        }
      }
    } catch (err) {
      console.error("❌", err.message);
    }
  }, new NewMessage({ incoming: true }));
  
  console.log("✅ Bot ready!\n");
}

if (fs.existsSync('.env')) {
  require('dotenv').config();
  if (process.env.API_ID && process.env.API_HASH) {
    CONFIG = {
      apiId: parseInt(process.env.API_ID),
      apiHash: process.env.API_HASH,
      phoneNumber: process.env.PHONE_NUMBER,
      walletNumber: process.env.WALLET_NUMBER,
      walletName: process.env.WALLET_NAME || "กระเป๋าหลัก"
    };
    startBot();
  }
  }
