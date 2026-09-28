// หน้าเว็บทั้งหมดของบอท — แยกจาก logic เพื่อให้แก้สไตล์ได้โดยไม่แตะโค้ดหลัก
const THEME = require("./ui-theme");

const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const page = (title, body) => `<!DOCTYPE html>
<html lang="th"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>${THEME}</style></head>
<body><div class="wrap">${body}</div></body></html>`;

const head = (title, sub) => `
<div class="head">
  <div class="brand">TrueMoney Bot</div>
  <div class="sub"><span class="dot"></span>${esc(sub)}</div>
</div>`;

const steps = (list) => list.map(([b, t], i) =>
  `<div class="step"><i>${i + 1}</i><div><b>${b}</b> — ${t}</div></div>`).join("");

// ── หน้าตั้งค่า ────────────────────────────────────────────────
const setupPage = ({ error }) => page("ตั้งค่าบอท", head("ตั้งค่าบอท", "กรอกข้อมูล Telegram API ของคุณ") + `
<div class="card">
  ${error ? `<div class="note bad">${esc(error)}</div>` : ""}
  ${steps([
    ["สมัคร Telegram API", `ไปที่ <a href="https://my.telegram.org/apps" target="_blank" rel="noopener">my.telegram.org/apps</a> แล้ว Login ด้วยเบอร์ Telegram`],
    ["สร้างแอป", "กรอก App title: <code>TrueMoney Bot</code> · Platform: <code>Desktop</code> · แล้วกด Create application"],
    ["คัดลอกคีย์", "ได้ <code>api_id</code> (ตัวเลข) และ <code>api_hash</code> (รหัสยาว)"],
  ])}
</div>

<div class="card">
  <h2>ข้อมูลของคุณ</h2>
  <form method="POST" action="/save-config${keyQuery}">
    <label>API ID</label>
    <input name="apiId" inputmode="numeric" placeholder="12345678" required>
    <label>API Hash</label>
    <input name="apiHash" placeholder="abc123def456..." required>
    <label>เบอร์ Telegram</label>
    <input name="phoneNumber" placeholder="+66812345678" required>
    <div class="hint">ต้องขึ้นต้นด้วย +66 ไม่ใช่ 0</div>
    <label>เบอร์กระเป๋า TrueMoney Wallet</label>
    <input name="walletNumber" inputmode="numeric" placeholder="0812345678" required>
    <div class="hint">เบอร์ที่รับเงิน ขึ้นต้นด้วย 0</div>
    <label>ชื่อกระเป๋า (ไม่บังคับ)</label>
    <input name="walletName" placeholder="กระเป๋าหลัก">
    <button type="submit">บันทึกและเริ่มใช้งาน</button>
  </form>
  <div class="note">ข้อมูลถูกเก็บในไฟล์ <code>.env</code> บนเครื่องคุณ ไม่ถูกส่งออกไปที่ไหน</div>
</div>`);

// ── หน้า dashboard ─────────────────────────────────────────────
const dashPage = ({ phone, walletName, claimed, failed, total, uptime, mode }) => page("Dashboard", head("TrueMoney Bot", "บอทกำลังทำงาน") + `
<div class="card">
  <div class="stats">
    <div><span>รับสำเร็จ</span><b>${claimed}</b></div>
    <div><span>ล้มเหลว</span><b>${failed}</b></div>
    <div><span>ยอดรวม</span><b>${Number(total).toFixed(2)}฿</b></div>
  </div>
  <div class="kv"><span>โหมด</span><b>${esc(mode)}</b></div>
  <div class="kv"><span>เบอร์ Telegram</span><b>${esc(phone)}</b></div>
  <div class="kv"><span>กระเป๋า</span><b>${esc(walletName)}</b></div>
  <div class="kv"><span>รันมา</span><b>${esc(uptime)}</b></div>
</div>

<div class="card">
  <h2>วิธีใช้</h2>
  <div class="note good">ถ้ามีคนส่งซอง TrueMoney มาในแชทที่บอทอยู่ หรือส่งรูป QR ซองเข้ามา บอทจะจับได้และกดรับให้อัตโนมัติ</div>
  <div class="note warn">ถ้าบอทหยุดทำงานหลังเว็บโหลดใหม่ แปลว่า Render เพิ่งรีสตาร์ท ให้รอสักครู่แล้วกดรีเฟรช</div>
  <form method="POST" action="/stop">
    <button class="danger" type="submit">หยุดบอท</button>
  </form>
  <a href="/save-config${keyQuery}">ตั้งค่าใหม่</a>
</div>
<script>setTimeout(() => location.reload(), 30000)</script>`);

// ── หน้า login ─────────────────────────────────────────────────
const loginPage = ({ phone, step }) => page("Login", head("เข้าสู่ระบบ Telegram", "ยืนยันตัวตน") + `
<div class="card">
  <div class="kv"><span>เบอร์</span><b>${esc(phone)}</b></div>
  ${step === "need-otp" ? `
    <div class="note warn">เปิด Telegram ดูรหัส OTP ที่ Telegram ส่งให้ แล้วกรอกด้านล่าง</div>
    <form method="POST" action="/verify-otp">
      <input name="otp" inputmode="numeric" maxlength="5" placeholder="12345" required autofocus>
      <button type="submit">ยืนยัน OTP</button>
    </form>` : step === "need-password" ? `
    <div class="note warn">บัญชีนี้มี 2FA — กรอกรหัสผ่าน (หรือกดข้ามถ้าไม่ได้ตั้งไว้)</div>
    <form method="POST" action="/verify-2fa">
      <input type="password" name="password" placeholder="รหัส 2FA" autofocus>
      <button type="submit">ยืนยัน</button>
    </form>
    <form method="POST" action="/skip-2fa"><button class="ghost" type="submit">ข้าม</button></form>` : `
    <div class="note">กดปุ่มเพื่อให้บอทส่ง OTP ไปยัง Telegram ของคุณ</div>
    <form method="POST" action="/send-otp"><button type="submit">ส่ง OTP</button></form>`}
</div>
<script>${step === "working" ? "setTimeout(()=>location.reload(),2500)" : ""}</script>`);

// ── หน้า error ─────────────────────────────────────────────────
const errorPage = ({ title, message, hint }) => page("Error", head("เกิดข้อผิดพลาด", title) + `
<div class="card">
  <div class="note bad"><b>${esc(title)}</b><br>${esc(message)}</div>
  ${hint ? `<div class="note warn">${hint}</div>` : ""}
  <a href="/save-config${keyQuery}">ลองตั้งค่าใหม่</a>
</div>`);

let keyQuery = "";
const withKey = (k) => { keyQuery = k ? `?k=${encodeURIComponent(k)}` : ""; return keyQuery; };

module.exports = { esc, page, head, steps, setupPage, dashPage, loginPage, errorPage, withKey };
