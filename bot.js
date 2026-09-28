const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");
const axios = require("axios");
const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
require("dotenv").config();
const ui = require("./ui");
const detector = require("./detector");
const shooter = require("./shooter");
const state = require("./state");
const { readQRCode } = require("./qr");

// ตัวยิงซอง/ดีเท็กตอร์/QR ย้ายไป twapi.js, detector.js, qr.js, shooter.js
// ── 🔒 Access key: กันคนอื่นมาใช้บอทผ่าน URL ของ Render ──
const ACCESS_KEY = process.env.ACCESS_KEY || "";

function send(res, status, body) { res.status(status).type("html").send(body); }

function gate(req, res) {
  if (!ACCESS_KEY) return true;
  const provided = req.query.k || req.get("x-access-key") || "";
  if (provided === ACCESS_KEY) return true;
  ui.withKey(ACCESS_KEY);
  send(res, 403, ui.errorPage({
    title: "ต้องใส่รหัสผ่านก่อน",
    message: "ลิงก์นี้ต้องมี ?k=รหัสของคุณ ถ้ายังไม่ได้ตั้ง ให้เพิ่ม ACCESS_KEY ใน Render",
    hint: "ตั้ง Environment Variable ชื่อ <code>ACCESS_KEY</code> แล้วเปิดลิงก์แบบ <code>?k=ค่าที่ตั้ง</code>"
  }));
  return false;
}

const PORT = process.env.PORT || 10000;
const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

let CONFIG = null;
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
    claimed: state.stats.claimed,
    failed: state.stats.failed + state.stats.outOfStock + state.stats.lostRace,
    limited: state.stats.rateLimited + state.stats.blocked,
    vouchers: state.stats.vouchers,
    total: Array.from(state.balances.values()).reduce((a, b) => a + b, 0),
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
  ui.withKey(ACCESS_KEY);
  res.redirect('/' + (ACCESS_KEY ? '?k=' + encodeURIComponent(ACCESS_KEY) : ''));
});

app.post('/send-otp', (req, res) => {
  if (!gate(req, res)) return;
  loginStep = "need-otp";
  ui.withKey(ACCESS_KEY);
  send(res, 200, ui.loginPage({ phone: CONFIG.phoneNumber, step: "need-otp" }));
});

app.post('/verify-otp', (req, res) => {
  if (!gate(req, res)) return;
  otpCode = req.body.otp;
  ui.withKey(ACCESS_KEY);
  send(res, 200, ui.loginPage({ phone: CONFIG.phoneNumber, step: "working" }));
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

// กัน Render สลับเครื่องตอนไม่มี request — ยิง URL ตัวเองทุก 10 นาที
setInterval(() => {
  const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  axios.get(url).catch(() => {});
}, 10 * 60 * 1000);

// ตัดของเก่าใน state + ล้างสถิติชั่วคราว (Render เป็น stateless ทุก restart)
setInterval(() => { state.sweep(); state.clearTransient(); detector.capMemory(); }, 60 * 1000);

// ── ตัวยิงซอง: ใช้ตัวเดียวกับ shooter.js (batch + stop-early + TTL lock) ──
async function processVoucher(voucherUrl, discoveredByMe) {
  await shooter.processVoucher(voucherUrl, discoveredByMe);
}

async function startBot() {
  if (!CONFIG) return;
  if (client) return;

  // ลงทะเบียนตัวเองเป็นบัญชีที่ยิงซองได้ (ใช้กระเป๋า TrueMoney ที่ตั้งไว้)
  const ME = "me";
  state.phones.set(ME, [CONFIG.walletNumber]);
  state.userModes.set(ME, "normal");
  state.serverCount.set(ME, 1);
  if (process.env.OWNER_PHONE) state.setOwnerPhone(process.env.OWNER_PHONE);
  
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

      // 1) รูป QR — decode แล้วเอาลิงก์ซองออกมา
      if (msg.media && msg.media.className === "MessageMediaPhoto") {
        const buffer = await client.downloadMedia(msg.media, { workers: 1 });
        if (buffer) {
          const qrData = await readQRCode(buffer);
          if (qrData) {
            const url = detector.extractVoucherCode(qrData);
            if (url) { state.incr("vouchers"); await processVoucher(url, "me"); }
          }
        }
      }

      // 2) ข้อความ — ลิงก์ตรง หรือโค้ดซองเปล่า
      if (msg.message) {
        const url = detector.extractVoucherCode(msg.message);
        if (url) { state.incr("vouchers"); await processVoucher(url, "me"); }
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
