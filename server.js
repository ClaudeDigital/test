// A po pijmë kafe? (test) — lojë pa fund + statistika + njoftim Telegram (Node 20+, pa varësi)
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const envFile = path.join(__dirname, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const PORT = Number(process.env.PORT || 3000);
const TG_TOKEN = process.env.TELEGRAM_TOKEN || "";
const TG_CHAT = process.env.TELEGRAM_CHAT_ID || "";
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "admin123";
const PUBLIC = path.join(__dirname, "public");
const DATA = path.join(__dirname, "data");
const STATS = path.join(DATA, "stats.json");
fs.mkdirSync(DATA, { recursive: true });

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};

// ---------- ruajtja ----------
let db = { visits: [] };
try { db = JSON.parse(fs.readFileSync(STATS, "utf8")); } catch {}
if (!Array.isArray(db.visits)) db.visits = [];
let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const tmp = STATS + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, STATS);
  }, 500);
}
const byId = (id) => db.visits.find((v) => v.id === id);

// ---------- ndihmës ----------
function json(res, code, obj, headers = {}) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(obj));
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
async function body(req) { try { return JSON.parse(await readBody(req) || "{}"); } catch { return {}; } }
const ipOf = (req) => req.headers["cf-connecting-ip"] || req.headers["x-real-ip"] || req.socket.remoteAddress;
function cookies(req) {
  const out = {};
  for (const p of String(req.headers.cookie || "").split(";")) {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  }
  return out;
}
const fmtTime = (d) => new Intl.DateTimeFormat("sq-AL", { timeZone: "Europe/Belgrade", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

function device(ua) {
  ua = String(ua || "");
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android"
    : /Windows/.test(ua) ? "Windows" : /Macintosh/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "pajisje e panjohur";
  const br = /Instagram/.test(ua) ? "Instagram" : /FBAN|FBAV|FB_IAB/.test(ua) ? "Facebook" : /WhatsApp/.test(ua) ? "WhatsApp"
    : /Snapchat/.test(ua) ? "Snapchat" : /TikTok|musical_ly/.test(ua) ? "TikTok" : /Telegram/.test(ua) ? "Telegram"
    : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera"
    : /Firefox|FxiOS/.test(ua) ? "Firefox" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "shfletues";
  return `${os} · ${br}`;
}

// ---------- admini ----------
const sessions = new Map(); // token -> skadimi
const ADMIN_MAX_AGE = 90 * 24 * 3600;
function isAdmin(req) {
  const t = cookies(req).kafe_admin;
  const exp = t && sessions.get(t);
  if (!exp) return false;
  if (exp < Date.now()) { sessions.delete(t); return false; }
  return true;
}
// sesionet ruhen te data, që restart-i i serverit të mos e nxjerrë adminin
const SESS = path.join(DATA, "sessions.json");
try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(SESS, "utf8")))) sessions.set(k, v); } catch {}
const saveSessions = () => fs.writeFileSync(SESS, JSON.stringify(Object.fromEntries(sessions)));

const loginTries = new Map();
function loginLimited(ip) {
  const now = Date.now();
  const arr = (loginTries.get(ip) || []).filter((t) => now - t < 15 * 60e3);
  arr.push(now);
  loginTries.set(ip, arr);
  return arr.length > 10;
}
const same = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// ---------- Telegram ----------
async function telegram(text) {
  if (!TG_TOKEN || !TG_CHAT) return;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TG_CHAT, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) console.error("telegram:", r.status, await r.text());
  } catch (e) { console.error("telegram:", e.message); }
}

// ---------- API ----------
const visitLimit = new Map();
async function apiVisit(req, res) {
  const b = await body(req);
  const ip = ipOf(req);
  const now = Date.now();
  const arr = (visitLimit.get(ip) || []).filter((t) => now - t < 60e3);
  arr.push(now); visitLimit.set(ip, arr);
  if (arr.length > 20) return json(res, 429, {});

  const vid = /^[a-z0-9]{8,40}$/i.test(b.vid || "") ? b.vid : crypto.randomBytes(9).toString("hex");
  const admin = isAdmin(req);
  const ua = String(req.headers["user-agent"] || "").slice(0, 300);
  const v = {
    id: crypto.randomBytes(9).toString("hex"),
    vid, at: now, lastSeen: now, activeMs: 0,
    ip, country: req.headers["cf-ipcountry"] || "", ua, device: device(ua),
    screen: String(b.screen || "").slice(0, 20),
    ref: String(b.ref || "").slice(0, 200),
    admin, clicks: [],
  };
  db.visits.push(v);
  if (db.visits.length > 5000) db.visits.splice(0, db.visits.length - 5000);
  save();

  if (!admin) {
    const real = db.visits.filter((x) => !x.admin);
    const nth = real.filter((x) => x.vid === vid).length;
    const lines = [
      "☕ U hap test.gezimm.com",
      `${fmtTime(new Date(now))} · ${v.device}`,
      nth > 1 ? `Hapja e ${nth}-të nga kjo pajisje (gjithsej ${real.length}).` : `Hera e parë nga kjo pajisje (gjithsej ${real.length}).`,
    ];
    telegram(lines.join("\n"));
  }
  json(res, 200, { sid: v.id, vid });
}

async function apiEvent(req, res) {
  const b = await body(req);
  const v = byId(String(b.sid || ""));
  if (!v) return json(res, 404, {});
  const now = Date.now();
  if (b.click === "po" || b.click === "jo") {
    if (v.clicks.length < 3000) v.clicks.push({ b: b.click, t: now });
  }
  const ms = Number(b.activeMs);
  if (Number.isFinite(ms) && ms > v.activeMs) v.activeMs = Math.min(ms, now - v.at + 5000);
  v.lastSeen = now;
  save();
  json(res, 200, { ok: true });
}

async function apiLogin(req, res) {
  if (loginLimited(ipOf(req))) return json(res, 429, { error: "Shumë tentativa. Provo pas 15 minutash." });
  const b = await body(req);
  if (!same(b.user || "", ADMIN_USER) || !same(b.pass || "", ADMIN_PASS)) return json(res, 401, { error: "Përdoruesi ose fjalëkalimi është gabim." });
  const t = crypto.randomBytes(24).toString("hex");
  sessions.set(t, Date.now() + ADMIN_MAX_AGE * 1000);
  saveSessions();
  json(res, 200, { ok: true }, { "Set-Cookie": `kafe_admin=${t}; Path=/; Max-Age=${ADMIN_MAX_AGE}; HttpOnly; Secure; SameSite=Lax` });
}
function apiLogout(req, res) {
  const t = cookies(req).kafe_admin;
  if (t) { sessions.delete(t); saveSessions(); }
  json(res, 200, { ok: true }, { "Set-Cookie": "kafe_admin=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax" });
}
function apiStats(req, res) {
  if (!isAdmin(req)) return json(res, 401, { error: "Kyçu." });
  const showAdmin = new URL(req.url, "http://x").searchParams.get("admin") === "1";
  const visits = db.visits.filter((v) => showAdmin || !v.admin).slice().reverse().map((v) => ({
    id: v.id, vid: v.vid, at: v.at, lastSeen: v.lastSeen, activeMs: v.activeMs, device: v.device, ua: v.ua,
    ip: v.ip, country: v.country, screen: v.screen, ref: v.ref, admin: v.admin, clicks: v.clicks,
  }));
  json(res, 200, { now: Date.now(), visits });
}
async function apiClear(req, res) {
  if (!isAdmin(req)) return json(res, 401, {});
  db.visits = [];
  save();
  json(res, 200, { ok: true });
}

// ---------- skedarët ----------
function sendFile(res, file, cache) {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("404"); }
    const ext = path.extname(file);
    res.writeHead(200, { "Content-Type": TYPES[ext] || "application/octet-stream", "Cache-Control": cache });
    res.end(buf);
  });
}
function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/admin" || p === "/admin/") {
    return sendFile(res, path.join(PUBLIC, "admin.html"), "no-store");
  }
  if (p === "/") p = "/index.html";
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC) || file.endsWith("admin.html")) return sendFile(res, path.join(PUBLIC, "index.html"), "no-cache");
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return sendFile(res, path.join(PUBLIC, "index.html"), "no-cache");
    sendFile(res, file, path.extname(file) === ".html" ? "no-cache" : "public, max-age=3600");
  });
}

const ROUTES = {
  "POST /api/visit": apiVisit,
  "POST /api/event": apiEvent,
  "POST /api/login": apiLogin,
  "POST /api/logout": apiLogout,
  "GET /api/stats": apiStats,
  "POST /api/clear": apiClear,
  "GET /api/health": (req, res) => json(res, 200, { ok: true }),
};

http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://x").pathname;
  const fn = ROUTES[`${req.method} ${pathname}`];
  if (fn) return Promise.resolve(fn(req, res)).catch((e) => { console.error(e); json(res, 500, { error: "Diçka shkoi keq." }); });
  if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, res);
  res.writeHead(405); res.end();
}).listen(PORT, "127.0.0.1", () => console.log(`kafe (test) në :${PORT}`));

process.on("SIGTERM", () => {
  if (saveTimer) { clearTimeout(saveTimer); fs.writeFileSync(STATS, JSON.stringify(db)); }
  process.exit(0);
});
