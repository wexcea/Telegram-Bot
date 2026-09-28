// ธีมสีเทาแบบเว็บ Wexcea (wexcea.site) — โทนเดียวกับ CSS variables ในเว็บหลัก
// --primary #9ca3af / --secondary #6b7280 / --light #e2e8f0 / --dark #374151 / --accent #cbd5e1
module.exports = `
:root{
  --primary:#9ca3af; --secondary:#6b7280; --light:#e2e8f0; --dark:#374151; --accent:#cbd5e1;
  --bg:#0a0a0a; --panel:rgba(31,41,55,.55); --panel-solid:#1f2937; --line:rgba(156,163,175,.18);
  --ok:#9ca3af; --bad:#6b7280; --warn:#cbd5e1; --txt:#f3f4f6; --muted:#9ca3af;
  --radius:16px; --shadow:0 20px 60px rgba(0,0,0,.45);
}
*{margin:0;padding:0;box-sizing:border-box}
body{
  font-family:'Inter','Sarabun','Noto Sans Thai',system-ui,sans-serif;
  background:var(--bg); color:var(--txt); min-height:100vh;
  display:flex; justify-content:center; align-items:flex-start; padding:24px 16px 60px;
  background-image:linear-gradient(135deg,rgba(148,163,184,.10),rgba(71,85,105,.16),rgba(0,0,0,.92));
  background-attachment:fixed;
}
body::before{
  content:''; position:fixed; inset:0; z-index:-1; pointer-events:none;
  background:radial-gradient(900px 500px at 50% -10%,rgba(156,163,175,.16),transparent 70%);
}
.wrap{width:100%; max-width:520px}
.head{text-align:center; margin-bottom:26px}
.brand{
  font-family:'Outfit','Space Grotesk',sans-serif; font-weight:800; letter-spacing:-1.5px;
  font-size:clamp(2rem,7vw,2.9rem); line-height:1.05;
  background:linear-gradient(45deg,var(--dark),var(--primary),var(--light));
  -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text;
  animation:glow 2.4s ease-in-out infinite alternate;
}
@keyframes glow{from{filter:brightness(.92)}to{filter:brightness(1.18)}}
.sub{color:var(--muted); font-size:14px; margin-top:6px}
.card{
  background:var(--panel); border:1px solid var(--line); border-radius:var(--radius);
  backdrop-filter:blur(14px); -webkit-backdrop-filter:blur(14px);
  padding:26px 22px; box-shadow:var(--shadow); margin-bottom:18px;
  animation:rise .55s ease-out both;
}
@keyframes rise{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
h2{font-size:15px; font-weight:600; color:var(--light); letter-spacing:.4px;
   padding-bottom:10px; margin:22px 0 12px; border-bottom:1px solid var(--line); text-transform:uppercase}
h2:first-of-type{margin-top:0}
label{display:block; font-size:13px; font-weight:600; color:var(--accent); margin:16px 0 6px; letter-spacing:.2px}
.hint{font-size:12px; color:var(--muted); margin-top:5px}
input{
  width:100%; padding:14px 15px; font-size:15px; font-family:inherit; color:var(--txt);
  background:rgba(10,10,10,.55); border:1px solid var(--line); border-radius:11px; outline:none;
  transition:border-color .25s, box-shadow .25s;
}
input:focus{border-color:var(--primary); box-shadow:0 0 0 3px rgba(156,163,175,.15)}
input::placeholder{color:#5b6472}
button{
  width:100%; margin-top:12px; padding:15px; font-size:15px; font-weight:700; font-family:inherit;
  color:#0a0a0a; cursor:pointer; border:none; border-radius:11px;
  background:linear-gradient(135deg,var(--primary),var(--light));
  transition:transform .18s, box-shadow .18s, opacity .18s;
}
button:hover{transform:translateY(-2px); box-shadow:0 12px 26px rgba(156,163,175,.28)}
button:disabled{opacity:.5; cursor:not-allowed; transform:none}
button.ghost{background:transparent; color:var(--accent); border:1px solid var(--line); box-shadow:none}
button.ghost:hover{background:rgba(156,163,175,.10); color:var(--txt)}
button.danger{background:linear-gradient(135deg,var(--dark),var(--secondary)); color:var(--light)}
.note{
  font-size:13.5px; line-height:1.65; padding:13px 15px; border-radius:11px; margin:14px 0;
  background:rgba(156,163,175,.09); border-left:3px solid var(--primary); color:var(--light);
}
.note.warn{border-left-color:var(--warn); background:rgba(203,213,225,.07)}
.note.bad{border-left-color:#9ca3af; background:rgba(107,114,128,.13); color:var(--light)}
.note.good{border-left-color:var(--light); background:rgba(226,232,240,.10)}
.stats{display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin:6px 0 4px}
.stats div{background:rgba(10,10,10,.45); border:1px solid var(--line); border-radius:13px;
           padding:16px 8px; text-align:center}
.stats b{display:block; font-size:26px; font-weight:800; color:var(--light); margin-top:6px; letter-spacing:-.5px}
.stats span{font-size:11px; color:var(--muted); letter-spacing:.5px; text-transform:uppercase}
.kv{font-size:13.5px; color:var(--muted); margin-top:9px; display:flex; justify-content:space-between; gap:12px}
.kv b{color:var(--light); font-weight:600; text-align:right; word-break:break-all}
.dot{display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--primary); margin-right:7px;
     box-shadow:0 0 10px var(--primary); animation:pulse 1.8s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:.4}50%{opacity:1}}
code{font-family:ui-monospace,Menlo,Consolas,monospace; font-size:12.5px;
     background:var(--panel-solid); color:var(--light); padding:3px 8px; border-radius:6px}
.step{display:flex; gap:12px; align-items:flex-start; margin-bottom:14px; font-size:13.5px; color:var(--muted); line-height:1.6}
.step i{flex:0 0 26px; height:26px; border-radius:50%; background:var(--primary); color:#0a0a0a;
         font-style:normal; font-weight:800; font-size:13px; display:flex; align-items:center; justify-content:center}
.step b{color:var(--light)}
a{color:var(--primary); font-weight:600; text-decoration:none}
a:hover{text-decoration:underline; color:var(--light)}
`;
