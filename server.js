// A po pijmë kafe? — server i vogël pa varësi (Node 20+)
const http = require("http");
const fs = require("fs");
const path = require("path");

// .env i thjeshtë
const envFile = path.join(__dirname, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const PORT = Number(process.env.PORT || 3000);
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const MAIL_TO = process.env.MAIL_TO || "";
const MAIL_FROM = process.env.MAIL_FROM || "Kafe <kafe@cmimet.gezimm.com>";
const PUBLIC = path.join(__dirname, "public");
const DATA = path.join(__dirname, "data");
fs.mkdirSync(DATA, { recursive: true });

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

const MONTHS = ["janar", "shkurt", "mars", "prill", "maj", "qershor", "korrik", "gusht", "shtator", "tetor", "nëntor", "dhjetor"];
const DAYS = ["e diel", "e hënë", "e martë", "e mërkurë", "e enjte", "e premte", "e shtunë"];

function fmtDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${DAYS[dt.getUTCDay()]}, ${d} ${MONTHS[m - 1]} ${y}`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// kufi i thjeshtë: 5 konfirmime / orë për IP
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 3600e3);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > 5;
}

function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}

async function sendMail(b) {
  const when = `${fmtDate(b.date)}, ora ${b.time}`;
  const html = `
  <div style="font-family:Georgia,serif;max-width:520px;margin:auto;background:#fff7f2;border-radius:16px;padding:28px;color:#3b1f1a">
    <p style="font-size:40px;margin:0">☕</p>
    <h1 style="font-size:24px;margin:8px 0 4px">${esc(b.name)} tha PO!</h1>
    <p style="margin:0 0 20px;color:#8a5a4f">Kafja u caktua.</p>
    <table style="font-size:16px;border-collapse:collapse">
      <tr><td style="padding:6px 16px 6px 0;color:#8a5a4f">Kush</td><td><b>${esc(b.name)}</b></td></tr>
      <tr><td style="padding:6px 16px 6px 0;color:#8a5a4f">Kur</td><td><b>${esc(when)}</b></td></tr>
      <tr><td style="padding:6px 16px 6px 0;color:#8a5a4f">Ku</td><td><b>${esc(b.place)}</b></td></tr>
      ${b.note ? `<tr><td style="padding:6px 16px 6px 0;color:#8a5a4f;vertical-align:top">Shënim</td><td>${esc(b.note)}</td></tr>` : ""}
    </table>
    <p style="margin-top:22px;font-size:14px;color:#8a5a4f">Para se me thënë “Po”, e shtypi “Jo” ${b.noCount} ${b.noCount === 1 ? "herë" : "herë"}.</p>
  </div>`;
  const text = `${b.name} tha PO!\nKur: ${when}\nKu: ${b.place}${b.note ? `\nShënim: ${b.note}` : ""}\n"Jo" u shtyp ${b.noCount} herë.`;

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: MAIL_FROM, to: [MAIL_TO], subject: `☕ ${b.name} tha PO — ${when}`, html, text }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > 10_000) { reject(new Error("too big")); req.destroy(); }
      else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function todayBelgrade() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Belgrade" }).format(new Date());
}

async function confirm(req, res) {
  const ip = req.headers["cf-connecting-ip"] || req.headers["x-real-ip"] || req.socket.remoteAddress;
  if (limited(ip)) return json(res, 429, { error: "Shumë tentativa. Provo pak më vonë." });
  let b;
  try { b = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: "Të dhëna të pavlefshme." }); }

  const name = String(b.name || "").trim().slice(0, 60);
  const place = String(b.place || "").trim().slice(0, 120);
  const note = String(b.note || "").trim().slice(0, 300);
  const date = String(b.date || "");
  const time = String(b.time || "");
  const noCount = Math.max(0, Math.min(999, parseInt(b.noCount, 10) || 0));

  if (!name) return json(res, 400, { error: "Shkruaje emrin." });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < todayBelgrade()) return json(res, 400, { error: "Zgjidh një datë (sot ose më vonë)." });
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return json(res, 400, { error: "Zgjidh orën." });
  if (!place) return json(res, 400, { error: "Shkruaje vendin." });

  const rec = { name, date, time, place, note, noCount, ip, at: new Date().toISOString() };
  fs.appendFileSync(path.join(DATA, "konfirmimet.jsonl"), JSON.stringify(rec) + "\n");

  try {
    await sendMail(rec);
  } catch (e) {
    console.error("email dështoi:", e.message);
    // u ruajt gjithsesi; mos e prish momentin për personin
    return json(res, 200, { ok: true, mail: false });
  }
  json(res, 200, { ok: true, mail: true });
}

function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/") p = "/index.html";
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) {
      // çdo rrugë tjetër → faqja kryesore
      return fs.readFile(path.join(PUBLIC, "index.html"), (e2, idx) => {
        res.writeHead(e2 ? 404 : 200, { "Content-Type": TYPES[".html"] });
        res.end(e2 ? "404" : idx);
      });
    }
    const ext = path.extname(file);
    res.writeHead(200, {
      "Content-Type": TYPES[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600",
    });
    res.end(buf);
  });
}

http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/confirm") return confirm(req, res).catch((e) => { console.error(e); json(res, 500, { error: "Diçka shkoi keq." }); });
  if (req.method === "GET" && req.url === "/api/health") return json(res, 200, { ok: true });
  if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, res);
  res.writeHead(405); res.end();
}).listen(PORT, "127.0.0.1", () => console.log(`kafe në :${PORT}`));
