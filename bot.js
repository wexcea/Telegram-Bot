// ═══════════════════════════════════════════════════════════════
//  TrueMoney Auto Claim — บอทดักซองในแชท Telegram แล้วกดรับให้กระเป๋าตัวเอง
//  คนเดียวต่อ 1 instance: ตั้งกระเป๋าเอง -> login -> บอทดัก -> กดรับ
// ═══════════════════════════════════════════════════════════════
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");
const axios = require("axios");
const https = require("https");
const express = require("express");
const bodyParser = require("body-parser");
const Jimp = require("jimp");
const jsQR = require("jsqr");
const fs = require("fs");
require("dotenv").config();

const PORT = process.env.PORT || 10000;
const ACCESS_KEY = process.env.ACCESS_KEY || "";   // ตั้งใน Render กันคนอื่นมาใช้บอท
const REDEEM = "https://gift.truemoney.com/campaign/vouchers/";

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// ── ยิง TrueMoney ────────────────────────────────────────────────
// ต้องใช้ axios + TLS1.3 agent + User-Agent แบบเบราว์เซอร์
// fetch ของ Node ถูก Cloudflare ตอบ 403 เพราะ TLS fingerprint ต่างจากเบราว์เซอร์
// error ของ TrueMoney มาทาง body (HTTP 400) ต้องคืนค่า ไม่โยน error
const TM_AGENT = new https.Agent({ maxVersion: "TLSv1.3", minVersion: "TLSv1.3", keepAlive: true });
const tmClient = axios.create({
  httpsAgent: TM_AGENT,
  timeout: 15000,
  headers: {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/84.0.4147.105 Safari/537.36 Edg/84.0.522.52",
    "Content-Type": "application/json",
    accept: "application/json",
    "accept-language": "th-TH,th;q=0.9",
    origin: "https://gift.truemoney.com",
    referer: "https://gift.truemoney.com/"
  }
});

async function redeem(code) {
  try {
    const r = await tmClient.post(REDEEM + encodeURIComponent(code) + "/redeem", { mobile: `${CONFIG.walletNumber}` });
    return normalize(r.status, r.data);
  } catch (err) {
    if (err.response) return normalize(err.response.status, err.response.data);
    return { status: { code: "NETWORK_ERROR", message: err.message } };
  }
}

function normalize(httpStatus, data) {
  if (data && typeof data === "object" && data.status) return data;
  const text = typeof data === "string" ? data : JSON.stringify(data || {});
  if (httpStatus === 429) return { status: { code: "RATE_LIMITED", message: "ถูกจำกัดอัตรา ค่อยยิงใหม่" } };
  if (httpStatus === 403 || /Attention Required|Cloudflare/i.test(text)) {
    return { status: { code: "BLOCKED_403", message: "โดน Cloudflare บล็อค" } };
  }
  return { status: { code: "HTTP_" + httpStatus, message: text.slice(0, 140) } };
}

// ── ดูดซองจากข้อความ/QR ──────────────────────────────────────────
const PREFIXES = ["019", "01a"];

function extractVoucher(text) {
  if (!text) return null;
  const m = text.match(/https:\/\/gift\.truemoney\.com\/campaign\/\?v=([a-zA-Z0-9]+)/);
  if (m) return PREFIXES.some(p => m[1].startsWith(p)) ? m[1] : null;
  const bare = text.match(/[a-zA-Z0-9]{20,64}/g) || [];
  const code = bare.find(c => PREFIXES.some(p => c.startsWith(p)) && /\d/.test(c) && /[a-zA-Z]/.test(c));
  return code || null;
}

async function readQR(buffer) {
  try {
    const img = await Jimp.read(buffer);
    const r = jsQR(new Uint8ClampedArray(img.bitmap.data), img.bitmap.width, img.bitmap.height);
    return r ? r.data : null;
  } catch { return null; }
}

// ── สถานะ ───────────────────────────────────────────────────────
let CONFIG = null;
let client = null;
let loginStep = "need-config";
let lastError = "";
let otpCode = "";
let passwordCode = "";
let claimed = 0, failed = 0, total = 0, seenCount = 0;
const startedAt = Date.now();
const handled = new Set();               // กันยิงซองเดิมซ้ำ (60 วินาที)

function saveEnv() {
  fs.writeFileSync(".env",
    `API_ID=${CONFIG.apiId}\nAPI_HASH=${CONFIG.apiHash}\nPHONE_NUMBER=${CONFIG.phoneNumber}\n` +
    `WALLET_NUMBER=${CONFIG.walletNumber}\nWALLET_NAME=${CONFIG.walletName}`);
}

async function handleVoucher(code) {
  if (handled.has(code)) return;
  handled.add(code);
  setTimeout(() => handled.delete(code), 60000);

  seenCount++;
  console.log("เจอซอง: " + code);
  const r = await redeem(code);
  if (r.status && r.status.code === "SUCCESS" && r.data && r.data.my_ticket) {
    const amount = parseFloat(r.data.my_ticket.amount_baht);
    if (isFinite(amount)) {
      claimed++; total += amount;
      console.log("รับซอง " + amount + " บาท | ยอดสะสม " + total.toFixed(2) + " บาท");
      return;
    }
  }
  failed++;
  console.log("รับไม่สำเร็จ: " + ((r.status && r.status.message) || "ไม่ทราบสาเหตุ"));
}

// ── หน้าเว็บ (ธีมเทาแบบ wexcea.site) ─────────────────────────────
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const CSS = `
:root{--primary:#9ca3af;--secondary:#6b7280;--light:#e2e8f0;--dark:#374151;--accent:#cbd5e1}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter','Sarabun','Noto Sans Thai',system-ui,sans-serif;background:#0a0a0a;color:#f3f4f6;
min-height:100vh;display:flex;justify-content:center;align-items:flex-start;padding:24px 16px 60px;
background-image:linear-gradient(135deg,rgba(148,163,184,.10),rgba(71,85,105,.16),rgba(0,0,0,.92));background-attachment:fixed}
body::before{content:'';position:fixed;inset:0;z-index:-1;background:radial-gradient(900px 500px at 50% -10%,rgba(156,163,175,.16),transparent 70%)}
.wrap{width:100%;max-width:520px}
.brand{font-family:'Outfit','Space Grotesk',sans-serif;font-weight:800;letter-spacing:-1.5px;font-size:clamp(2rem,7vw,2.9rem);
line-height:1.05;background:linear-gradient(45deg,var(--dark),var(--primary),var(--light));-webkit-background-clip:text;
-webkit-text-fill-color:transparent;background-clip:text;animation:glow 2.4s ease-in-out infinite alternate;text-align:center}
@keyframes glow{from{filter:brightness(.92)}to{filter:brightness(1.18)}}
.sub{color:var(--primary);font-size:14px;margin-top:6px;text-align:center}
.card{background:rgba(31,41,55,.55);border:1px solid rgba(156,163,175,.18);border-radius:16px;backdrop-filter:blur(14px);
-webkit-backdrop-filter:blur(14px);padding:26px 22px;box-shadow:0 20px 60px rgba(0,0,0,.45);margin:18px 0;animation:rise .55s ease-out both}
@keyframes rise{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
h2{font-size:14px;font-weight:600;color:var(--light);letter-spacing:.4px;padding-bottom:10px;margin:0 0 14px;
border-bottom:1px solid rgba(156,163,175,.18);text-transform:uppercase}
label{display:block;font-size:13px;font-weight:600;color:var(--accent);margin:15px 0 6px}
.hint{font-size:12px;color:var(--primary);margin-top:5px}
input{width:100%;padding:14px 15px;font-size:15px;font-family:inherit;color:#f3f4f6;background:rgba(10,10,10,.55);
border:1px solid rgba(156,163,175,.18);border-radius:11px;outline:none;transition:border-color .25s,box-shadow .25s}
input:focus{border-color:var(--primary);box-shadow:0 0 0 3px rgba(156,163,175,.15)}
button{width:100%;margin-top:12px;padding:15px;font-size:15px;font-weight:700;font-family:inherit;color:#0a0a0a;cursor:pointer;
border:none;border-radius:11px;background:linear-gradient(135deg,var(--primary),var(--light));transition:transform .18s,box-shadow .18s}
button:hover{transform:translateY(-2px);box-shadow:0 12px 26px rgba(156,163,175,.28)}
button.ghost{background:transparent;color:var(--accent);border:1px solid rgba(156,163,175,.18)}
button.danger{background:linear-gradient(135deg,var(--dark),var(--secondary));color:var(--light)}
.note{font-size:13.5px;line-height:1.65;padding:13px 15px;border-radius:11px;margin:14px 0;background:rgba(156,163,175,.09);
border-left:3px solid var(--primary);color:var(--light)}
.note.bad{border-left-color:var(--secondary);background:rgba(107,114,128,.16)}
.note.good{background:rgba(226,232,240,.10)}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.stats div{background:rgba(10,10,10,.45);border:1px solid rgba(156,163,175,.18);border-radius:13px;padding:16px 8px;text-align:center}
.stats b{display:block;font-size:25px;font-weight:800;color:var(--light);margin-top:6px}
.stats span{font-size:11px;color:var(--primary);letter-spacing:.5px;text-transform:uppercase}
.kv{font-size:13.5px;color:var(--primary);margin-top:9px;display:flex;justify-content:space-between;gap:12px}
.kv b{color:var(--light);font-weight:600;text-align:right;word-break:break-all}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--primary);margin-right:7px;box-shadow:0 0 10px var(--primary)}
.step{display:flex;gap:12px;align-items:flex-start;margin-bottom:13px;font-size:13.5px;color:var(--primary);line-height:1.6}
.step i{flex:0 0 26px;height:26px;border-radius:50%;background:var(--primary);color:#0a0a0a;font-style:normal;font-weight:800;
font-size:13px;display:flex;align-items:center;justify-content:center}
.step b{color:var(--light)}
a{color:var(--primary);font-weight:600;text-decoration:none}
code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px;background:var(--dark);color:var(--light);padding:3px 8px;border-radius:6px}
`;

const page = (title, body) => `<!DOCTYPE html>
<html lang="th"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>${esc(title)}</title><style>${CSS}</style></head><body><div class="wrap">${body}</div></body></html>`;

const head = sub => `<div class="brand">TrueMoney Bot</div><div class="sub"><span class="dot"></span>${esc(sub)}</div>`;
const keyQ = () => (ACCESS_KEY ? "?k=" + encodeURIComponent(ACCESS_KEY) : "");

function setupPage(err) {
  return page("ตั้งค่าบอท", head("กรอกข้อมูลของคุณ") + `
<div class="card">
  ${err ? `<div class="note bad">${esc(err)}</div>` : ""}
  <h2>ขั้นตอนที่ 1 — สมัคร Telegram API</h2>
  <div class="step"><i>1</i><div>ไปที่ <a href="https://my.telegram.org/apps" target="_blank" rel="noopener">my.telegram.org/apps</a> แล้ว Login ด้วยเบอร์ Telegram</div></div>
  <div class="step"><i>2</i><div>กรอก App title: <code>TrueMoney Bot</code> · Platform: <code>Desktop</code></div></div>
  <div class="step"><i>3</i><div>กด Create application แล้วคัดลอก <b>api_id</b> กับ <b>api_hash</b></div></div>
</div>
<div class="card">
  <h2>ขั้นตอนที่ 2 — กรอกข้อมูล</h2>
  <form method="POST" action="/save-config${keyQ()}">
    <label>API ID</label><input name="apiId" inputmode="numeric" placeholder="12345678" required>
    <label>API Hash</label><input name="apiHash" placeholder="abc123def456" required>
    <label>เบอร์ Telegram</label><input name="phoneNumber" placeholder="+66812345678" required>
    <div class="hint">ขึ้นต้นด้วย +66 ไม่ใช่ 0</div>
    <label>เบอร์กระเป๋า TrueMoney</label><input name="walletNumber" inputmode="numeric" placeholder="0812345678" required>
    <div class="hint">เบอร์ที่รับเงิน ขึ้นต้นด้วย 0</div>
    <label>ชื่อกระเป๋า (ไม่บังคับ)</label><input name="walletName" placeholder="กระเป๋าหลัก">
    <button type="submit">บันทึกและเริ่มใช้งาน</button>
  </form>
</div>`);
}

function dashPage() {
  const min = Math.floor((Date.now() - startedAt) / 60000);
  return page("Dashboard", head("บอทกำลังทำงาน") + `
<div class="card">
  <div class="stats">
    <div><span>เจอซอง</span><b>${seenCount}</b></div>
    <div><span>รับสำเร็จ</span><b>${claimed}</b></div>
    <div><span>ยอดรวม</span><b>${total.toFixed(2)}฿</b></div>
  </div>
  <div class="kv"><span>สถานะ</span><b>${client ? "กำลังดักซอง" : "หยุดอยู่"}</b></div>
  <div class="kv"><span>เบอร์ Telegram</span><b>${esc(CONFIG.phoneNumber)}</b></div>
  <div class="kv"><span>กระเป๋ารับเงิน</span><b>${esc(CONFIG.walletNumber)}</b></div>
  <div class="kv"><span>รันมา</span><b>${min} นาที</b></div>
</div>
<div class="card">
  <h2>วิธีใช้</h2>
  <div class="note good">คนที่ส่งซอง TrueMoney มาในแชทที่บอทอยู่ หรือส่งรูป QR ซองเข้ามา บอทจะจับได้และกดรับให้อัตโนมัติ</div>
  <div class="note">ถ้านับไม่ขึ้น แปลว่าซองถูกคนอื่นกดไปก่อนแล้ว</div>
  <form method="POST" action="/reset${keyQ()}"><button class="danger" type="submit">ตั้งค่าใหม่</button></form>
</div>
<script>setTimeout(()=>location.reload(),30000)</script>`);
}

function loginPage(step) {
  const body = {
    "need-send-otp": `<div class="note">กดปุ่มเพื่อให้บอทส่ง OTP ไปยัง Telegram ของคุณ</div>
      <form method="POST" action="/send-otp${keyQ()}"><button type="submit">ส่ง OTP</button></form>`,
    "need-otp": `<div class="note">เปิด Telegram ดูรหัส OTP ที่ระบบส่งให้ แล้วกรอกด้านล่าง</div>
      <form method="POST" action="/verify-otp${keyQ()}"><input name="otp" inputmode="numeric" maxlength="5" placeholder="12345" required autofocus>
      <button type="submit">ยืนยัน OTP</button></form>`,
    "need-password": `<div class="note">บัญชีนี้มีรหัสผ่านสองชั้น — กรอกรหัส หรือกดข้ามถ้าไม่ได้ตั้งไว้</div>
      <form method="POST" action="/verify-2fa${keyQ()}"><input type="password" name="password" autofocus><button type="submit">ยืนยัน</button></form>
      <form method="POST" action="/skip-2fa${keyQ()}"><button class="ghost" type="submit">ข้าม</button></form>`,
    "working": `<div class="note">กำลังเชื่อมต่อ Telegram...</div><script>setTimeout(()=>location.reload(),2500)</script>`
  }[step] || `<div class="note">กำลังเริ่มต้น...</div><script>setTimeout(()=>location.reload(),3000)</script>`;

  return page("Login", head("ยืนยันตัวตน") + `
<div class="card">
  <div class="kv"><span>เบอร์</span><b>${esc(CONFIG.phoneNumber)}</b></div>
  ${body}
</div>`);
}

const send = (res, code, body) => res.status(code).type("html").send(body);

function gate(req, res) {
  if (!ACCESS_KEY) return true;
  if ((req.query.k || req.get("x-access-key") || "") === ACCESS_KEY) return true;
  send(res, 403, page("ต้องใส่รหัสผ่าน", head("ต้องใส่รหัสผ่านก่อน") +
    `<div class="card"><div class="note bad">ลิงก์นี้ต้องมี ?k=รหัสของคุณ<br>ถ้ายังไม่ได้ตั้ง ให้เพิ่ม ACCESS_KEY ใน Render</div></div>`));
  return false;
}

app.get("/", (req, res) => {
  if (!gate(req, res)) return;
  if (!CONFIG) return send(res, 200, setupPage(""));
  if (loginStep === "logged-in") return send(res, 200, dashPage());
  if (loginStep === "login-failed") return send(res, 200, page("ผิดพลาด", head("Login ไม่สำเร็จ") +
    `<div class="card"><div class="note bad">${esc(lastError)}</div>
     <div class="note">สาเหตุที่พบบ่อย: API ID / API Hash ผิด, OTP ไม่ถูกต้อง, หรือเซสชันเดิมหมดอายุ</div>
     <form method="POST" action="/reset${keyQ()}"><button class="danger" type="submit">ตั้งค่าใหม่</button></form></div>`));
  send(res, 200, loginPage(loginStep));
});

app.post("/save-config", (req, res) => {
  if (!gate(req, res)) return;
  if (client) { try { client.disconnect(); } catch {} client = null; }
  CONFIG = {
    apiId: parseInt(req.body.apiId),
    apiHash: req.body.apiHash,
    phoneNumber: req.body.phoneNumber,
    walletNumber: req.body.walletNumber,
    walletName: req.body.walletName || "กระเป๋าหลัก"
  };
  if (!CONFIG.apiId || isNaN(CONFIG.apiId)) return send(res, 200, setupPage("API ID ไม่ถูกต้อง"));
  saveEnv();
  send(res, 200, loginPage("working"));
  setTimeout(startBot, 2500);
});

app.post("/send-otp", (req, res) => {
  if (!gate(req, res)) return;
  loginStep = "need-otp";
  send(res, 200, loginPage("need-otp"));
});

app.post("/verify-otp", (req, res) => {
  if (!gate(req, res)) return;
  otpCode = req.body.otp;
  send(res, 200, loginPage("working"));
});

app.post("/verify-2fa", (req, res) => {
  if (!gate(req, res)) return;
  passwordCode = req.body.password;
  send(res, 200, loginPage("working"));
});

app.post("/skip-2fa", (req, res) => {
  if (!gate(req, res)) return;
  passwordCode = "";
  send(res, 200, loginPage("working"));
});

app.post("/reset", (req, res) => {
  if (!gate(req, res)) return;
  if (client) { try { client.disconnect(); } catch {} client = null; }
  CONFIG = null;
  if (fs.existsSync(".env")) fs.unlinkSync(".env");
  if (fs.existsSync("session.txt")) fs.unlinkSync("session.txt");
  res.redirect(keyQ() ? "/" + keyQ() : "/");
});

app.listen(PORT, () => console.log("Server: http://localhost:" + PORT));

// กัน Render สลับเครื่องตอนไม่มี request
setInterval(() => {
  axios.get(process.env.RENDER_EXTERNAL_URL || ("http://localhost:" + PORT)).catch(() => {});
}, 10 * 60 * 1000);

// ── Telegram ─────────────────────────────────────────────────────
async function startBot() {
  if (!CONFIG || client) return;
  let sessionString = "";
  if (fs.existsSync("session.txt")) sessionString = fs.readFileSync("session.txt", "utf8").trim();

  client = new TelegramClient(new StringSession(sessionString), CONFIG.apiId, CONFIG.apiHash, {
    connectionRetries: 5, useWSS: false, autoReconnect: true
  });

  try {
    if (sessionString) {
      console.log("กำลังเชื่อมต่อด้วยเซสชันเดิม...");
      await client.start({ botAuthToken: false, onError: e => console.error(e.message) });
    } else {
      console.log("กำลัง login...");
      loginStep = "need-send-otp";
      await client.start({
        phoneNumber: async () => {
          while (loginStep === "need-send-otp") await new Promise(r => setTimeout(r, 1000));
          return CONFIG.phoneNumber;
        },
        password: async () => {
          loginStep = "need-password";
          while (loginStep === "need-password" && passwordCode === "") await new Promise(r => setTimeout(r, 1000));
          return passwordCode || undefined;
        },
        phoneCode: async () => {
          while (!otpCode) await new Promise(r => setTimeout(r, 1000));
          const c = otpCode; otpCode = ""; return c;
        },
        onError: e => console.error(e.message)
      });
      fs.writeFileSync("session.txt", client.session.save(), "utf8");
    }
    loginStep = "logged-in";
    console.log("เชื่อมต่อสำเร็จ กำลังดักซอง");
  } catch (err) {
    loginStep = "login-failed";
    lastError = err.message;
    console.error("Login ไม่สำเร็จ:", err.message);
    return;
  }

  client.addEventHandler(async (event) => {
    try {
      const msg = event.message;
      if (!msg) return;

      if (msg.media && msg.media.className === "MessageMediaPhoto") {
        const buffer = await client.downloadMedia(msg.media, { workers: 1 });
        if (buffer) {
          const code = extractVoucher(await readQR(buffer));
          if (code) await handleVoucher(code);
        }
      }

      if (msg.message) {
        const code = extractVoucher(msg.message);
        if (code) await handleVoucher(code);
      }
    } catch (err) {
      console.error("ข้อผิดพลาด:", err.message);
    }
  }, new NewMessage({ incoming: true }));
}

if (fs.existsSync(".env") && process.env.API_ID && process.env.API_HASH) {
  CONFIG = {
    apiId: parseInt(process.env.API_ID),
    apiHash: process.env.API_HASH,
    phoneNumber: process.env.PHONE_NUMBER,
    walletNumber: process.env.WALLET_NUMBER,
    walletName: process.env.WALLET_NAME || "กระเป๋าหลัก"
  };
  startBot();
}
